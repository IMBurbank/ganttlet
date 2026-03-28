import { describe, it, expect, beforeAll } from 'vitest';
import { wouldCreateCycle, cascadeDependents, initScheduler } from '../schedulerWasm';
import type { Task } from '../../types';

beforeAll(async () => {
  await initScheduler();
});

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'test',
    name: 'Test',
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    duration: 7,
    owner: '',
    workStream: '',
    project: '',
    functionalArea: '',
    done: false,
    description: '',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: [],
    dependencies: [],
    notes: '',
    okrs: [],
    ...overrides,
  };
}

describe('dependencyUtils', () => {
  describe('wouldCreateCycle', () => {
    it('returns false for non-cyclic dependency', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
        makeTask({ id: 'c' }),
      ];
      // Adding c -> a (a depends on c) should not create cycle
      expect(wouldCreateCycle(tasks, 'a', 'c')).toBe(false);
    });

    it('returns true for direct cycle', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
      ];
      // Adding b -> a (making a depend on b) would create cycle: a->b->a
      expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(true);
    });

    it('returns true for transitive cycle', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
        makeTask({ id: 'c', dependencies: [{ fromId: 'b', toId: 'c', type: 'FS', lag: 0 }] }),
      ];
      // Adding c -> a (making a depend on c) would create cycle: a->b->c->a
      expect(wouldCreateCycle(tasks, 'a', 'c')).toBe(true);
    });
  });

  describe('cascadeDependents', () => {
    it('shifts dependent tasks when constraint is violated', () => {
      // The moved task (a) must already have its new dates in the tasks array.
      // A moved +5 biz: old end Mar 10 → new end Mar 17 (Tue).
      // FS lag=0: required B.start = fs_successor_start(Mar 17, 0) = Mar 18 (Wed).
      // B starts Mar 11 < Mar 18 → violation. shift = 5 biz days.
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-17' }), // already moved +5 biz
        makeTask({
          id: 'b',
          startDate: '2026-03-11',
          endDate: '2026-03-20',
          dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
        }),
      ];
      const result = cascadeDependents(tasks, 'a', 5);
      const b = result.find((t) => t.id === 'b')!;
      // B shifts to Mar 18, ends add_biz(Mar 20, 5) = Mar 27 (Fri)
      expect(b.startDate).toBe('2026-03-18');
      expect(b.endDate).toBe('2026-03-27');
    });

    it('does not shift the moved task itself', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({
          id: 'b',
          startDate: '2026-03-11',
          endDate: '2026-03-20',
          dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
        }),
      ];
      const result = cascadeDependents(tasks, 'a', 5);
      const a = result.find((t) => t.id === 'a')!;
      expect(a.startDate).toBe('2026-03-01');
    });

    it('cascades through transitive dependencies', () => {
      // A moved +3 biz: old end Mar 10 → new end Mar 13 (Fri).
      // FS lag=0: required B.start = fs_successor_start(Mar 13, 0) = Mar 16 (Mon).
      // B starts Mar 11 < Mar 16 → violation, shift 3 biz.
      // B.new_end = add_biz(Mar 20, 3) = Mar 25 (Wed).
      // C: required = fs_successor_start(Mar 25, 0) = Mar 26 (Thu) > Mar 21 → violation.
      // C shifts to Mar 26.
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-13' }), // already moved +3 biz
        makeTask({
          id: 'b',
          startDate: '2026-03-11',
          endDate: '2026-03-20',
          dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
        }),
        makeTask({
          id: 'c',
          startDate: '2026-03-21',
          endDate: '2026-03-30',
          dependencies: [{ fromId: 'b', toId: 'c', type: 'FS', lag: 0 }],
        }),
      ];
      const result = cascadeDependents(tasks, 'a', 3);
      const c = result.find((t) => t.id === 'c')!;
      // C shifts by minimum needed: starts Thu Mar 26
      expect(c.startDate).toBe('2026-03-26');
    });

    it('skips summary tasks', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({
          id: 'summary',
          isSummary: true,
          startDate: '2026-03-11',
          endDate: '2026-03-20',
          dependencies: [{ fromId: 'a', toId: 'summary', type: 'FS', lag: 0 }],
        }),
      ];
      const result = cascadeDependents(tasks, 'a', 5);
      const summary = result.find((t) => t.id === 'summary')!;
      expect(summary.startDate).toBe('2026-03-11');
    });
  });
});
