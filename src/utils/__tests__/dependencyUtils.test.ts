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
    isExpanded: false,
    isHidden: false,
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
    it('shifts dependent tasks by delta', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({ id: 'b', startDate: '2026-03-11', endDate: '2026-03-20', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
      ];
      const result = cascadeDependents(tasks, 'a', 5);
      const b = result.find(t => t.id === 'b')!;
      // delta=5 is now business days: Wed Mar 11 + 5 biz = Wed Mar 18, Fri Mar 20 + 5 biz = Fri Mar 27
      expect(b.startDate).toBe('2026-03-18');
      expect(b.endDate).toBe('2026-03-27');
    });

    it('does not shift the moved task itself', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({ id: 'b', startDate: '2026-03-11', endDate: '2026-03-20', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
      ];
      const result = cascadeDependents(tasks, 'a', 5);
      const a = result.find(t => t.id === 'a')!;
      expect(a.startDate).toBe('2026-03-01');
    });

    it('cascades through transitive dependencies', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({ id: 'b', startDate: '2026-03-11', endDate: '2026-03-20', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
        makeTask({ id: 'c', startDate: '2026-03-21', endDate: '2026-03-30', dependencies: [{ fromId: 'b', toId: 'c', type: 'FS', lag: 0 }] }),
      ];
      const result = cascadeDependents(tasks, 'a', 3);
      const c = result.find(t => t.id === 'c')!;
      // delta=3 biz days: Sat Mar 21 + 3 biz = Wed Mar 25
      expect(c.startDate).toBe('2026-03-25');
    });

    it('skips summary tasks', () => {
      const tasks: Task[] = [
        makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({ id: 'summary', isSummary: true, startDate: '2026-03-11', endDate: '2026-03-20', dependencies: [{ fromId: 'a', toId: 'summary', type: 'FS', lag: 0 }] }),
      ];
      const result = cascadeDependents(tasks, 'a', 5);
      const summary = result.find(t => t.id === 'summary')!;
      expect(summary.startDate).toBe('2026-03-11');
    });
  });
});
