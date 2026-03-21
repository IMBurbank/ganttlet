// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { buildRetryContext } from '../agent-runner.js';

describe('buildRetryContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-ctx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('worktree with git commits → includes last 5 commit lines', () => {
    execSync(
      'git init && git config user.email "test@test.com" && git config user.name "Test" && git commit --allow-empty -m "test commit 1"',
      { cwd: tmpDir, stdio: 'pipe' }
    );
    const ctx = buildRetryContext(tmpDir, null);
    expect(ctx).toContain('test commit 1');
    expect(ctx).toContain('Recent commits');
  });

  it('worktree with .agent-status.json → includes JSON content', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    const status = JSON.stringify({ status: 'in-progress' });
    fs.writeFileSync(path.join(tmpDir, '.agent-status.json'), status);
    const ctx = buildRetryContext(tmpDir, null);
    expect(ctx).toContain('in-progress');
    expect(ctx).toContain('Agent status');
  });

  it('previous output provided → includes last 200 chars', () => {
    const output = 'x'.repeat(300);
    const ctx = buildRetryContext(tmpDir, output);
    expect(ctx).toContain('Previous output');
    // Should contain last 200 chars
    expect(ctx).toContain('x'.repeat(200));
  });

  it('no git repo → graceful fallback', () => {
    const ctx = buildRetryContext(tmpDir, null);
    expect(ctx).toContain('Retry Context');
    expect(ctx).not.toContain('Recent commits');
  });

  it('no .agent-status.json → omits that section', () => {
    const ctx = buildRetryContext(tmpDir, null);
    expect(ctx).not.toContain('Agent status');
  });

  it('null previous output → omits that section', () => {
    const ctx = buildRetryContext(tmpDir, null);
    expect(ctx).not.toContain('Previous output');
  });
});
