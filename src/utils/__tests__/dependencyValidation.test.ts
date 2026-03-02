import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import { validateDependencyHierarchy, checkMoveConflicts } from '../dependencyValidation';

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

describe('validateDependencyHierarchy', () => {
  it('rejects a project depending on its own descendant', () => {
    const tasks = [
      makeTask({ id: 'root', name: 'Project', isSummary: true, childIds: ['ws'] }),
      makeTask({ id: 'ws', name: 'WS', isSummary: true, parentId: 'root', childIds: ['t1'] }),
      makeTask({ id: 't1', name: 'Task', parentId: 'ws' }),
    ];
    // Trying to make t1 depend on root (root is ancestor of t1)
    const error = validateDependencyHierarchy(tasks, 't1', 'root');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('ANCESTOR_DEPENDENCY');
  });

  it('rejects a task depending on its own ancestor', () => {
    const tasks = [
      makeTask({ id: 'root', name: 'Project', isSummary: true, childIds: ['t1'] }),
      makeTask({ id: 't1', name: 'Task', parentId: 'root' }),
    ];
    // Trying to make root depend on t1 (t1 is descendant of root)
    const error = validateDependencyHierarchy(tasks, 'root', 't1');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('DESCENDANT_DEPENDENCY');
  });

  it('allows cross-project dependencies', () => {
    const tasks = [
      makeTask({ id: 'p1', isSummary: true, childIds: ['t1'] }),
      makeTask({ id: 't1', parentId: 'p1' }),
      makeTask({ id: 'p2', isSummary: true, childIds: ['t2'] }),
      makeTask({ id: 't2', parentId: 'p2' }),
    ];
    const error = validateDependencyHierarchy(tasks, 't2', 't1');
    expect(error).toBeNull();
  });

  it('allows cross-workstream dependencies', () => {
    const tasks = [
      makeTask({ id: 'root', isSummary: true, childIds: ['ws1', 'ws2'] }),
      makeTask({ id: 'ws1', isSummary: true, parentId: 'root', childIds: ['a'] }),
      makeTask({ id: 'a', parentId: 'ws1' }),
      makeTask({ id: 'ws2', isSummary: true, parentId: 'root', childIds: ['b'] }),
      makeTask({ id: 'b', parentId: 'ws2' }),
    ];
    const error = validateDependencyHierarchy(tasks, 'b', 'a');
    expect(error).toBeNull();
  });

  it('returns null for unknown task IDs', () => {
    const tasks = [makeTask({ id: 'a' })];
    const error = validateDependencyHierarchy(tasks, 'a', 'nonexistent');
    expect(error).toBeNull();
  });
});

describe('checkMoveConflicts', () => {
  it('detects conflict when task depends on target parent', () => {
    const tasks = [
      makeTask({ id: 'p1', isSummary: true, childIds: ['t1'] }),
      makeTask({ id: 't1', parentId: 'p1', dependencies: [{ fromId: 'p2', toId: 't1', type: 'FS', lag: 0 }] }),
      makeTask({ id: 'p2', isSummary: true, childIds: [] }),
    ];
    // Moving t1 under p2 — t1 depends on p2 (ancestor of target)
    const conflicts = checkMoveConflicts(tasks, 't1', 'p2');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('returns no conflicts when task depends on sibling under target', () => {
    const tasks = [
      makeTask({ id: 'p1', isSummary: true, childIds: ['t1'] }),
      makeTask({ id: 't1', parentId: 'p1', dependencies: [{ fromId: 't2', toId: 't1', type: 'FS', lag: 0 }] }),
      makeTask({ id: 'p2', isSummary: true, childIds: ['t2'] }),
      makeTask({ id: 't2', parentId: 'p2' }),
    ];
    // Moving t1 under p2 — t1 depends on t2 which is a sibling, not p2 itself
    const conflicts = checkMoveConflicts(tasks, 't1', 'p2');
    expect(conflicts.length).toBe(0);
  });

  it('detects conflict when ancestor depends on moving task', () => {
    const tasks = [
      makeTask({ id: 'p1', isSummary: true, childIds: ['t1'] }),
      makeTask({ id: 't1', parentId: 'p1' }),
      makeTask({ id: 'p2', isSummary: true, childIds: [], dependencies: [{ fromId: 't1', toId: 'p2', type: 'FS', lag: 0 }] }),
    ];
    // Moving t1 under p2 — p2 depends on t1 which is being moved
    const conflicts = checkMoveConflicts(tasks, 't1', 'p2');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('returns empty when unknown tasks', () => {
    const tasks = [makeTask({ id: 'a' })];
    const conflicts = checkMoveConflicts(tasks, 'nonexistent', 'a');
    expect(conflicts).toEqual([]);
  });
});
