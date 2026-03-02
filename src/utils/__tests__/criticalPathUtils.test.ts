import { describe, it, expect, beforeAll } from 'vitest';
import { computeCriticalPath, computeCriticalPathScoped, computeEarliestStart, wouldCreateCycle, cascadeDependents, cascadeDependentsWithIds, initScheduler } from '../schedulerWasm';
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

  it('standalone task is critical (determines project end)', () => {
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
      makeTask({ id: 'b', startDate: '2026-03-11', endDate: '2026-03-20', duration: 10, dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
    ];
    const critical = computeCriticalPath(tasks);
    expect(critical.has('summary')).toBe(false);
    expect(critical.has('a')).toBe(true);
    expect(critical.has('b')).toBe(true);
  });

  it('scoped critical path highlights full chain within a project', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a1', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9, project: 'Alpha' }),
      makeTask({ id: 'a2', startDate: '2026-03-10', endDate: '2026-03-19', duration: 9, project: 'Alpha', dependencies: [{ fromId: 'a1', toId: 'a2', type: 'FS', lag: 0 }] }),
      makeTask({ id: 'a3', startDate: '2026-03-19', endDate: '2026-03-28', duration: 9, project: 'Alpha', dependencies: [{ fromId: 'a2', toId: 'a3', type: 'FS', lag: 0 }] }),
    ];
    const critical = computeCriticalPathScoped(tasks, { type: 'project', name: 'Alpha' });
    expect(critical.has('a1')).toBe(true);
    expect(critical.has('a2')).toBe(true);
    expect(critical.has('a3')).toBe(true);
  });

  it('scoped workstream critical path does not crash and returns results', () => {
    const tasks: Task[] = [
      makeTask({ id: 'e1', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9, project: 'Alpha', workStream: 'Engineering' }),
      makeTask({ id: 'e2', startDate: '2026-03-10', endDate: '2026-03-19', duration: 9, project: 'Alpha', workStream: 'Engineering', dependencies: [{ fromId: 'e1', toId: 'e2', type: 'FS', lag: 0 }] }),
    ];
    const critical = computeCriticalPathScoped(tasks, { type: 'workstream', name: 'Engineering' });
    expect(critical.has('e1')).toBe(true);
    expect(critical.has('e2')).toBe(true);
  });
});

describe('WASM wrapper safety', () => {
  it('computeEarliestStart returns null for nonexistent task', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
    ];
    const result = computeEarliestStart(tasks, 'nonexistent');
    expect(result).toBeNull();
  });

  it('wouldCreateCycle returns boolean for valid tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
      makeTask({ id: 'b', startDate: '2026-03-10', endDate: '2026-03-19', duration: 9, dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
    ];
    expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(true);
    expect(wouldCreateCycle(tasks, 'b', 'a')).toBe(false);
  });

  it('cascadeDependents returns original tasks when no cascade needed', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
    ];
    const result = cascadeDependents(tasks, 'a', 3);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('cascadeDependentsWithIds returns empty changedIds when no dependents', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
    ];
    const result = cascadeDependentsWithIds(tasks, 'a', 3);
    expect(result.changedIds).toEqual([]);
    expect(result.tasks).toHaveLength(1);
  });

  it('computeCriticalPathScoped returns empty set for nonexistent scope', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9, project: 'Alpha' }),
    ];
    const result = computeCriticalPathScoped(tasks, { type: 'project', name: 'NonExistent' });
    expect(result.size).toBe(0);
  });
});
