import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { Task } from '../../types';
import { initSchema, taskToYMap, TASK_FIELDS } from '../../schema/ydoc';
import {
  moveTask,
  resizeTask,
  addTask,
  deleteTask,
  reparentTask,
  updateTaskField,
} from '../taskMutations';

// Mock WASM — cascadeDependents returns tasks with shifted dates based on daysDelta
vi.mock('../../utils/schedulerWasm', () => ({
  cascadeDependents: vi.fn((tasks: Task[], _movedId: string, daysDelta: number) => {
    // Simple mock: shift all dependent tasks by daysDelta calendar days
    return tasks.map((t) => {
      const dep = t.dependencies.find((d) => d.fromId === _movedId);
      if (dep && t.id !== _movedId) {
        const start = new Date(t.startDate);
        const end = new Date(t.endDate);
        start.setDate(start.getDate() + daysDelta);
        end.setDate(end.getDate() + daysDelta);
        return {
          ...t,
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
        };
      }
      return t;
    });
  }),
}));

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

describe('moveTask', () => {
  it('updates dates on the moved task', () => {
    const doc = seedDoc([makeTask()]);
    moveTask(doc, 'task-1', '2026-04-01', '2026-04-03');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.get('startDate')).toBe('2026-04-01');
    expect(ymap.get('endDate')).toBe('2026-04-03');
  });

  it('cascades dependents when moving', () => {
    const task1 = makeTask({ id: 'task-1', startDate: '2026-03-11', endDate: '2026-03-13' });
    const task2 = makeTask({
      id: 'task-2',
      startDate: '2026-03-16',
      endDate: '2026-03-18',
      dependencies: [{ fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 }],
    });
    const doc = seedDoc([task1, task2]);

    // Move task-1 forward by 2 days
    moveTask(doc, 'task-1', '2026-03-13', '2026-03-17');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap2 = ytasks.get('task-2')!;
    // task-2 should have been cascaded forward by 2 days
    expect(ymap2.get('startDate')).toBe('2026-03-18');
    expect(ymap2.get('endDate')).toBe('2026-03-20');
  });

  it('no-ops for non-existent task', () => {
    const doc = seedDoc([makeTask()]);
    moveTask(doc, 'nonexistent', '2026-04-01', '2026-04-03');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.get('startDate')).toBe('2026-03-11');
  });

  it('uses local origin for transaction', () => {
    const doc = seedDoc([makeTask()]);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      if (txn.changed.size > 0) origins.push(txn.origin);
    });

    moveTask(doc, 'task-1', '2026-04-01', '2026-04-03');
    expect(origins).toContain('local');
  });
});

describe('resizeTask', () => {
  it('updates only endDate on the resized task', () => {
    const doc = seedDoc([makeTask()]);
    resizeTask(doc, 'task-1', '2026-03-20');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.get('startDate')).toBe('2026-03-11');
    expect(ymap.get('endDate')).toBe('2026-03-20');
  });

  it('cascades dependents when resizing', () => {
    const task1 = makeTask({ id: 'task-1', startDate: '2026-03-11', endDate: '2026-03-13' });
    const task2 = makeTask({
      id: 'task-2',
      startDate: '2026-03-16',
      endDate: '2026-03-18',
      dependencies: [{ fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 }],
    });
    const doc = seedDoc([task1, task2]);

    // Extend task-1 end by 5 calendar days
    resizeTask(doc, 'task-1', '2026-03-18');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap2 = ytasks.get('task-2')!;
    // task-2 should cascade forward by 5 days
    expect(ymap2.get('startDate')).toBe('2026-03-21');
    expect(ymap2.get('endDate')).toBe('2026-03-23');
  });
});

describe('addTask', () => {
  it('creates a new task with UUID and adds to tasks map + taskOrder', () => {
    const doc = new Y.Doc();
    initSchema(doc);

    const id = addTask(doc, { name: 'My Task', startDate: '2026-04-01', endDate: '2026-04-03' });

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskOrder = doc.getArray<string>('taskOrder');

    expect(id).toMatch(/^[0-9a-f]{8}-/); // UUID format
    expect(ytasks.has(id)).toBe(true);
    expect(ytasks.get(id)!.get('name')).toBe('My Task');
    expect(taskOrder.toArray()).toContain(id);
  });

  it('inserts after specified task in taskOrder', () => {
    const doc = seedDoc([makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })]);

    const id = addTask(doc, { name: 'Inserted' }, 'task-1');

    const taskOrder = doc.getArray<string>('taskOrder');
    const order = taskOrder.toArray();
    expect(order.indexOf(id)).toBe(1);
    expect(order.indexOf('task-2')).toBe(2);
  });

  it('updates parent childIds when task has a parent', () => {
    const parent = makeTask({ id: 'parent', childIds: [] });
    const doc = seedDoc([parent]);

    const childId = addTask(doc, { name: 'Child', parentId: 'parent' });

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const parentYmap = ytasks.get('parent')!;
    const childIds = JSON.parse(parentYmap.get('childIds') as string);
    expect(childIds).toContain(childId);
  });

  it('does NOT write duration to Y.Map (computed field)', () => {
    const doc = new Y.Doc();
    initSchema(doc);

    const id = addTask(doc, { name: 'Test', startDate: '2026-04-01', endDate: '2026-04-03' });

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get(id)!;
    expect(ymap.has('duration')).toBe(false);
    // Only TASK_FIELDS should be written (constraintType/constraintDate are optional)
    const keys = new Set(ymap.keys());
    for (const key of keys) {
      expect(TASK_FIELDS).toContain(key);
    }
    expect(keys.has('duration')).toBe(false);
  });
});

describe('deleteTask', () => {
  it('removes task from tasks map and taskOrder', () => {
    const doc = seedDoc([makeTask({ id: 'task-1' })]);

    deleteTask(doc, 'task-1');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskOrder = doc.getArray<string>('taskOrder');
    expect(ytasks.has('task-1')).toBe(false);
    expect(taskOrder.toArray()).not.toContain('task-1');
  });

  it('recursively deletes all descendants', () => {
    const parent = makeTask({ id: 'parent', childIds: ['child-1'] });
    const child = makeTask({ id: 'child-1', parentId: 'parent', childIds: ['grandchild-1'] });
    const grandchild = makeTask({ id: 'grandchild-1', parentId: 'child-1' });
    const doc = seedDoc([parent, child, grandchild]);

    deleteTask(doc, 'parent');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.has('parent')).toBe(false);
    expect(ytasks.has('child-1')).toBe(false);
    expect(ytasks.has('grandchild-1')).toBe(false);
  });

  it('cleans parent childIds on delete', () => {
    const parent = makeTask({ id: 'parent', childIds: ['child-1', 'child-2'] });
    const child1 = makeTask({ id: 'child-1', parentId: 'parent' });
    const child2 = makeTask({ id: 'child-2', parentId: 'parent' });
    const doc = seedDoc([parent, child1, child2]);

    deleteTask(doc, 'child-1');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const parentYmap = ytasks.get('parent')!;
    const childIds = JSON.parse(parentYmap.get('childIds') as string);
    expect(childIds).toEqual(['child-2']);
  });

  it('cleans dependency references in remaining tasks', () => {
    const task1 = makeTask({ id: 'task-1' });
    const task2 = makeTask({
      id: 'task-2',
      dependencies: [{ fromId: 'task-1', toId: 'task-2', type: 'FS', lag: 0 }],
    });
    const doc = seedDoc([task1, task2]);

    deleteTask(doc, 'task-1');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap2 = ytasks.get('task-2')!;
    const deps = JSON.parse(ymap2.get('dependencies') as string);
    expect(deps).toEqual([]);
  });
});

describe('reparentTask', () => {
  it('updates parentId, old/new parent childIds, and taskOrder', () => {
    const oldParent = makeTask({ id: 'old-parent', childIds: ['task-1'] });
    const newParent = makeTask({ id: 'new-parent', childIds: [] });
    const task = makeTask({ id: 'task-1', parentId: 'old-parent' });
    const doc = seedDoc([oldParent, task, newParent]);

    reparentTask(doc, 'task-1', 'new-parent');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.get('task-1')!.get('parentId')).toBe('new-parent');

    const oldChildIds = JSON.parse(ytasks.get('old-parent')!.get('childIds') as string);
    expect(oldChildIds).toEqual([]);

    const newChildIds = JSON.parse(ytasks.get('new-parent')!.get('childIds') as string);
    expect(newChildIds).toContain('task-1');

    // taskOrder: task-1 should be after new-parent
    const taskOrder = doc.getArray<string>('taskOrder');
    const order = taskOrder.toArray();
    expect(order.indexOf('task-1')).toBeGreaterThan(order.indexOf('new-parent'));
  });

  it('works when task has no previous parent', () => {
    const newParent = makeTask({ id: 'new-parent', childIds: [] });
    const task = makeTask({ id: 'task-1', parentId: null });
    const doc = seedDoc([newParent, task]);

    reparentTask(doc, 'task-1', 'new-parent');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.get('task-1')!.get('parentId')).toBe('new-parent');
    const newChildIds = JSON.parse(ytasks.get('new-parent')!.get('childIds') as string);
    expect(newChildIds).toContain('task-1');
  });
});

describe('updateTaskField', () => {
  it('updates a simple string field', () => {
    const doc = seedDoc([makeTask()]);
    updateTaskField(doc, 'task-1', 'name', 'Updated Name');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.get('task-1')!.get('name')).toBe('Updated Name');
  });

  it('updates a boolean field', () => {
    const doc = seedDoc([makeTask()]);
    updateTaskField(doc, 'task-1', 'done', true);

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.get('task-1')!.get('done')).toBe(true);
  });

  it('JSON-stringifies array fields (childIds, dependencies, okrs)', () => {
    const doc = seedDoc([makeTask()]);
    updateTaskField(doc, 'task-1', 'childIds', ['child-a', 'child-b']);

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.get('task-1')!.get('childIds')).toBe('["child-a","child-b"]');
  });

  it('no-ops for non-existent task', () => {
    const doc = seedDoc([makeTask()]);
    updateTaskField(doc, 'nonexistent', 'name', 'Nope');
    // No error thrown
  });

  it('uses local origin', () => {
    const doc = seedDoc([makeTask()]);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      if (txn.changed.size > 0) origins.push(txn.origin);
    });

    updateTaskField(doc, 'task-1', 'name', 'New');
    expect(origins).toContain('local');
  });
});
