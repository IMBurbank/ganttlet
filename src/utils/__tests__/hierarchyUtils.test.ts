import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import {
  getHierarchyRole,
  findProjectAncestor,
  findWorkstreamAncestor,
  getAllDescendantIds,
  isDescendantOf,
  generatePrefixedId,
  computeInheritedFields,
} from '../hierarchyUtils';

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

function buildTaskMap(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map(t => [t.id, t]));
}

describe('getHierarchyRole', () => {
  it('classifies a top-level summary as project', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null });
    const taskMap = buildTaskMap([project]);
    expect(getHierarchyRole(project, taskMap)).toBe('project');
  });

  it('classifies a summary under a project as workstream', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', isSummary: true, parentId: 'root' });
    const taskMap = buildTaskMap([project, ws]);
    expect(getHierarchyRole(ws, taskMap)).toBe('workstream');
  });

  it('classifies a regular task as task', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', isSummary: true, parentId: 'root', childIds: ['t1'] });
    const task = makeTask({ id: 't1', parentId: 'ws' });
    const taskMap = buildTaskMap([project, ws, task]);
    expect(getHierarchyRole(task, taskMap)).toBe('task');
  });

  it('classifies a non-summary child of project as task', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['t1'] });
    const task = makeTask({ id: 't1', parentId: 'root', isSummary: false });
    const taskMap = buildTaskMap([project, task]);
    expect(getHierarchyRole(task, taskMap)).toBe('task');
  });
});

describe('findProjectAncestor', () => {
  it('returns the project ancestor for a deep task', () => {
    const project = makeTask({ id: 'root', name: 'Project', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', isSummary: true, parentId: 'root', childIds: ['t1'] });
    const task = makeTask({ id: 't1', parentId: 'ws' });
    const taskMap = buildTaskMap([project, ws, task]);
    expect(findProjectAncestor(task, taskMap)).toEqual(project);
  });

  it('returns null for a project itself', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null });
    const taskMap = buildTaskMap([project]);
    expect(findProjectAncestor(project, taskMap)).toBeNull();
  });

  it('returns null for a task with no project ancestor', () => {
    const orphan = makeTask({ id: 'orphan', parentId: null });
    const taskMap = buildTaskMap([orphan]);
    expect(findProjectAncestor(orphan, taskMap)).toBeNull();
  });
});

describe('findWorkstreamAncestor', () => {
  it('returns the workstream ancestor for a task', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', name: 'WS', isSummary: true, parentId: 'root', childIds: ['t1'] });
    const task = makeTask({ id: 't1', parentId: 'ws' });
    const taskMap = buildTaskMap([project, ws, task]);
    expect(findWorkstreamAncestor(task, taskMap)).toEqual(ws);
  });

  it('returns null for a workstream itself', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', isSummary: true, parentId: 'root' });
    const taskMap = buildTaskMap([project, ws]);
    expect(findWorkstreamAncestor(ws, taskMap)).toBeNull();
  });
});

describe('getAllDescendantIds', () => {
  it('collects all descendant IDs via BFS', () => {
    const project = makeTask({ id: 'root', isSummary: true, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', isSummary: true, parentId: 'root', childIds: ['t1', 't2'] });
    const t1 = makeTask({ id: 't1', parentId: 'ws' });
    const t2 = makeTask({ id: 't2', parentId: 'ws' });
    const taskMap = buildTaskMap([project, ws, t1, t2]);
    const descendants = getAllDescendantIds('root', taskMap);
    expect(descendants).toEqual(new Set(['ws', 't1', 't2']));
  });

  it('returns empty set for a leaf task', () => {
    const task = makeTask({ id: 't1' });
    const taskMap = buildTaskMap([task]);
    expect(getAllDescendantIds('t1', taskMap).size).toBe(0);
  });
});

describe('isDescendantOf', () => {
  it('returns true for a direct child', () => {
    const parent = makeTask({ id: 'p', childIds: ['c'] });
    const child = makeTask({ id: 'c', parentId: 'p' });
    const taskMap = buildTaskMap([parent, child]);
    expect(isDescendantOf('c', 'p', taskMap)).toBe(true);
  });

  it('returns true for a deep descendant', () => {
    const root = makeTask({ id: 'root', childIds: ['mid'] });
    const mid = makeTask({ id: 'mid', parentId: 'root', childIds: ['leaf'] });
    const leaf = makeTask({ id: 'leaf', parentId: 'mid' });
    const taskMap = buildTaskMap([root, mid, leaf]);
    expect(isDescendantOf('leaf', 'root', taskMap)).toBe(true);
  });

  it('returns false for non-descendants', () => {
    const a = makeTask({ id: 'a', childIds: ['a1'] });
    const a1 = makeTask({ id: 'a1', parentId: 'a' });
    const b = makeTask({ id: 'b' });
    const taskMap = buildTaskMap([a, a1, b]);
    expect(isDescendantOf('b', 'a', taskMap)).toBe(false);
  });
});

describe('generatePrefixedId', () => {
  it('returns prefix-1 when no existing children', () => {
    const parent = makeTask({ id: 'pe', isSummary: true });
    expect(generatePrefixedId(parent, [])).toBe('pe-1');
  });

  it('returns max+1 based on existing children', () => {
    const parent = makeTask({ id: 'pe', isSummary: true });
    const existing = [
      makeTask({ id: 'pe-1' }),
      makeTask({ id: 'pe-5' }),
      makeTask({ id: 'pe-3' }),
    ];
    expect(generatePrefixedId(parent, existing)).toBe('pe-6');
  });

  it('handles gaps correctly', () => {
    const parent = makeTask({ id: 'pe', isSummary: true });
    const existing = [
      makeTask({ id: 'pe-1' }),
      makeTask({ id: 'pe-9' }),
    ];
    expect(generatePrefixedId(parent, existing)).toBe('pe-10');
  });

  it('ignores non-matching IDs', () => {
    const parent = makeTask({ id: 'pe', isSummary: true });
    const existing = [
      makeTask({ id: 'ux-1' }),
      makeTask({ id: 'gtm-2' }),
    ];
    expect(generatePrefixedId(parent, existing)).toBe('pe-1');
  });
});

describe('computeInheritedFields', () => {
  it('returns empty fields when no parent', () => {
    const taskMap = new Map<string, Task>();
    expect(computeInheritedFields(null, taskMap)).toEqual({
      project: '',
      workStream: '',
      okrs: [],
    });
  });

  it('inherits project name from project parent', () => {
    const project = makeTask({ id: 'root', name: 'Q2 Launch', isSummary: true, parentId: null, okrs: ['OKR-1'] });
    const taskMap = buildTaskMap([project]);
    expect(computeInheritedFields('root', taskMap)).toEqual({
      project: 'Q2 Launch',
      workStream: '',
      okrs: ['OKR-1'],
    });
  });

  it('inherits project + workStream from workstream parent', () => {
    const project = makeTask({ id: 'root', name: 'Q2 Launch', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', name: 'Platform', isSummary: true, parentId: 'root', project: 'Q2 Launch', okrs: ['KR-1'] });
    const taskMap = buildTaskMap([project, ws]);
    expect(computeInheritedFields('ws', taskMap)).toEqual({
      project: 'Q2 Launch',
      workStream: 'Platform',
      okrs: ['KR-1'],
    });
  });

  it('inherits fields from regular task parent', () => {
    const project = makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] });
    const ws = makeTask({ id: 'ws', isSummary: true, parentId: 'root', childIds: ['t1'] });
    const t1 = makeTask({ id: 't1', parentId: 'ws', project: 'Proj', workStream: 'WS', okrs: ['KR-A'] });
    const taskMap = buildTaskMap([project, ws, t1]);
    expect(computeInheritedFields('t1', taskMap)).toEqual({
      project: 'Proj',
      workStream: 'WS',
      okrs: ['KR-A'],
    });
  });
});
