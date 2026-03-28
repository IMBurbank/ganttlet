import { describe, it, expect } from 'vitest';
import { getVisibleTasks } from '../layoutUtils';
import type { Task } from '../../types';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: `Task ${id}`,
    startDate: '2025-01-06',
    endDate: '2025-01-10',
    duration: 5,
    owner: 'Alice',
    workStream: 'Engineering',
    project: 'Alpha',
    functionalArea: 'Backend',
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

/**
 * Hierarchy:
 *   root (summary, children: [parent])
 *     parent (summary, children: [child1, child2])
 *       child1
 *       child2
 *   standalone
 */
function makeHierarchy(): Task[] {
  return [
    makeTask('root', { isSummary: true, childIds: ['parent'], name: 'Root Summary' }),
    makeTask('parent', {
      isSummary: true,
      parentId: 'root',
      childIds: ['child1', 'child2'],
      name: 'Parent Summary',
    }),
    makeTask('child1', { parentId: 'parent', name: 'Alpha Child' }),
    makeTask('child2', { parentId: 'parent', name: 'Beta Child' }),
    makeTask('standalone', { name: 'Standalone Task' }),
  ];
}

describe('getVisibleTasks', () => {
  it('all tasks visible when no collapsed set', () => {
    const tasks = makeHierarchy();
    const result = getVisibleTasks(tasks, '');
    expect(result).toHaveLength(5);
    expect(result.map((t) => t.id)).toEqual(['root', 'parent', 'child1', 'child2', 'standalone']);
  });

  it('children hidden when parent is in collapsedTasks set', () => {
    const tasks = makeHierarchy();
    const collapsed = new Set(['parent']);
    const result = getVisibleTasks(tasks, '', collapsed);
    const ids = result.map((t) => t.id);
    expect(ids).toContain('root');
    expect(ids).toContain('parent');
    expect(ids).not.toContain('child1');
    expect(ids).not.toContain('child2');
    expect(ids).toContain('standalone');
  });

  it('grandchildren hidden when grandparent is collapsed', () => {
    const tasks = makeHierarchy();
    const collapsed = new Set(['root']);
    const result = getVisibleTasks(tasks, '', collapsed);
    const ids = result.map((t) => t.id);
    expect(ids).toContain('root');
    expect(ids).not.toContain('parent');
    expect(ids).not.toContain('child1');
    expect(ids).not.toContain('child2');
    expect(ids).toContain('standalone');
  });

  it('search query filters by name', () => {
    const tasks = makeHierarchy();
    const result = getVisibleTasks(tasks, 'alpha');
    const ids = result.map((t) => t.id);
    expect(ids).toContain('child1'); // "Alpha Child"
    expect(ids).not.toContain('child2');
    expect(ids).not.toContain('standalone');
  });

  it('search + collapse interaction: collapsed tasks children hidden even if they match search', () => {
    const tasks = makeHierarchy();
    const collapsed = new Set(['parent']);
    // "Alpha" matches child1 which is under collapsed parent
    const result = getVisibleTasks(tasks, 'alpha', collapsed);
    const ids = result.map((t) => t.id);
    expect(ids).not.toContain('child1');
    expect(ids).not.toContain('child2');
  });

  it('summary tasks visible when children match search (even if summary name does not match)', () => {
    const tasks = makeHierarchy();
    // "Alpha" matches child1 but not "Parent Summary"
    const result = getVisibleTasks(tasks, 'alpha');
    const ids = result.map((t) => t.id);
    // Parent Summary should be visible because child1 ("Alpha Child") matches
    expect(ids).toContain('parent');
    expect(ids).toContain('child1');
  });

  it('empty task array returns empty', () => {
    const result = getVisibleTasks([], '');
    expect(result).toEqual([]);
  });

  it('tasks with no parentId are always visible (root level)', () => {
    const tasks = [makeTask('a', { name: 'A' }), makeTask('b', { name: 'B' })];
    const result = getVisibleTasks(tasks, '');
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
