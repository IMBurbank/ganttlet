import { describe, it, expect, vi } from 'vitest';
import { createMergeHandler, createVerifyHandler, type FixAgentFn } from '../handlers.js';
import type { GitOps } from '../git-ops.js';
import type { DAGNode, VerifyResult } from '../types.js';

// ── Mock factories ──────────────────────────────────────────────────

const LOG_DIR = '/tmp/test-logs';

function mockGitOps(overrides: Partial<GitOps> = {}): GitOps {
  return {
    createWorktree: vi.fn().mockResolvedValue('/tmp/wt'),
    removeWorktree: vi.fn(),
    createMergeWorktree: vi.fn().mockResolvedValue('/tmp/merge-wt'),
    removeMergeWorktree: vi.fn(),
    mergeBranch: vi.fn().mockReturnValue('merged' as const),
    mergeAbort: vi.fn(),
    isMergeClean: vi.fn().mockReturnValue(true),
    verify: vi.fn().mockReturnValue({
      passed: true,
      checks: { tsc: true, vitest: true, cargo: true },
      fixAttempts: 0,
    } satisfies VerifyResult),
    rebaseOnMain: vi.fn(),
    copyWasm: vi.fn(),
    ensureWasm: vi.fn(),
    checkCleanState: vi.fn(),
    runHookTests: vi.fn(),
    applySkillsPatch: vi.fn(),
    ...overrides,
  };
}

function mockFixAgent(behavior: 'succeed' | 'fail' = 'succeed'): FixAgentFn {
  return vi.fn().mockResolvedValue({ failed: behavior === 'fail' });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('merge handler', () => {
  it('returns merged on clean merge (no conflict)', async () => {
    const gitOps = mockGitOps();
    const handler = createMergeHandler(gitOps, mockFixAgent(), LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(gitOps.mergeBranch).toHaveBeenCalledOnce();
  });

  it('returns merged when up-to-date', async () => {
    const gitOps = mockGitOps({
      mergeBranch: vi.fn().mockReturnValue('up-to-date' as const),
    });
    const handler = createMergeHandler(gitOps, mockFixAgent(), LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
  });

  it('resolves conflict with fix agent on first attempt', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const)
      .mockReturnValueOnce('merged' as const);
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const fixAgent = mockFixAgent('succeed');
    const handler = createMergeHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(fixAgent).toHaveBeenCalledOnce();
  });

  it('retries with escalation after fix agent failure', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const)
      .mockReturnValueOnce('conflict' as const)
      .mockReturnValueOnce('conflict' as const);
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const fixAgent = vi
      .fn()
      .mockResolvedValueOnce({ failed: true })
      .mockResolvedValueOnce({ failed: true })
      .mockResolvedValueOnce({ failed: false });
    const handler = createMergeHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(fixAgent).toHaveBeenCalledTimes(3);

    // Verify final attempt uses opus model (5th arg)
    const lastCall = fixAgent.mock.calls[2];
    expect(lastCall[4]).toBe('claude-opus-4-6');
  });

  it('returns failed after all 3 fix agents fail', async () => {
    const mergeFn = vi.fn().mockReturnValue('conflict' as const);
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const fixAgent = vi.fn().mockResolvedValue({ failed: true });
    const handler = createMergeHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('failed');
    expect(fixAgent).toHaveBeenCalledTimes(3);
  });

  it('returns merged if conflict resolves upstream between attempts', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const)
      .mockReturnValueOnce('merged' as const);
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const fixAgent = vi.fn().mockResolvedValue({ failed: true });
    const handler = createMergeHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(fixAgent).toHaveBeenCalledOnce();
  });

  it('aborts and retries when fix agent succeeds but merge not clean', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const)
      .mockReturnValueOnce('conflict' as const);
    const gitOps = mockGitOps({
      mergeBranch: mergeFn,
      isMergeClean: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
    });
    const fixAgent = vi.fn().mockResolvedValue({ failed: false });
    const handler = createMergeHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(fixAgent).toHaveBeenCalledTimes(2);
    expect(gitOps.mergeAbort).toHaveBeenCalledTimes(1);
  });

  it('forwards events to onEvent callback', async () => {
    const gitOps = mockGitOps({
      mergeBranch: vi.fn().mockReturnValue('conflict' as const),
    });
    const onEvent = vi.fn();
    const fixAgent: FixAgentFn = vi.fn(async (_prompt, _workdir, _logFile, cb) => {
      cb({ type: 'turn', turn: 1 });
      return { failed: false };
    });
    const handler = createMergeHandler(gitOps, fixAgent, LOG_DIR);

    await handler('/tmp/wt', 'feature/test', onEvent);
    // The onEvent passed to handler is forwarded to the fix agent (4th arg)
    expect((fixAgent as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe(onEvent);
  });
});

describe('verify handler', () => {
  const verifyNode: DAGNode = {
    id: 'verify:A',
    type: 'verify',
    dependsOn: ['A'],
    level: 'full',
    maxRetries: 3,
  };

  it('returns success when checks pass', async () => {
    const gitOps = mockGitOps();
    const handler = createVerifyHandler(gitOps, mockFixAgent(), LOG_DIR);

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('success');
    expect(gitOps.verify).toHaveBeenCalledWith('/tmp/wt', { tsc: true, vitest: true, cargo: true });
  });

  it('uses quick checks when level is quick', async () => {
    const gitOps = mockGitOps();
    const quickNode: DAGNode = { ...verifyNode, level: 'quick' };
    const handler = createVerifyHandler(gitOps, mockFixAgent(), LOG_DIR);

    await handler(quickNode, '/tmp/wt', () => {});
    expect(gitOps.verify).toHaveBeenCalledWith('/tmp/wt', {
      tsc: true,
      vitest: true,
      cargo: false,
    });
  });

  it('spawns fix agent on failure and re-checks', async () => {
    const verifyFn = vi
      .fn()
      .mockReturnValueOnce({
        passed: false,
        checks: { tsc: false, vitest: true, cargo: true },
        fixAttempts: 0,
        stdout: 'type error',
      } satisfies VerifyResult)
      .mockReturnValueOnce({
        passed: true,
        checks: { tsc: true, vitest: true, cargo: true },
        fixAttempts: 0,
      } satisfies VerifyResult);
    const gitOps = mockGitOps({ verify: verifyFn });
    const fixAgent = mockFixAgent('succeed');
    const handler = createVerifyHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('success');
    expect(fixAgent).toHaveBeenCalledOnce();
    expect(verifyFn).toHaveBeenCalledTimes(2);
  });

  it('returns failure when fix agent fails', async () => {
    const gitOps = mockGitOps({
      verify: vi.fn().mockReturnValue({
        passed: false,
        checks: { tsc: false, vitest: true, cargo: true },
        fixAttempts: 0,
      } satisfies VerifyResult),
    });
    const fixAgent = mockFixAgent('fail');
    const handler = createVerifyHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('failure');
    expect(result.failureReason).toBe('verify_failed');
  });

  it('returns failure when fix agent succeeds but re-check fails', async () => {
    const verifyFn = vi.fn().mockReturnValue({
      passed: false,
      checks: { tsc: false, vitest: true, cargo: true },
      fixAttempts: 0,
    } satisfies VerifyResult);
    const gitOps = mockGitOps({ verify: verifyFn });
    const fixAgent = mockFixAgent('succeed');
    const handler = createVerifyHandler(gitOps, fixAgent, LOG_DIR);

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('failure');
    expect(result.failureReason).toBe('verify_failed');
    expect(verifyFn).toHaveBeenCalledTimes(2);
  });

  it('forwards events to onEvent callback', async () => {
    const gitOps = mockGitOps({
      verify: vi.fn().mockReturnValue({
        passed: false,
        checks: { tsc: false, vitest: true, cargo: true },
        fixAttempts: 0,
      } satisfies VerifyResult),
    });
    const onEvent = vi.fn();
    const fixAgent: FixAgentFn = vi.fn(async (_prompt, _workdir, _logFile, cb) => {
      cb({ type: 'turn', turn: 1 });
      return { failed: false };
    });
    const handler = createVerifyHandler(gitOps, fixAgent, LOG_DIR);

    await handler(verifyNode, '/tmp/wt', onEvent);
    expect((fixAgent as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe(onEvent);
  });
});
