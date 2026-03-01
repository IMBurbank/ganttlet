import { describe, it, expect } from 'vitest';
import { computeCriticalPath } from '../criticalPathUtils';
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
    isExpanded: false,
    isHidden: false,
    notes: '',
    okrs: [],
    ...overrides,
  };
}

describe('criticalPathUtils', () => {
  it('returns empty set for empty tasks', () => {
    expect(computeCriticalPath([])).toEqual(new Set());
  });

  it('returns empty set for only summary tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 'summary', isSummary: true }),
    ];
    expect(computeCriticalPath(tasks)).toEqual(new Set());
  });

  it('marks single task as critical', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('a')).toBe(true);
  });

  it('identifies critical path in linear FS chain', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
      makeTask({ id: 'b', startDate: '2026-03-10', endDate: '2026-03-19', duration: 9, dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
      makeTask({ id: 'c', startDate: '2026-03-19', endDate: '2026-03-28', duration: 9, dependencies: [{ fromId: 'b', toId: 'c', type: 'FS', lag: 0 }] }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('a')).toBe(true);
    expect(critical.has('b')).toBe(true);
    expect(critical.has('c')).toBe(true);
  });

  it('identifies non-critical tasks with float', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 10 }),
      makeTask({ id: 'b', startDate: '2026-03-11', endDate: '2026-03-20', duration: 10, dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
      makeTask({ id: 'c', startDate: '2026-03-01', endDate: '2026-03-05', duration: 5 }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('a')).toBe(true);
    expect(critical.has('b')).toBe(true);
    expect(critical.has('c')).toBe(false);
  });

  it('handles SS dependency in CPM', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 10 }),
      makeTask({ id: 'b', startDate: '2026-03-06', endDate: '2026-03-15', duration: 10, dependencies: [{ fromId: 'a', toId: 'b', type: 'SS', lag: 5 }] }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('a')).toBe(true);
    expect(critical.has('b')).toBe(true);
  });

  it('handles FF dependency in CPM', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 10 }),
      makeTask({ id: 'b', startDate: '2026-03-01', endDate: '2026-03-10', duration: 10, dependencies: [{ fromId: 'a', toId: 'b', type: 'FF', lag: 0 }] }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('a')).toBe(true);
    expect(critical.has('b')).toBe(true);
  });

  it('includes milestones on the critical path', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 10 }),
      makeTask({ id: 'ms', startDate: '2026-03-10', endDate: '2026-03-10', duration: 0, isMilestone: true, dependencies: [{ fromId: 'a', toId: 'ms', type: 'FS', lag: 0 }] }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('a')).toBe(true);
    expect(critical.has('ms')).toBe(true);
  });

  it('excludes summary tasks from critical path', () => {
    const tasks: Task[] = [
      makeTask({ id: 'summary', isSummary: true, childIds: ['a'] }),
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 10, parentId: 'summary' }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('summary')).toBe(false);
    expect(critical.has('a')).toBe(true);
  });
});
