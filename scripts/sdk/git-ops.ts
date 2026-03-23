import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VerifyResult } from './types.js';

/**
 * GitOps — typed interface over git/build shell commands.
 * Wraps existing bash scripts. All paths must be absolute.
 */
export interface GitOps {
  createWorktree(branch: string, base: string): Promise<string>;
  removeWorktree(worktreePath: string): void;
  createMergeWorktree(mergeTarget: string): Promise<string>;
  removeMergeWorktree(worktreePath: string): void;
  mergeBranch(worktree: string, branch: string): 'merged' | 'conflict' | 'up-to-date';
  mergeAbort(worktree: string): void;
  isMergeClean(worktree: string): boolean;
  verify(worktree: string, checks: { tsc: boolean; vitest: boolean; cargo: boolean }): VerifyResult;
  rebaseOnMain(worktree: string): void;
  copyWasm(from: string, to: string): void;
  ensureWasm(launchDir: string): void;
  checkCleanState(): void;
  runHookTests(): void;
  applySkillsPatch(): void;
}

export interface GitOpsConfig {
  worktreeBase: string;
  mainRepoRoot: string;
  logDir: string;
  patchScript?: string;
}

/**
 * Find the main repo root from any worktree by parsing `git worktree list`.
 */
export function findMainRepoRoot(): string {
  const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
  const line = output.split('\n').find((l) => l.startsWith('worktree '));
  if (!line) throw new Error('Cannot determine main repo root from git worktree list');
  return line.slice('worktree '.length);
}

// ── Safe exec helpers (no shell injection) ──────────────────────────

/** Run git with args array — no shell, no injection risk. */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Run git and return exit code + output. Never throws. */
function gitStatus(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: (err.stdout as string)?.trim() ?? '',
      stderr: (err.stderr as string)?.trim() ?? '',
    };
  }
}

/** Run a shell command (for npm/bash — only used with static strings, never user input). */
function shell(cmd: string, cwd: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: (err.stdout as string)?.trim() ?? '',
      stderr: (err.stderr as string)?.trim() ?? '',
    };
  }
}

export function createGitOps(config: GitOpsConfig): GitOps {
  const { worktreeBase, mainRepoRoot, logDir } = config;

  return {
    async createWorktree(branch: string, base: string): Promise<string> {
      const safeBranch = branch.replace(/\//g, '-');
      const wtPath = path.join(worktreeBase, safeBranch);

      // Try creating new branch from base, fallback to existing branch
      const result = gitStatus(['worktree', 'add', wtPath, '-b', branch, base], mainRepoRoot);
      if (result.code !== 0) {
        git(['worktree', 'add', wtPath, branch], mainRepoRoot);
      }

      // npm install — skip if no package.json
      if (fs.existsSync(path.join(wtPath, 'package.json'))) {
        execSync('npm install --silent', { cwd: wtPath, stdio: 'pipe' });
      }

      copyWasmArtifacts(mainRepoRoot, wtPath);
      applyPatch(wtPath);

      // Seed .agent-status.json if not present
      const statusPath = path.join(wtPath, '.agent-status.json');
      if (!fs.existsSync(statusPath)) {
        fs.writeFileSync(
          statusPath,
          JSON.stringify(
            {
              status: 'starting',
              last_updated: new Date().toISOString(),
            },
            null,
            2
          )
        );
      }

      return wtPath;
    },

    removeWorktree(worktreePath: string): void {
      if (!worktreePath.startsWith(worktreeBase)) {
        throw new Error(`Refusing to remove path outside worktree base: ${worktreePath}`);
      }
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      git(['worktree', 'prune'], mainRepoRoot);
    },

    async createMergeWorktree(mergeTarget: string): Promise<string> {
      const wtPath = path.join(worktreeBase, `merge-${mergeTarget.replace(/\//g, '-')}`);

      // Ensure merge target branch exists
      if (gitStatus(['rev-parse', '--verify', mergeTarget], mainRepoRoot).code !== 0) {
        git(['branch', mergeTarget, 'HEAD'], mainRepoRoot);
      }

      const result = gitStatus(['worktree', 'add', wtPath, mergeTarget], mainRepoRoot);
      if (result.code !== 0) {
        if (fs.existsSync(wtPath)) {
          fs.rmSync(wtPath, { recursive: true, force: true });
          git(['worktree', 'prune'], mainRepoRoot);
        }
        git(['worktree', 'add', wtPath, mergeTarget], mainRepoRoot);
      }

      if (fs.existsSync(path.join(wtPath, 'package.json'))) {
        execSync('npm install --silent', { cwd: wtPath, stdio: 'pipe' });
      }
      copyWasmArtifacts(mainRepoRoot, wtPath);

      return wtPath;
    },

    removeMergeWorktree(worktreePath: string): void {
      this.removeWorktree(worktreePath);
    },

    mergeBranch(worktree: string, branch: string): 'merged' | 'conflict' | 'up-to-date' {
      // Try origin/<branch> first (typical for remote branches), fall back to local
      const hasOrigin =
        gitStatus(['rev-parse', '--verify', `origin/${branch}`], worktree).code === 0;
      const ref = hasOrigin ? `origin/${branch}` : branch;
      const result = gitStatus(['merge', '--no-ff', '-m', `merge ${branch}`, ref], worktree);

      if (result.code === 0) {
        if (result.stdout.includes('Already up to date')) {
          return 'up-to-date';
        }
        // Check if crates/ changed — rebuild WASM if so
        const diff = gitStatus(['diff', 'HEAD~1', '--name-only'], worktree);
        if (diff.stdout.split('\n').some((f) => f.startsWith('crates/'))) {
          rebuildWasm(worktree);
        }
        return 'merged';
      }

      // Check for unmerged files (indicates conflict)
      const conflicts = gitStatus(['diff', '--name-only', '--diff-filter=U'], worktree);
      if (conflicts.stdout.length > 0) {
        return 'conflict';
      }
      return 'conflict';
    },

    mergeAbort(worktree: string): void {
      gitStatus(['merge', '--abort'], worktree);
    },

    isMergeClean(worktree: string): boolean {
      // Check for unmerged files — the correct test for "is the merge fully resolved?"
      const result = gitStatus(['diff', '--name-only', '--diff-filter=U'], worktree);
      return result.stdout.length === 0;
    },

    verify(
      worktree: string,
      checks: { tsc: boolean; vitest: boolean; cargo: boolean }
    ): VerifyResult {
      const results = { tsc: true, vitest: true, cargo: true };
      let lastStdout = '';
      const fixAttempts = 0;

      if (checks.tsc) {
        const tsc = shell('npx tsc --noEmit', worktree);
        results.tsc = tsc.code === 0;
        if (!results.tsc) lastStdout = tsc.stdout || tsc.stderr;
      }

      if (checks.vitest) {
        const vt = shell('npx vitest run --reporter=dot', worktree);
        results.vitest = vt.code === 0;
        if (!results.vitest) lastStdout = vt.stdout || vt.stderr;
      }

      if (checks.cargo) {
        const cargo = shell(
          'bash -c "source $HOME/.cargo/env 2>/dev/null; cd crates/scheduler && cargo test 2>&1"',
          worktree
        );
        results.cargo = cargo.code === 0;
        if (!results.cargo) lastStdout = cargo.stdout || cargo.stderr;
      }

      return {
        passed: results.tsc && results.vitest && results.cargo,
        checks: results,
        fixAttempts,
        stdout: lastStdout || undefined,
      };
    },

    rebaseOnMain(worktree: string): void {
      git(['fetch', 'origin', 'main'], worktree);
      git(['rebase', 'origin/main'], worktree);
    },

    copyWasm(from: string, to: string): void {
      copyWasmArtifacts(from, to);
    },

    ensureWasm(launchDir: string): void {
      const wasmDir = path.join(launchDir, 'src', 'wasm');
      if (fs.existsSync(path.join(wasmDir, 'scheduler_bg.wasm'))) return;
      copyWasmArtifacts(mainRepoRoot, launchDir);
    },

    checkCleanState(): void {
      const status = git(['status', '--porcelain'], mainRepoRoot);
      if (status.length > 0) {
        throw new Error(`Main repo has uncommitted changes:\n${status}`);
      }
    },

    runHookTests(): void {
      shell('bash scripts/test-hooks.sh', mainRepoRoot);
    },

    applySkillsPatch(): void {
      applyPatch(mainRepoRoot);
    },
  };

  function copyWasmArtifacts(from: string, to: string): void {
    const wasmSrc = path.join(from, 'src', 'wasm');
    const wasmDest = path.join(to, 'src', 'wasm');
    if (!fs.existsSync(wasmSrc)) return;
    fs.mkdirSync(wasmDest, { recursive: true });
    const files = fs
      .readdirSync(wasmSrc)
      .filter((f) => f.endsWith('.wasm') || f.endsWith('.js') || f.endsWith('.d.ts'));
    for (const file of files) {
      fs.copyFileSync(path.join(wasmSrc, file), path.join(wasmDest, file));
    }
  }

  function rebuildWasm(worktree: string): void {
    const buildResult = shell(
      'bash -c "source $HOME/.cargo/env 2>/dev/null; wasm-pack build crates/scheduler --target web --out-dir ../../src/wasm 2>&1"',
      worktree
    );
    if (buildResult.code !== 0) {
      fs.appendFileSync(
        path.join(logDir, 'wasm-rebuild.log'),
        `WASM rebuild failed in ${worktree}:\n${buildResult.stderr}\n`
      );
    }
    // Commit Cargo.lock if modified
    const lockChanged = gitStatus(['diff', '--name-only', 'Cargo.lock'], worktree);
    if (lockChanged.stdout.includes('Cargo.lock')) {
      git(['add', 'Cargo.lock'], worktree);
      git(['commit', '-m', 'chore: update Cargo.lock after WASM rebuild'], worktree);
    }
  }

  function applyPatch(cwd: string): void {
    const patchScript =
      config.patchScript ?? path.join(mainRepoRoot, 'scripts', 'patch-sdk-skills-permission.py');
    if (fs.existsSync(patchScript)) {
      execFileSync('python3', [patchScript], { cwd, stdio: 'pipe' });
    }
  }
}
