import { execSync } from 'node:child_process';
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
  worktreeBase: string; // e.g. /workspace/.claude/worktrees
  mainRepoRoot: string; // e.g. /workspace
  logDir: string;
  patchScript?: string; // path to patch-sdk-skills-permission.py
}

/**
 * Find the main repo root from any worktree by parsing `git worktree list`.
 */
export function findMainRepoRoot(): string {
  const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
  const firstLine = output.split('\n')[0]; // "worktree /workspace"
  const match = firstLine.match(/^worktree\s+(.+)$/);
  if (!match) throw new Error('Cannot determine main repo root from git worktree list');
  return match[1];
}

export function createGitOps(config: GitOpsConfig): GitOps {
  const { worktreeBase, mainRepoRoot, logDir } = config;

  function exec(cmd: string, opts: { cwd?: string } = {}): string {
    return execSync(cmd, {
      cwd: opts.cwd ?? mainRepoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  function execStatus(
    cmd: string,
    opts: { cwd?: string } = {}
  ): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execSync(cmd, {
        cwd: opts.cwd ?? mainRepoRoot,
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

  return {
    async createWorktree(branch: string, base: string): Promise<string> {
      const safeBranch = branch.replace(/\//g, '-');
      const wtPath = path.join(worktreeBase, safeBranch);

      // Try creating new branch from base, fallback to existing branch
      const result = execStatus(`git worktree add "${wtPath}" -b "${branch}" "${base}"`);
      if (result.code !== 0) {
        // Branch may already exist — try checkout
        exec(`git worktree add "${wtPath}" "${branch}"`);
      }

      // npm install (silent) — skip if no package.json
      if (fs.existsSync(path.join(wtPath, 'package.json'))) {
        execSync('npm install --silent', { cwd: wtPath, stdio: 'pipe' });
      }

      // Copy WASM artifacts from main repo
      copyWasmArtifacts(mainRepoRoot, wtPath);

      // Apply SDK skills patch if script exists
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
        execSync(`rm -rf "${worktreePath}"`, { stdio: 'pipe' });
      }
      execSync('git worktree prune', { cwd: mainRepoRoot, stdio: 'pipe' });
    },

    async createMergeWorktree(mergeTarget: string): Promise<string> {
      const wtPath = path.join(worktreeBase, `merge-${mergeTarget.replace(/\//g, '-')}`);

      // Ensure merge target branch exists
      const exists = execStatus(`git rev-parse --verify "${mergeTarget}"`, { cwd: mainRepoRoot });
      if (exists.code !== 0) {
        exec(`git branch "${mergeTarget}" HEAD`);
      }

      const result = execStatus(`git worktree add "${wtPath}" "${mergeTarget}"`);
      if (result.code !== 0) {
        // Worktree may already exist — clean and recreate
        if (fs.existsSync(wtPath)) {
          execSync(`rm -rf "${wtPath}"`, { stdio: 'pipe' });
          execSync('git worktree prune', { cwd: mainRepoRoot, stdio: 'pipe' });
        }
        exec(`git worktree add "${wtPath}" "${mergeTarget}"`);
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
      const ref =
        execStatus(`git rev-parse --verify "origin/${branch}"`, { cwd: worktree }).code === 0
          ? `origin/${branch}`
          : branch;
      const result = execStatus(`git merge --no-ff -m "merge ${branch}" "${ref}"`, {
        cwd: worktree,
      });

      if (result.code === 0) {
        if (result.stdout.includes('Already up to date')) {
          return 'up-to-date';
        }
        // Check if crates/ changed — rebuild WASM if so
        const diff = execStatus('git diff HEAD~1 --name-only', { cwd: worktree });
        if (diff.stdout.split('\n').some((f) => f.startsWith('crates/'))) {
          rebuildWasm(worktree);
        }
        return 'merged';
      }

      // Check for conflict
      const conflicts = execStatus('git diff --name-only --diff-filter=U', { cwd: worktree });
      if (conflicts.stdout.length > 0) {
        return 'conflict';
      }

      // Other merge error — treat as conflict for retry
      return 'conflict';
    },

    verify(
      worktree: string,
      checks: { tsc: boolean; vitest: boolean; cargo: boolean }
    ): VerifyResult {
      const results = { tsc: true, vitest: true, cargo: true };
      let lastStdout = '';
      let fixAttempts = 0;

      if (checks.tsc) {
        const tsc = execStatus('npx tsc --noEmit', { cwd: worktree });
        results.tsc = tsc.code === 0;
        if (!results.tsc) lastStdout = tsc.stdout || tsc.stderr;
      }

      if (checks.vitest) {
        const vt = execStatus('npx vitest run --reporter=dot', { cwd: worktree });
        results.vitest = vt.code === 0;
        if (!results.vitest) lastStdout = vt.stdout || vt.stderr;
      }

      if (checks.cargo) {
        const cargo = execStatus(
          'bash -c "source $HOME/.cargo/env 2>/dev/null; cd crates/scheduler && cargo test 2>&1"',
          { cwd: worktree }
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

    mergeAbort(worktree: string): void {
      execStatus('git merge --abort', { cwd: worktree });
    },

    isMergeClean(worktree: string): boolean {
      const result = execStatus('git diff --check', { cwd: worktree });
      return result.code === 0;
    },

    rebaseOnMain(worktree: string): void {
      exec('git fetch origin main', { cwd: worktree });
      exec('git rebase origin/main', { cwd: worktree });
    },

    copyWasm(from: string, to: string): void {
      copyWasmArtifacts(from, to);
    },

    ensureWasm(launchDir: string): void {
      const wasmDir = path.join(launchDir, 'src', 'wasm');
      if (fs.existsSync(path.join(wasmDir, 'scheduler_bg.wasm'))) return;

      // Fallback: copy from main repo root
      copyWasmArtifacts(mainRepoRoot, launchDir);
    },

    checkCleanState(): void {
      const status = exec('git status --porcelain', { cwd: mainRepoRoot });
      if (status.length > 0) {
        throw new Error(`Main repo has uncommitted changes:\n${status}`);
      }
    },

    runHookTests(): void {
      exec('bash scripts/test-hooks.sh', { cwd: mainRepoRoot });
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
    const buildResult = execStatus(
      'bash -c "source $HOME/.cargo/env 2>/dev/null; wasm-pack build crates/scheduler --target web --out-dir ../../src/wasm 2>&1"',
      { cwd: worktree }
    );
    if (buildResult.code !== 0) {
      // WASM rebuild failed — log but don't throw (may be expected in non-Rust changes)
      fs.appendFileSync(
        path.join(logDir, 'wasm-rebuild.log'),
        `WASM rebuild failed in ${worktree}:\n${buildResult.stderr}\n`
      );
    }
    // Commit Cargo.lock if modified
    const lockStatus = execStatus('git diff --name-only Cargo.lock', { cwd: worktree });
    if (lockStatus.stdout.includes('Cargo.lock')) {
      exec('git add Cargo.lock && git commit -m "chore: update Cargo.lock after WASM rebuild"', {
        cwd: worktree,
      });
    }
  }

  function applyPatch(cwd: string): void {
    const patchScript =
      config.patchScript ?? path.join(mainRepoRoot, 'scripts', 'patch-sdk-skills-permission.py');
    if (fs.existsSync(patchScript)) {
      execStatus(`python3 "${patchScript}"`, { cwd });
    }
  }
}
