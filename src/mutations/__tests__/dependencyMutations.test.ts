import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { Task, Dependency } from '../../types';
import { initSchema, taskToYMap } from '../../schema/ydoc';
import { addDependency, updateDependency, removeDependency } from '../dependencyMutations';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    startDate: '2026-03-11',
    endDate: '2026-03-13',
    duration: 3,
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
    isExpanded: true,
    isHidden: false,
    notes: '',
    okrs: [],
    ...overrides,
  };
}

function seedDoc(tasks: Task[]): Y.Doc {
  const doc = new Y.Doc();
  const { tasks: ytasks, taskOrder } = initSchema(doc);
  doc.transact(() => {
    for (const task of tasks) {
      ytasks.set(task.id, taskToYMap(task));
      taskOrder.push([task.id]);
    }
  });
  return doc;
}

function getDeps(doc: Y.Doc, taskId: string): Dependency[] {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId)!;
  const raw = ymap.get('dependencies') as string;
  return JSON.parse(raw);
}

describe('addDependency', () => {
  it('adds a dependency to an empty array', () => {
    const doc = seedDoc([makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })]);
    const dep: Dependency = { fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 };

    addDependency(doc, 'task-2', dep);

    const deps = getDeps(doc, 'task-2');
    expect(deps).toEqual([dep]);
  });

  it('appends to existing dependencies', () => {
    const existing: Dependency = { fromId: 'task-0', toId: 'task-2', type: 'FS', lag: 0 };
    const doc = seedDoc([
      makeTask({ id: 'task-0' }),
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', dependencies: [existing] }),
    ]);
    const newDep: Dependency = { fromId: 'task-1', toId: 'task-2', type: 'SS', lag: 2 };

    addDependency(doc, 'task-2', newDep);

    const deps = getDeps(doc, 'task-2');
    expect(deps).toHaveLength(2);
    expect(deps[0]).toEqual(existing);
    expect(deps[1]).toEqual(newDep);
  });

  it('no-ops for non-existent task', () => {
    const doc = seedDoc([makeTask()]);
    addDependency(doc, 'nonexistent', { fromId: 'a', toId: 'b', type: 'FS', lag: 0 });
    // No error thrown
  });

  it('uses local origin', () => {
    const doc = seedDoc([makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })]);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      if (txn.changed.size > 0) origins.push(txn.origin);
    });

    addDependency(doc, 'task-2', { fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 });
    expect(origins).toContain('local');
  });
});

describe('updateDependency', () => {
  it('updates type and lag of an existing dependency', () => {
    const dep: Dependency = { fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 };
    const doc = seedDoc([
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', dependencies: [dep] }),
    ]);

    updateDependency(doc, 'task-2', 'task-1', { type: 'SS', lag: 3 });

    const deps = getDeps(doc, 'task-2');
    expect(deps).toHaveLength(1);
    expect(deps[0].type).toBe('SS');
    expect(deps[0].lag).toBe(3);
    expect(deps[0].fromId).toBe('task-1');
  });

  it('only updates the matching dependency', () => {
    const dep1: Dependency = { fromId: 'task-1', toId: 'task-3', type: 'FS', lag: 0 };
    const dep2: Dependency = { fromId: 'task-2', toId: 'task-3', type: 'FF', lag: 1 };
    const doc = seedDoc([
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2' }),
      makeTask({ id: 'task-3', dependencies: [dep1, dep2] }),
    ]);

    updateDependency(doc, 'task-3', 'task-1', { lag: 5 });

    const deps = getDeps(doc, 'task-3');
    expect(deps).toHaveLength(2);
    expect(deps[0].lag).toBe(5);
    expect(deps[0].type).toBe('FS'); // unchanged
    expect(deps[1]).toEqual(dep2); // untouched
  });

  it('no-ops for non-existent task', () => {
    const doc = seedDoc([makeTask()]);
    updateDependency(doc, 'nonexistent', 'a', { type: 'FF' });
    // No error thrown
  });
});

describe('removeDependency', () => {
  it('removes a dependency by fromId', () => {
    const dep: Dependency = { fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 };
    const doc = seedDoc([
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', dependencies: [dep] }),
    ]);

    removeDependency(doc, 'task-2', 'task-1');

    const deps = getDeps(doc, 'task-2');
    expect(deps).toEqual([]);
  });

  it('only removes the matching dependency', () => {
    const dep1: Dependency = { fromId: 'task-1', toId: 'task-3', type: 'FS', lag: 0 };
    const dep2: Dependency = { fromId: 'task-2', toId: 'task-3', type: 'FF', lag: 1 };
    const doc = seedDoc([
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2' }),
      makeTask({ id: 'task-3', dependencies: [dep1, dep2] }),
    ]);

    removeDependency(doc, 'task-3', 'task-1');

    const deps = getDeps(doc, 'task-3');
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual(dep2);
  });

  it('no-ops when fromId not found', () => {
    const dep: Dependency = { fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 };
    const doc = seedDoc([
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', dependencies: [dep] }),
    ]);

    removeDependency(doc, 'task-2', 'nonexistent');

    const deps = getDeps(doc, 'task-2');
    expect(deps).toHaveLength(1);
  });

  it('no-ops for non-existent task', () => {
    const doc = seedDoc([makeTask()]);
    removeDependency(doc, 'nonexistent', 'a');
    // No error thrown
  });
});
