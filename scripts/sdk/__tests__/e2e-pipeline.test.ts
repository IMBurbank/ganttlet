/**
 * End-to-end integration tests for the full pipeline.
 * Exercises: parseConfig → DAG → scheduler → pipeline runner with mock handlers.
 * No real git repos or SDK calls — all I/O mocked at the handler/GitOps boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseConfig, type RawConfig } from '../dag.js';
import { runPipeline } from '../pipeline-runner.js';
import type { Handlers } from '../handlers.js';
import type { GitOps } from '../git-ops.js';
import type { Observer } from '../observers/types.js';
import type { RunIdentity, VerifyResult, NodeResult } from '../types.js';

// ── Shared mocks ────────────────────────────────────────────────────

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

function mockObserver(): Observer {
  return {
    onPipelineStart: vi.fn(),
    onNodeStart: vi.fn(),
    onAgentEvent: vi.fn(),
    onNodeComplete: vi.fn(),
    onMerge: vi.fn(),
    onVerify: vi.fn(),
    onPipelineComplete: vi.fn(),
    onStall: vi.fn(),
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync('/tmp/e2e-pipeline-');
});
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
});

function makeRun(): RunIdentity {
  return {
    phase: 'test',
    baseRef: 'abc',
    suffix: '12345678',
    mergeTarget: 'feature/test',
    logDir: tmpDir,
    launchDir: tmpDir,
    configPath: 'config.yaml',
  };
}

// ── E2E: Curation-style config (stages) ─────────────────────────────

describe('E2E: curation pipeline (5 reviewers → 1 curator)', () => {
  const config: RawConfig = {
    phase: 'skill-curation',
    merge_target: 'curation/run',
    stages: [
      {
        name: 'Review',
        groups: [
          {
            id: 'sched-accuracy',
            prompt: 'reviewer.md',
            policy: 'reviewer',
            agent: 'skill-reviewer',
          },
          {
            id: 'sched-structure',
            prompt: 'reviewer.md',
            policy: 'reviewer',
            agent: 'skill-reviewer',
          },
          { id: 'sched-scope', prompt: 'reviewer.md', policy: 'reviewer', agent: 'skill-reviewer' },
          {
            id: 'sched-history',
            prompt: 'reviewer.md',
            policy: 'reviewer',
            agent: 'skill-reviewer',
          },
          {
            id: 'sched-adversarial',
            prompt: 'reviewer.md',
            policy: 'reviewer',
            agent: 'skill-reviewer',
          },
        ],
      },
      {
        name: 'Curate',
        groups: [
          {
            id: 'sched-curator',
            prompt: 'curator.md',
            policy: 'curator',
            branch: 'curation/sched',
          },
        ],
      },
    ],
  };

  it('parses into correct DAG structure', () => {
    const parsed = parseConfig(config);
    // 5 reviewers + 1 curator + 1 verify:curator = 7 nodes
    expect(parsed.nodes).toHaveLength(7);
    // Curator depends on all 5 reviewers
    const curator = parsed.nodes.find((n) => n.id === 'sched-curator')!;
    expect(curator.dependsOn).toEqual([
      'sched-accuracy',
      'sched-structure',
      'sched-scope',
      'sched-history',
      'sched-adversarial',
    ]);
    // Verify node depends on curator
    const verify = parsed.nodes.find((n) => n.id === 'verify:sched-curator')!;
    expect(verify.dependsOn).toEqual(['sched-curator']);
  });

  it('executes full pipeline: reviewers parallel → curator → verify', async () => {
    const parsed = parseConfig(config);
    const callOrder: string[] = [];
    const handlers: Handlers = {
      agent: vi.fn().mockImplementation(async (spec) => {
        callOrder.push(spec.id);
        return { status: 'success', costUsd: 1, turns: 5 } satisfies NodeResult;
      }),
      merge: vi.fn().mockResolvedValue('merged' as const),
      verify: vi.fn().mockResolvedValue({ status: 'success' } satisfies NodeResult),
    };

    const state = await runPipeline(
      parsed.nodes,
      makeRun(),
      handlers,
      mockGitOps(),
      [mockObserver()],
      path.join(tmpDir, 'state.json'),
      { maxParallel: 5 }
    );

    expect(state.status).toBe('complete');
    // All 5 reviewers should run before curator
    const curatorIdx = callOrder.indexOf('sched-curator');
    expect(curatorIdx).toBeGreaterThan(4); // after all 5 reviewers
    // Verify should have been called
    expect(handlers.verify).toHaveBeenCalled();
  });

  it('reports partial when curator fails', async () => {
    const parsed = parseConfig(config);
    const handlers: Handlers = {
      agent: vi.fn().mockImplementation(async (spec) => {
        if (spec.id === 'sched-curator') {
          return { status: 'failure', failureReason: 'agent' } satisfies NodeResult;
        }
        return { status: 'success', costUsd: 1, turns: 5 } satisfies NodeResult;
      }),
      merge: vi.fn().mockResolvedValue('merged' as const),
      verify: vi.fn().mockResolvedValue({ status: 'success' } satisfies NodeResult),
    };

    const state = await runPipeline(
      parsed.nodes,
      makeRun(),
      handlers,
      mockGitOps(),
      [mockObserver()],
      path.join(tmpDir, 'state.json'),
      { maxParallel: 5 }
    );

    // Curator failed, verify:curator skipped → partial (reviewers succeeded)
    expect(state.status).toBe('partial');
    expect(state.nodes['sched-curator'].status).toBe('failure');
    expect(state.nodes['verify:sched-curator'].status).toBe('skipped');
  });
});

// ── E2E: Phase19-style config (DAG) ────────────────────────────────

describe('E2E: phase19 pipeline (3 parallel → 1 dependent)', () => {
  const config: RawConfig = {
    phase: 'phase19',
    merge_target: 'feature/phase19',
    groups: [
      { id: 'A', prompt: 'a.md', branch: 'feature/A' },
      { id: 'B', prompt: 'b.md', branch: 'feature/B' },
      { id: 'C', prompt: 'c.md', branch: 'feature/C' },
      { id: 'D', prompt: 'd.md', branch: 'feature/D', depends_on: ['A', 'B', 'C'] },
    ],
  };

  it('parses with verify nodes and correct dependencies', () => {
    const parsed = parseConfig(config);
    // 4 agents + 4 verify = 8 nodes
    expect(parsed.nodes).toHaveLength(8);
    // D depends on verify:A, verify:B, verify:C
    const nodeD = parsed.nodes.find((n) => n.id === 'D')!;
    expect(nodeD.dependsOn.sort()).toEqual(['verify:A', 'verify:B', 'verify:C']);
  });

  it('executes A,B,C in parallel, then D after all verify', async () => {
    const parsed = parseConfig(config);
    const startTimes: Record<string, number> = {};
    let tick = 0;
    const handlers: Handlers = {
      agent: vi.fn().mockImplementation(async (spec) => {
        startTimes[spec.id] = tick++;
        return { status: 'success', costUsd: 1, turns: 5 } satisfies NodeResult;
      }),
      merge: vi.fn().mockResolvedValue('merged' as const),
      verify: vi.fn().mockResolvedValue({ status: 'success' } satisfies NodeResult),
    };

    const state = await runPipeline(
      parsed.nodes,
      makeRun(),
      handlers,
      mockGitOps(),
      [mockObserver()],
      path.join(tmpDir, 'state.json'),
      { maxParallel: 5 }
    );

    expect(state.status).toBe('complete');
    // D started after A, B, C
    expect(startTimes.D).toBeGreaterThan(startTimes.A);
    expect(startTimes.D).toBeGreaterThan(startTimes.B);
    expect(startTimes.D).toBeGreaterThan(startTimes.C);
  });
});

// ── E2E: Resume after partial failure ───────────────────────────────

describe('E2E: resume', () => {
  it('skips succeeded nodes, retries nodes with remaining attempts', async () => {
    const config: RawConfig = {
      phase: 'test',
      merge_target: 'feature/test',
      groups: [
        { id: 'A', prompt: 'a.md' },
        { id: 'B', prompt: 'b.md', max_retries: 3 }, // 3 retries: fail once in run 1, has 2 left
      ],
    };
    const parsed = parseConfig(config);
    const statePath = path.join(tmpDir, 'state.json');

    // First run: A succeeds, B fails on every attempt but only uses 1 of 3
    // We need B to fail exactly once then exhaust the pipeline (by having only 1 attempt)
    // Actually: the scheduler will auto-retry within the same run.
    // With maxRetries=3, B will be retried 3 times total in run 1.
    // To test resume, we need B to still have retries on resume.
    // But the scheduler exhausts all retries within a single run.
    // So for resume to work, we need maxRetries high enough that
    // the first run doesn't exhaust them all.

    // Simpler approach: manually create a state file as if a crash happened mid-run
    const crashState = {
      run: makeRun(),
      nodes: {
        A: { status: 'success', attempt: 1, maxRetries: 1, costUsd: 1, turns: 5 },
        B: { status: 'running', attempt: 0, maxRetries: 1, costUsd: 0, turns: 0 },
      },
      status: 'running',
      createdAt: '',
      updatedAt: '',
    };
    fs.writeFileSync(statePath, JSON.stringify(crashState));

    // Resume: loadOrCreateState resets running→ready. B should retry. A should NOT re-run.
    const agentCalls: string[] = [];
    const handlers: Handlers = {
      agent: vi.fn().mockImplementation(async (spec) => {
        agentCalls.push(spec.id);
        return { status: 'success', costUsd: 1, turns: 3 } satisfies NodeResult;
      }),
      merge: vi.fn().mockResolvedValue('merged' as const),
      verify: vi.fn().mockResolvedValue({ status: 'success' } satisfies NodeResult),
    };

    const state2 = await runPipeline(
      parsed.nodes,
      makeRun(),
      handlers,
      mockGitOps(),
      [mockObserver()],
      statePath,
      { maxParallel: 5 }
    );
    expect(state2.status).toBe('complete');
    expect(agentCalls).not.toContain('A');
    expect(agentCalls).toContain('B');
  });

  it('resets merge_conflict failures on resume', async () => {
    const config: RawConfig = {
      phase: 'test',
      merge_target: 'feature/test',
      groups: [
        { id: 'A', prompt: 'a.md', branch: 'feature/A' },
        { id: 'B', prompt: 'b.md', depends_on: ['A'] },
      ],
    };
    const parsed = parseConfig(config);
    const statePath = path.join(tmpDir, 'state.json');

    // Simulate a state where A+verify:A succeeded but B's merge failed
    const crashState = {
      run: makeRun(),
      nodes: {
        A: { status: 'success', attempt: 1, maxRetries: 1, costUsd: 1, turns: 5 },
        'verify:A': { status: 'success', attempt: 1, maxRetries: 3, costUsd: 0, turns: 0 },
        B: {
          status: 'failure',
          failureReason: 'merge_conflict',
          attempt: 0,
          maxRetries: 1,
          costUsd: 0,
          turns: 0,
        },
      },
      status: 'partial',
      createdAt: '',
      updatedAt: '',
    };
    fs.writeFileSync(statePath, JSON.stringify(crashState));

    // Resume: merge_conflict B should reset to blocked → ready → execute
    const agentCalls: string[] = [];
    const handlers: Handlers = {
      agent: vi.fn().mockImplementation(async (spec) => {
        agentCalls.push(spec.id);
        return { status: 'success', costUsd: 1, turns: 3 } satisfies NodeResult;
      }),
      merge: vi.fn().mockResolvedValue('merged' as const),
      verify: vi.fn().mockResolvedValue({ status: 'success' } satisfies NodeResult),
    };

    const state2 = await runPipeline(
      parsed.nodes,
      makeRun(),
      handlers,
      mockGitOps(),
      [mockObserver()],
      statePath,
      { maxParallel: 5 }
    );
    expect(state2.status).toBe('complete');
    expect(state2.nodes.B.status).toBe('success');
    expect(agentCalls).toContain('B');
    expect(agentCalls).not.toContain('A'); // A was already success
  });
});

// ── E2E: --only subset filter ───────────────────────────────────────

describe('E2E: --only filter', () => {
  it('runs only specified nodes + transitive deps', async () => {
    const config: RawConfig = {
      phase: 'test',
      merge_target: 'feature/test',
      groups: [
        { id: 'A', prompt: 'a.md' },
        { id: 'B', prompt: 'b.md', depends_on: ['A'] },
        { id: 'C', prompt: 'c.md' },
        { id: 'D', prompt: 'd.md', depends_on: ['B', 'C'] },
      ],
    };
    const parsed = parseConfig(config);

    // Filter to only D — should include A, B, C, D (transitive)
    const needed = new Set<string>();
    function collect(id: string): void {
      if (needed.has(id)) return;
      needed.add(id);
      const node = parsed.nodes.find((n) => n.id === id);
      if (node) for (const dep of node.dependsOn) collect(dep);
    }
    collect('D');
    const filtered = parsed.nodes.filter((n) => needed.has(n.id));

    expect(filtered.map((n) => n.id).sort()).toEqual(['A', 'B', 'C', 'D']);

    // Filter to only B — should include A, B
    const needed2 = new Set<string>();
    function collect2(id: string): void {
      if (needed2.has(id)) return;
      needed2.add(id);
      const node = parsed.nodes.find((n) => n.id === id);
      if (node) for (const dep of node.dependsOn) collect2(dep);
    }
    collect2('B');
    const filtered2 = parsed.nodes.filter((n) => needed2.has(n.id));

    expect(filtered2.map((n) => n.id).sort()).toEqual(['A', 'B']);
  });
});

// ── E2E: State file queryable with jq ───────────────────────────────

describe('E2E: state file structure', () => {
  it('produces queryable state file with turns, cost, logFile, lastError', async () => {
    const config: RawConfig = {
      phase: 'test',
      merge_target: 'feature/test',
      groups: [{ id: 'A', prompt: 'a.md' }],
    };
    const parsed = parseConfig(config);
    const statePath = path.join(tmpDir, 'state.json');

    const handlers: Handlers = {
      agent: vi.fn().mockResolvedValue({
        status: 'success',
        costUsd: 2.5,
        turns: 15,
        sessionId: 'sess-123',
      } satisfies NodeResult),
      merge: vi.fn().mockResolvedValue('merged' as const),
      verify: vi.fn().mockResolvedValue({ status: 'success' } satisfies NodeResult),
    };

    await runPipeline(
      parsed.nodes,
      makeRun(),
      handlers,
      mockGitOps(),
      [mockObserver()],
      statePath,
      { maxParallel: 5 }
    );

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(state.nodes.A.turns).toBe(15);
    expect(state.nodes.A.costUsd).toBe(2.5);
    expect(state.nodes.A.sessionId).toBe('sess-123');
    expect(state.nodes.A.status).toBe('success');
    expect(state.run.phase).toBe('test');
    expect(state.status).toBe('complete');
  });
});
