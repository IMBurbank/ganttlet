import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadOrCreateState,
  saveState,
  findBranchForDep,
  deriveRunIdentity,
  runPipeline,
} from '../pipeline-runner.js';
import type { Handlers } from '../handlers.js';
import type { GitOps } from '../git-ops.js';
import type { Observer } from '../observers/types.js';
import type { DAGNode, RunIdentity, VerifyResult } from '../types.js';

// ── Mock factories ──────────────────────────────────────────────────

function mockRun(): RunIdentity {
  return {
    phase: 'test',
    baseRef: 'abc',
    suffix: '12345678',
    mergeTarget: 'feature/test',
    logDir: '',
    launchDir: '/tmp/launch',
    configPath: 'config.yaml',
  };
}

function mockGitOps(): GitOps {
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
  };
}

function mockHandlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    agent: vi.fn().mockResolvedValue({ status: 'success', costUsd: 1.0, turns: 5 }),
    merge: vi.fn().mockResolvedValue('merged' as const),
    verify: vi.fn().mockResolvedValue({ status: 'success' }),
    ...overrides,
  };
}

function mockObserver(): Observer {
  return {
    onPipelineStart: vi.fn(),
    onNodeStart: vi.fn(),
    onAgentEvent: vi.fn(),
    onNodeComplete: vi.fn(),
    onMerge: vi.fn(),
    onVerify: vi.fn(),
    onPipelineComplete: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('loadOrCreateState', () => {
  it('creates fresh state from DAG', () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [] },
      { id: 'B', type: 'agent', dependsOn: ['A'] },
    ];
    const state = loadOrCreateState('/nonexistent', dag, mockRun());
    expect(state.nodes.A.status).toBe('ready');
    expect(state.nodes.B.status).toBe('blocked');
    expect(state.status).toBe('running');
  });

  it('initializes maxRetries from DAGNode (verify=3, agent=1)', () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [] },
      { id: 'V', type: 'verify', dependsOn: ['A'], level: 'full' },
    ];
    const state = loadOrCreateState('/nonexistent', dag, mockRun());
    expect(state.nodes.A.maxRetries).toBe(1);
    expect(state.nodes.V.maxRetries).toBe(3);
  });

  it('resume resets running→ready and skipped→blocked', () => {
    const tmpDir = fs.mkdtempSync('/tmp/pipeline-test-');
    const statePath = path.join(tmpDir, 'state.json');
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [] },
      { id: 'B', type: 'agent', dependsOn: ['A'] },
    ];
    const saved: any = {
      run: mockRun(),
      nodes: {
        A: { status: 'running', attempt: 0, maxRetries: 1, costUsd: 0, turns: 0 },
        B: { status: 'skipped', attempt: 0, maxRetries: 1, costUsd: 0, turns: 0 },
      },
      status: 'failed',
      createdAt: '',
      updatedAt: '',
    };
    fs.writeFileSync(statePath, JSON.stringify(saved));

    const state = loadOrCreateState(statePath, dag, mockRun());
    expect(state.nodes.A.status).toBe('ready');
    expect(state.nodes.B.status).toBe('blocked');
    expect(state.status).toBe('running');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('resume resets merge_conflict failures to blocked', () => {
    const tmpDir = fs.mkdtempSync('/tmp/pipeline-test-');
    const statePath = path.join(tmpDir, 'state.json');
    const dag: DAGNode[] = [{ id: 'A', type: 'agent', dependsOn: [] }];
    const saved: any = {
      run: mockRun(),
      nodes: {
        A: {
          status: 'failure',
          failureReason: 'merge_conflict',
          attempt: 0,
          maxRetries: 1,
          costUsd: 0,
          turns: 0,
        },
      },
      status: 'failed',
      createdAt: '',
      updatedAt: '',
    };
    fs.writeFileSync(statePath, JSON.stringify(saved));

    const state = loadOrCreateState(statePath, dag, mockRun());
    expect(state.nodes.A.status).toBe('blocked');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('throws when DAG changed between runs', () => {
    const tmpDir = fs.mkdtempSync('/tmp/pipeline-test-');
    const statePath = path.join(tmpDir, 'state.json');
    const saved: any = {
      run: mockRun(),
      nodes: { A: { status: 'success', attempt: 1, maxRetries: 1, costUsd: 0, turns: 0 } },
      status: 'complete',
      createdAt: '',
      updatedAt: '',
    };
    fs.writeFileSync(statePath, JSON.stringify(saved));

    const newDag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [] },
      { id: 'B', type: 'agent', dependsOn: [] },
    ];
    expect(() => loadOrCreateState(statePath, newDag, mockRun())).toThrow('DAG changed');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('saveState', () => {
  it('writes atomically via rename', () => {
    const tmpDir = fs.mkdtempSync('/tmp/pipeline-test-');
    const statePath = path.join(tmpDir, 'state.json');
    const state: any = {
      run: mockRun(),
      nodes: {},
      status: 'running',
      createdAt: '',
      updatedAt: '',
    };
    saveState(statePath, state);
    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(statePath + '.tmp')).toBe(false);
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(loaded.updatedAt).toBeTruthy();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('findBranchForDep', () => {
  it('returns branch from agent node', () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
    ];
    expect(findBranchForDep(dag, 'A')).toBe('feature/A');
  });

  it('walks through verify nodes to agent', () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
      { id: 'verify:A', type: 'verify', dependsOn: ['A'], level: 'full' },
    ];
    expect(findBranchForDep(dag, 'verify:A')).toBe('feature/A');
  });

  it('returns undefined for branchless nodes', () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' } },
    ];
    expect(findBranchForDep(dag, 'A')).toBeUndefined();
  });
});

describe('deriveRunIdentity', () => {
  it('produces deterministic suffix from config+ref', () => {
    const r1 = deriveRunIdentity('config.yaml', 'test', 'feature/test', 'abc123');
    const r2 = deriveRunIdentity('config.yaml', 'test', 'feature/test', 'abc123');
    expect(r1.suffix).toBe(r2.suffix);
    expect(r1.suffix).toHaveLength(8);
  });

  it('different refs produce different suffixes', () => {
    const r1 = deriveRunIdentity('config.yaml', 'test', 'feature/test', 'abc');
    const r2 = deriveRunIdentity('config.yaml', 'test', 'feature/test', 'def');
    expect(r1.suffix).not.toBe(r2.suffix);
  });
});

describe('runPipeline', () => {
  let tmpDir: string;
  let statePath: string;
  let run: RunIdentity;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync('/tmp/pipeline-test-');
    statePath = path.join(tmpDir, 'state.json');
    run = { ...mockRun(), logDir: tmpDir };
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('executes a single agent node', async () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' } },
    ];
    const handlers = mockHandlers();
    const obs = mockObserver();

    const state = await runPipeline(dag, run, handlers, mockGitOps(), [obs], statePath, {
      maxParallel: 5,
    });
    expect(state.status).toBe('complete');
    expect(state.nodes.A.status).toBe('success');
    expect(handlers.agent).toHaveBeenCalledOnce();
    expect(obs.onPipelineComplete).toHaveBeenCalledOnce();
  });

  it('executes diamond DAG in correct order', async () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' } },
      { id: 'B', type: 'agent', dependsOn: ['A'], spec: { id: 'B', prompt: 'b.md' } },
      { id: 'C', type: 'agent', dependsOn: ['A'], spec: { id: 'C', prompt: 'c.md' } },
      { id: 'D', type: 'agent', dependsOn: ['B', 'C'], spec: { id: 'D', prompt: 'd.md' } },
    ];
    const callOrder: string[] = [];
    const handlers = mockHandlers({
      agent: vi.fn().mockImplementation(async (spec) => {
        callOrder.push(spec.id);
        return { status: 'success', costUsd: 1, turns: 3 };
      }),
    });

    const state = await runPipeline(dag, run, handlers, mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(state.status).toBe('complete');
    expect(callOrder[0]).toBe('A'); // A first
    expect(callOrder).toContain('B');
    expect(callOrder).toContain('C');
    expect(callOrder[callOrder.length - 1]).toBe('D'); // D last
  });

  it('runs verify nodes in Phase 1 (serial)', async () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
      { id: 'verify:A', type: 'verify', dependsOn: ['A'], level: 'full', maxRetries: 3 },
    ];
    const handlers = mockHandlers();

    const state = await runPipeline(dag, run, handlers, mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(state.status).toBe('complete');
    expect(handlers.verify).toHaveBeenCalledOnce();
    expect(state.nodes['verify:A'].status).toBe('success');
  });

  it('merges dependency branches before dispatch', async () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
      { id: 'B', type: 'agent', dependsOn: ['A'], spec: { id: 'B', prompt: 'b.md' } },
    ];
    const handlers = mockHandlers();
    const gitOps = mockGitOps();

    await runPipeline(dag, run, handlers, gitOps, [mockObserver()], statePath, { maxParallel: 5 });
    // B depends on A which has a branch — merge should be called
    expect(handlers.merge).toHaveBeenCalled();
  });

  it('merge failure marks node with merge_conflict, does not burn attempt', async () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
      { id: 'B', type: 'agent', dependsOn: ['A'], spec: { id: 'B', prompt: 'b.md' } },
    ];
    const handlers = mockHandlers({
      merge: vi.fn().mockResolvedValue('failed' as const),
    });

    const state = await runPipeline(dag, run, handlers, mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(state.nodes.B.status).toBe('failure');
    expect(state.nodes.B.failureReason).toBe('merge_conflict');
    expect(state.nodes.B.attempt).toBe(0); // attempt NOT incremented
  });

  it('agent failure increments attempt', async () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' }, maxRetries: 2 },
    ];
    const handlers = mockHandlers({
      agent: vi
        .fn()
        .mockResolvedValueOnce({ status: 'failure', failureReason: 'timeout' })
        .mockResolvedValueOnce({ status: 'success', costUsd: 1, turns: 5 }),
    });

    const state = await runPipeline(dag, run, handlers, mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(state.status).toBe('complete');
    expect(state.nodes.A.status).toBe('success');
    expect(state.nodes.A.attempt).toBe(2); // failed once, then succeeded
    expect(handlers.agent).toHaveBeenCalledTimes(2);
  });

  it('state file persists between iterations', async () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' } },
    ];
    await runPipeline(dag, run, mockHandlers(), mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(fs.existsSync(statePath)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(loaded.nodes.A.status).toBe('success');
  });

  it('accumulates cost and turns across retries', async () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' }, maxRetries: 2 },
    ];
    const handlers = mockHandlers({
      agent: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'failure',
          failureReason: 'agent',
          costUsd: 2.0,
          turns: 10,
        })
        .mockResolvedValueOnce({ status: 'success', costUsd: 1.5, turns: 8 }),
    });

    const state = await runPipeline(dag, run, handlers, mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(state.nodes.A.costUsd).toBe(3.5);
    expect(state.nodes.A.turns).toBe(18);
  });

  it('cleans up agent worktrees on success', async () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
    ];
    const gitOps = mockGitOps();

    await runPipeline(dag, run, mockHandlers(), gitOps, [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(gitOps.removeWorktree).toHaveBeenCalled();
  });

  it('cleans up merge worktree in finally block', async () => {
    const dag: DAGNode[] = [
      {
        id: 'A',
        type: 'agent',
        dependsOn: [],
        spec: { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      },
      { id: 'verify:A', type: 'verify', dependsOn: ['A'], level: 'full', maxRetries: 3 },
      { id: 'B', type: 'agent', dependsOn: ['verify:A'], spec: { id: 'B', prompt: 'b.md' } },
    ];
    const gitOps = mockGitOps();

    await runPipeline(dag, run, mockHandlers(), gitOps, [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(gitOps.removeMergeWorktree).toHaveBeenCalled();
  });

  it('sets exit code based on pipeline status', async () => {
    const dag: DAGNode[] = [
      { id: 'A', type: 'agent', dependsOn: [], spec: { id: 'A', prompt: 'a.md' } },
    ];
    await runPipeline(dag, run, mockHandlers(), mockGitOps(), [mockObserver()], statePath, {
      maxParallel: 5,
    });
    expect(process.exitCode).toBe(0);
  });
});
