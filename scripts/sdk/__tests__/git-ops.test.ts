import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createGitOps, type GitOps, type GitOpsConfig } from '../git-ops.js';

// ── Test helpers ────────────────────────────────────────────────────

let testDir: string;
let repoDir: string;
let worktreeBase: string;
let logDir: string;
let gitOps: GitOps;

function git(cmd: string, cwd?: string): string {
  return execSync(`git ${cmd}`, {
    cwd: cwd ?? repoDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function createTestRepo(): void {
  testDir = fs.mkdtempSync('/tmp/git-ops-test-');
  repoDir = path.join(testDir, 'repo');
  worktreeBase = path.join(testDir, 'worktrees');
  logDir = path.join(testDir, 'logs');

  fs.mkdirSync(repoDir);
  fs.mkdirSync(worktreeBase);
  fs.mkdirSync(logDir);

  git('init -b main', repoDir);
  git('config user.email "test@test.com"');
  git('config user.name "Test"');

  // Initial commit
  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'initial content\n');
  git('add .');
  git('commit -m "initial commit"');

  const config: GitOpsConfig = {
    worktreeBase,
    mainRepoRoot: repoDir,
    logDir,
    patchScript: '/dev/null', // no-op patch
  };
  gitOps = createGitOps(config);
}

function cleanupTestRepo(): void {
  if (testDir && fs.existsSync(testDir)) {
    // Clean up worktrees first to avoid git errors
    try {
      execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
    } catch {
      /* ignore */
    }
    execSync(`rm -rf "${testDir}"`, { stdio: 'pipe' });
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('git-ops', () => {
  beforeEach(createTestRepo);
  afterEach(cleanupTestRepo);

  describe('createWorktree', () => {
    it('creates a worktree directory with correct branch', async () => {
      const wtPath = await gitOps.createWorktree('feature/test', 'main');
      expect(fs.existsSync(wtPath)).toBe(true);

      const branch = git('rev-parse --abbrev-ref HEAD', wtPath);
      expect(branch).toBe('feature/test');
    });

    it('seeds .agent-status.json', async () => {
      const wtPath = await gitOps.createWorktree('feature/test2', 'main');
      const statusPath = path.join(wtPath, '.agent-status.json');
      expect(fs.existsSync(statusPath)).toBe(true);

      const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      expect(status.status).toBe('starting');
    });

    it('returns path under worktreeBase', async () => {
      const wtPath = await gitOps.createWorktree('feature/test3', 'main');
      expect(wtPath.startsWith(worktreeBase)).toBe(true);
    });
  });

  describe('removeWorktree', () => {
    it('removes worktree directory and prunes', async () => {
      const wtPath = await gitOps.createWorktree('feature/remove-test', 'main');
      expect(fs.existsSync(wtPath)).toBe(true);

      gitOps.removeWorktree(wtPath);
      expect(fs.existsSync(wtPath)).toBe(false);
    });

    it('throws when path is outside worktreeBase', () => {
      expect(() => gitOps.removeWorktree('/tmp/dangerous-path')).toThrow('outside worktree base');
    });

    it('handles already-removed worktree gracefully', async () => {
      const wtPath = await gitOps.createWorktree('feature/double-remove', 'main');
      gitOps.removeWorktree(wtPath);
      expect(() => gitOps.removeWorktree(wtPath)).not.toThrow();
    });
  });

  describe('createMergeWorktree', () => {
    it('creates merge worktree with new branch', async () => {
      const wtPath = await gitOps.createMergeWorktree('merge/target');
      expect(fs.existsSync(wtPath)).toBe(true);

      const branch = git('rev-parse --abbrev-ref HEAD', wtPath);
      expect(branch).toBe('merge/target');
    });

    it('creates merge target branch if it does not exist', async () => {
      const wtPath = await gitOps.createMergeWorktree('feature/new-merge-target');
      expect(fs.existsSync(wtPath)).toBe(true);
    });
  });

  describe('mergeBranch', () => {
    it('returns merged on successful merge', async () => {
      // Create a feature branch with changes
      git('checkout -b feature/merge-test');
      fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature content\n');
      git('add .');
      git('commit -m "add feature"');
      git('checkout main');

      const mergeWt = await gitOps.createMergeWorktree('merge/test-target');
      const result = gitOps.mergeBranch(mergeWt, 'feature/merge-test');
      expect(result).toBe('merged');

      // Verify the file exists in the merge worktree
      expect(fs.existsSync(path.join(mergeWt, 'feature.txt'))).toBe(true);
    });

    it('returns up-to-date when already merged', async () => {
      const mergeWt = await gitOps.createMergeWorktree('merge/uptodate');
      // Merge the same commit — already up to date
      const result = gitOps.mergeBranch(mergeWt, 'main');
      expect(result).toBe('up-to-date');
    });

    it('returns conflict on merge conflict', async () => {
      // Create conflicting changes on a separate branch
      git('checkout -b feature/conflict-test');
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'conflict branch content\n');
      git('add .');
      git('commit -m "conflict change"');
      git('checkout main');

      // Advance main with conflicting content
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'main branch content\n');
      git('add .');
      git('commit -m "main change"');

      const mergeWt = await gitOps.createMergeWorktree('merge/conflict-target');
      const result = gitOps.mergeBranch(mergeWt, 'feature/conflict-test');
      expect(result).toBe('conflict');
    });
  });

  describe('verify', () => {
    it('returns passed=true when all checks succeed', async () => {
      // In a bare test repo, tsc/vitest/cargo won't exist — mock by skipping
      // This tests the interface and result structure
      const result = gitOps.verify(repoDir, { tsc: false, vitest: false, cargo: false });
      expect(result.passed).toBe(true);
      expect(result.checks).toEqual({ tsc: true, vitest: true, cargo: true });
    });
  });

  describe('rebaseOnMain', () => {
    it('rebases worktree branch on main', async () => {
      // Set up a "remote" by making the repo its own origin
      git(`remote add origin "${repoDir}"`);

      // Create a feature branch with a commit
      git('checkout -b feature/rebase-test');
      fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature\n');
      git('add .');
      git('commit -m "feature commit"');
      git('checkout main');

      // Add a commit to main after the feature branch was created
      fs.writeFileSync(path.join(repoDir, 'main-new.txt'), 'new main content\n');
      git('add .');
      git('commit -m "new main commit"');

      // Create worktree on feature branch
      const wtPath = await gitOps.createWorktree('feature/rebase-test', 'main');

      // Rebase — this should bring in the main commit
      gitOps.rebaseOnMain(wtPath);

      // Verify the main-new.txt exists after rebase
      expect(fs.existsSync(path.join(wtPath, 'main-new.txt'))).toBe(true);
    });
  });

  describe('checkCleanState', () => {
    it('passes on clean repo', () => {
      expect(() => gitOps.checkCleanState()).not.toThrow();
    });

    it('throws on dirty repo', () => {
      fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'uncommitted\n');
      expect(() => gitOps.checkCleanState()).toThrow('uncommitted changes');
    });
  });

  describe('copyWasm', () => {
    it('copies wasm artifacts between directories', () => {
      const srcDir = path.join(testDir, 'wasm-src', 'src', 'wasm');
      const destDir = path.join(testDir, 'wasm-dest');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(destDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'scheduler_bg.wasm'), 'wasm-data');
      fs.writeFileSync(path.join(srcDir, 'scheduler.js'), 'js-data');
      fs.writeFileSync(path.join(srcDir, 'scheduler.d.ts'), 'types-data');

      gitOps.copyWasm(path.join(testDir, 'wasm-src'), destDir);

      const destWasmDir = path.join(destDir, 'src', 'wasm');
      expect(fs.existsSync(path.join(destWasmDir, 'scheduler_bg.wasm'))).toBe(true);
      expect(fs.existsSync(path.join(destWasmDir, 'scheduler.js'))).toBe(true);
      expect(fs.existsSync(path.join(destWasmDir, 'scheduler.d.ts'))).toBe(true);
    });
  });
});
