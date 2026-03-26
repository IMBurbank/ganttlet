import { describe, it, expect } from 'vitest';
import { recalcSummaryDates } from '../summaryUtils';
import type { Task } from '../../types';

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

describe('summaryUtils', () => {
  describe('recalcSummaryDates', () => {
    it('sets summary dates to span its children', () => {
      const tasks: Task[] = [
        makeTask({
          id: 'parent',
          isSummary: true,
          childIds: ['c1', 'c2'],
          startDate: '2026-01-01',
          endDate: '2026-01-01',
        }),
        makeTask({ id: 'c1', parentId: 'parent', startDate: '2026-03-01', endDate: '2026-03-10' }),
        makeTask({ id: 'c2', parentId: 'parent', startDate: '2026-03-05', endDate: '2026-03-20' }),
      ];
      const result = recalcSummaryDates(tasks);
      const parent = result.find((t) => t.id === 'parent')!;
      expect(parent.startDate).toBe('2026-03-01');
      expect(parent.endDate).toBe('2026-03-20');
    });

    it('marks summary as done when all children are done', () => {
      const tasks: Task[] = [
        makeTask({ id: 'parent', isSummary: true, childIds: ['c1', 'c2'] }),
        makeTask({ id: 'c1', parentId: 'parent', done: true }),
        makeTask({ id: 'c2', parentId: 'parent', done: true }),
      ];
      const result = recalcSummaryDates(tasks);
      const parent = result.find((t) => t.id === 'parent')!;
      expect(parent.done).toBe(true);
    });

    it('marks summary as not done when any child is not done', () => {
      const tasks: Task[] = [
        makeTask({ id: 'parent', isSummary: true, childIds: ['c1', 'c2'], done: true }),
        makeTask({ id: 'c1', parentId: 'parent', done: true }),
        makeTask({ id: 'c2', parentId: 'parent', done: false }),
      ];
      const result = recalcSummaryDates(tasks);
      const parent = result.find((t) => t.id === 'parent')!;
      expect(parent.done).toBe(false);
    });
  });
});
