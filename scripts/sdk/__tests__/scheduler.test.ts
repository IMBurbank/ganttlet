import { describe, it, expect } from 'vitest';
import { nextActions } from '../scheduler.js';
import type { DAGNode, NodeState, SchedulerAction } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeNode(id: string, deps: string[] = [], type: 'agent' | 'verify' = 'agent'): DAGNode {
  return { id, type, dependsOn: deps };
}

function makeState(
  status: NodeState['status'] = 'blocked',
  overrides: Partial<NodeState> = {}
): NodeState {
  return { status, attempt: 0, maxRetries: 1, costUsd: 0, turns: 0, ...overrides };
}

function executeIds(actions: SchedulerAction[]): string[] {
  return actions.filter((a) => a.type === 'execute').map((a) => (a as { nodeId: string }).nodeId);
}

function completeStatus(actions: SchedulerAction[]): string | undefined {
  const c = actions.find((a) => a.type === 'complete');
  return c ? (c as { status: string }).status : undefined;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('scheduler', () => {
  describe('zero-dep nodes', () => {
    it('emits execute for all ready nodes', () => {
      const nodes = [makeNode('A'), makeNode('B')];
      const state: Record<string, NodeState> = {
        A: makeState('ready'),
        B: makeState('ready'),
      };
      const actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['A', 'B']);
    });
  });

  describe('single node', () => {
    it('ready → execute', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('ready') };
      expect(executeIds(nextActions(nodes, state))).toEqual(['A']);
    });

    it('success → complete', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('success') };
      expect(completeStatus(nextActions(nodes, state))).toBe('complete');
    });

    it('failure (exhausted) → failed', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('failure', { attempt: 1, maxRetries: 1 }) };
      expect(completeStatus(nextActions(nodes, state))).toBe('failed');
    });

    it('running → no actions (waiting)', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('running') };
      const actions = nextActions(nodes, state);
      expect(actions).toEqual([]);
    });
  });

  describe('blocked → ready (rule 1)', () => {
    it('unblocks when all deps succeed', () => {
      const nodes = [makeNode('A'), makeNode('B', ['A'])];
      const state = {
        A: makeState('success'),
        B: makeState('blocked'),
      };
      const actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['B']);
      expect(state.B.status).toBe('ready');
    });

    it('stays blocked when some deps are not success', () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C', ['A', 'B'])];
      const state = {
        A: makeState('success'),
        B: makeState('running'),
        C: makeState('blocked'),
      };
      const actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual([]);
      expect(state.C.status).toBe('blocked');
    });
  });

  describe('blocked → skipped (rule 2)', () => {
    it('skips when a dep fails', () => {
      const nodes = [makeNode('A'), makeNode('B', ['A'])];
      const state = {
        A: makeState('failure', { attempt: 1, maxRetries: 1 }),
        B: makeState('blocked'),
      };
      nextActions(nodes, state);
      expect(state.B.status).toBe('skipped');
    });

    it('skips when a dep is skipped', () => {
      const nodes = [makeNode('A'), makeNode('B', ['A']), makeNode('C', ['B'])];
      const state = {
        A: makeState('failure', { attempt: 1, maxRetries: 1 }),
        B: makeState('blocked'),
        C: makeState('blocked'),
      };
      // First call: A stays failure, B → skipped
      nextActions(nodes, state);
      expect(state.B.status).toBe('skipped');
      // Second call: C → skipped (B is skipped)
      nextActions(nodes, state);
      expect(state.C.status).toBe('skipped');
    });
  });

  describe('skipped → blocked re-evaluation (rule 3)', () => {
    it('re-evaluates when failed dep resets to ready', () => {
      const nodes = [makeNode('A'), makeNode('B', ['A'])];
      const state = {
        A: makeState('failure', { attempt: 0, maxRetries: 2 }),
        B: makeState('skipped'),
      };
      // A has retries: failure → ready (rule 5). B: skipped → blocked → ready (A is ready? no, A is ready but not success)
      // Actually: A transitions to ready, B should go blocked (A is ready, not success)
      const actions = nextActions(nodes, state);
      expect(state.A.status).toBe('ready');
      expect(state.B.status).toBe('blocked'); // A is ready, not success — B stays blocked
      expect(executeIds(actions)).toEqual(['A']);
    });
  });

  describe('failure retry (rule 5)', () => {
    it('retries when attempt < maxRetries', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('failure', { attempt: 0, maxRetries: 2 }) };
      const actions = nextActions(nodes, state);
      expect(state.A.status).toBe('ready');
      expect(executeIds(actions)).toEqual(['A']);
    });

    it('does not retry when attempt >= maxRetries', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('failure', { attempt: 2, maxRetries: 2 }) };
      const actions = nextActions(nodes, state);
      expect(state.A.status).toBe('failure');
      expect(completeStatus(actions)).toBe('failed');
    });

    it('does not retry merge_conflict (terminal within run)', () => {
      const nodes = [makeNode('A')];
      const state = {
        A: makeState('failure', { attempt: 0, maxRetries: 3, failureReason: 'merge_conflict' }),
      };
      const actions = nextActions(nodes, state);
      expect(state.A.status).toBe('failure');
      expect(completeStatus(actions)).toBe('failed');
    });

    it('retries non-merge failures with same attempt/maxRetries', () => {
      const nodes = [makeNode('A')];
      const state = {
        A: makeState('failure', { attempt: 0, maxRetries: 1, failureReason: 'timeout' }),
      };
      const actions = nextActions(nodes, state);
      expect(state.A.status).toBe('ready');
      expect(executeIds(actions)).toEqual(['A']);
    });
  });

  describe('diamond dependencies', () => {
    it('handles A → B,C → D correctly', () => {
      const nodes = [
        makeNode('A'),
        makeNode('B', ['A']),
        makeNode('C', ['A']),
        makeNode('D', ['B', 'C']),
      ];

      // Initially: A ready, rest blocked
      const state: Record<string, NodeState> = {
        A: makeState('ready'),
        B: makeState('blocked'),
        C: makeState('blocked'),
        D: makeState('blocked'),
      };

      // Iteration 1: A executes
      let actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['A']);

      // A completes
      state.A.status = 'success';

      // Iteration 2: B and C unblock and execute
      actions = nextActions(nodes, state);
      expect(executeIds(actions).sort()).toEqual(['B', 'C']);

      // B and C complete
      state.B.status = 'success';
      state.C.status = 'success';

      // Iteration 3: D unblocks and executes
      actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['D']);

      // D completes
      state.D.status = 'success';

      // Iteration 4: complete
      actions = nextActions(nodes, state);
      expect(completeStatus(actions)).toBe('complete');
    });
  });

  describe('partial failure cascade', () => {
    it('succeeds some, skips downstream of failure', () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C', ['A']), makeNode('D', ['B'])];
      const state: Record<string, NodeState> = {
        A: makeState('success'),
        B: makeState('failure', { attempt: 1, maxRetries: 1 }),
        C: makeState('blocked'),
        D: makeState('blocked'),
      };

      nextActions(nodes, state);
      expect(state.C.status).toBe('ready');
      expect(state.D.status).toBe('skipped');

      state.C.status = 'success';
      const actions = nextActions(nodes, state);
      expect(completeStatus(actions)).toBe('partial');
    });
  });

  describe('complete status determination', () => {
    it('complete when all success', () => {
      const nodes = [makeNode('A'), makeNode('B')];
      const state = { A: makeState('success'), B: makeState('success') };
      expect(completeStatus(nextActions(nodes, state))).toBe('complete');
    });

    it('failed when all failure/skipped', () => {
      const nodes = [makeNode('A'), makeNode('B', ['A'])];
      const state = {
        A: makeState('failure', { attempt: 1, maxRetries: 1 }),
        B: makeState('skipped'),
      };
      expect(completeStatus(nextActions(nodes, state))).toBe('failed');
    });

    it('partial when mix of success and failure', () => {
      const nodes = [makeNode('A'), makeNode('B')];
      const state = {
        A: makeState('success'),
        B: makeState('failure', { attempt: 1, maxRetries: 1 }),
      };
      expect(completeStatus(nextActions(nodes, state))).toBe('partial');
    });
  });

  describe('deadlock detection', () => {
    it('deadlocks when no progress possible and no running nodes', () => {
      // This shouldn't happen with valid DAGs, but the scheduler must detect it
      const nodes = [makeNode('A', ['B']), makeNode('B', ['A'])];
      const state = {
        A: makeState('blocked'),
        B: makeState('blocked'),
      };
      expect(completeStatus(nextActions(nodes, state))).toBe('deadlock');
    });

    it('does not deadlock when nodes are running', () => {
      const nodes = [makeNode('A'), makeNode('B', ['A'])];
      const state = {
        A: makeState('running'),
        B: makeState('blocked'),
      };
      const actions = nextActions(nodes, state);
      expect(actions).toEqual([]); // waiting, not deadlocked
    });
  });

  describe('all-read-only (no branches)', () => {
    it('all nodes ready at start, all execute', () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
      const state = {
        A: makeState('ready'),
        B: makeState('ready'),
        C: makeState('ready'),
      };
      expect(executeIds(nextActions(nodes, state)).sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('verify nodes', () => {
    it('verify treated same as agent by scheduler', () => {
      const nodes = [
        makeNode('A'),
        makeNode('verify:A', ['A'], 'verify'),
        makeNode('B', ['verify:A']),
      ];
      const state: Record<string, NodeState> = {
        A: makeState('success'),
        'verify:A': makeState('blocked', { maxRetries: 3 }),
        B: makeState('blocked'),
      };

      let actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['verify:A']);

      state['verify:A'].status = 'success';
      actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['B']);
    });

    it('verify retry works with maxRetries=3', () => {
      const nodes = [makeNode('V', [], 'verify')];
      const state = {
        V: makeState('failure', { attempt: 1, maxRetries: 3, failureReason: 'verify_failed' }),
      };
      const actions = nextActions(nodes, state);
      expect(state.V.status).toBe('ready');
      expect(executeIds(actions)).toEqual(['V']);
    });
  });

  describe('resume from partial state', () => {
    it('skips success nodes, retries ready nodes', () => {
      const nodes = [makeNode('A'), makeNode('B'), makeNode('C', ['A', 'B'])];
      // Simulates resume: A succeeded, B is ready (was running, reset by loadOrCreateState)
      const state = {
        A: makeState('success'),
        B: makeState('ready'),
        C: makeState('blocked'),
      };
      const actions = nextActions(nodes, state);
      expect(executeIds(actions)).toEqual(['B']);
      // C stays blocked (B not yet success)
      expect(state.C.status).toBe('blocked');
    });
  });

  describe('boundary values', () => {
    it('empty DAG → complete', () => {
      expect(completeStatus(nextActions([], {}))).toBe('complete');
    });

    it('maxRetries=0 → never retries', () => {
      const nodes = [makeNode('A')];
      const state = { A: makeState('failure', { attempt: 0, maxRetries: 0 }) };
      expect(completeStatus(nextActions(nodes, state))).toBe('failed');
    });

    it('clears failureReason on retry', () => {
      const nodes = [makeNode('A')];
      const state = {
        A: makeState('failure', { attempt: 0, maxRetries: 2, failureReason: 'timeout' }),
      };
      nextActions(nodes, state);
      expect(state.A.status).toBe('ready');
      expect(state.A.failureReason).toBeUndefined();
    });
  });
});
