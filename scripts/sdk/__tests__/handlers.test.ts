import { describe, it, expect, vi } from 'vitest';
import { createMergeHandler, createVerifyHandler, type RunAgentFn } from '../handlers.js';
import type { GitOps } from '../git-ops.js';
import type { DAGNode, RunIdentity, VerifyResult } from '../types.js';

// ── Mock factories ──────────────────────────────────────────────────

function mockRunIdentity(): RunIdentity {
  return {
    phase: 'test',
    baseRef: 'abc123',
    suffix: '12345678',
    mergeTarget: 'feature/test',
    logDir: '/tmp/test-logs',
    launchDir: '/tmp/test-launch',
    configPath: 'config.yaml',
  };
}

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

function mockRunAgent(behavior: 'succeed' | 'fail' = 'succeed'): RunAgentFn {
  return vi.fn().mockResolvedValue({ failed: behavior === 'fail' });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('merge handler', () => {
  it('returns merged on clean merge (no conflict)', async () => {
    const gitOps = mockGitOps();
    const handler = createMergeHandler(gitOps, mockRunAgent(), mockRunIdentity());

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(gitOps.mergeBranch).toHaveBeenCalledOnce();
  });

  it('returns merged when up-to-date', async () => {
    const gitOps = mockGitOps({
      mergeBranch: vi.fn().mockReturnValue('up-to-date' as const),
    });
    const handler = createMergeHandler(gitOps, mockRunAgent(), mockRunIdentity());

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
  });

  it('resolves conflict with fix agent on first attempt', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const) // initial merge
      .mockReturnValueOnce('merged' as const); // not reached (fix agent succeeds)
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const runAgent = mockRunAgent('succeed');
    const handler = createMergeHandler(gitOps, runAgent, mockRunIdentity());

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('retries with escalation after fix agent failure', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const) // initial
      .mockReturnValueOnce('conflict' as const) // re-merge after attempt 0 fail
      .mockReturnValueOnce('conflict' as const); // re-merge after attempt 1 fail
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({ failed: true }) // attempt 0: fail
      .mockResolvedValueOnce({ failed: true }) // attempt 1: fail
      .mockResolvedValueOnce({ failed: false }); // attempt 2 (opus): succeed
    const handler = createMergeHandler(gitOps, runAgent, mockRunIdentity());

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(runAgent).toHaveBeenCalledTimes(3);

    // Verify final attempt uses opus model
    const lastCallOpts = runAgent.mock.calls[2][0];
    expect(lastCallOpts.model).toBe('claude-opus-4-6');
  });

  it('returns failed after all 3 fix agents fail', async () => {
    const mergeFn = vi.fn().mockReturnValue('conflict' as const);
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const runAgent = vi.fn().mockResolvedValue({ failed: true });
    const handler = createMergeHandler(gitOps, runAgent, mockRunIdentity());

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('failed');
    expect(runAgent).toHaveBeenCalledTimes(3);
  });

  it('returns merged if conflict resolves upstream between attempts', async () => {
    const mergeFn = vi
      .fn()
      .mockReturnValueOnce('conflict' as const) // initial
      .mockReturnValueOnce('merged' as const); // re-merge after abort — conflict gone
    const gitOps = mockGitOps({ mergeBranch: mergeFn });
    const runAgent = vi.fn().mockResolvedValue({ failed: true }); // fix agent fails
    const handler = createMergeHandler(gitOps, runAgent, mockRunIdentity());

    const result = await handler('/tmp/wt', 'feature/test', () => {});
    expect(result).toBe('merged');
    expect(runAgent).toHaveBeenCalledOnce(); // only first attempt before re-merge succeeds
  });

  it('forwards events to onEvent callback', async () => {
    const gitOps = mockGitOps({
      mergeBranch: vi.fn().mockReturnValue('conflict' as const),
    });
    const events: unknown[] = [];
    const onEvent = vi.fn((e: unknown) => events.push(e));
    const runAgent: RunAgentFn = vi.fn(async (_opts, _prompt, cb) => {
      cb({ type: 'turn', turn: 1 });
      return { failed: false };
    });
    const handler = createMergeHandler(gitOps, runAgent, mockRunIdentity());

    await handler('/tmp/wt', 'feature/test', onEvent);
    // The onEvent passed to handler is forwarded to the fix agent
    expect(runAgent).toHaveBeenCalled();
    const passedCallback = (runAgent as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(passedCallback).toBe(onEvent);
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
    const handler = createVerifyHandler(gitOps, mockRunAgent(), mockRunIdentity());

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('success');
    expect(gitOps.verify).toHaveBeenCalledWith('/tmp/wt', { tsc: true, vitest: true, cargo: true });
  });

  it('uses quick checks when level is quick', async () => {
    const gitOps = mockGitOps();
    const quickNode: DAGNode = { ...verifyNode, level: 'quick' };
    const handler = createVerifyHandler(gitOps, mockRunAgent(), mockRunIdentity());

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
    const runAgent = mockRunAgent('succeed');
    const handler = createVerifyHandler(gitOps, runAgent, mockRunIdentity());

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('success');
    expect(runAgent).toHaveBeenCalledOnce();
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
    const runAgent = mockRunAgent('fail');
    const handler = createVerifyHandler(gitOps, runAgent, mockRunIdentity());

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
    const runAgent = mockRunAgent('succeed');
    const handler = createVerifyHandler(gitOps, runAgent, mockRunIdentity());

    const result = await handler(verifyNode, '/tmp/wt', () => {});
    expect(result.status).toBe('failure');
    expect(result.failureReason).toBe('verify_failed');
    expect(verifyFn).toHaveBeenCalledTimes(2); // initial + re-check
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
    const runAgent: RunAgentFn = vi.fn(async (_opts, _prompt, cb) => {
      cb({ type: 'turn', turn: 1 });
      return { failed: false };
    });
    const handler = createVerifyHandler(gitOps, runAgent, mockRunIdentity());

    await handler(verifyNode, '/tmp/wt', onEvent);
    expect((runAgent as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(onEvent);
  });
});
