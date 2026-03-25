import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { Task } from '../../types';
import { initSchema, taskToYMap } from '../../schema/ydoc';
import { setConstraint } from '../constraintMutations';

// Mock WASM — cascadeDependents shifts dependent tasks by daysDelta
vi.mock('../../utils/schedulerWasm', () => ({
  cascadeDependents: vi.fn((tasks: Task[], _movedId: string, daysDelta: number) => {
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

describe('setConstraint', () => {
  it('sets constraintType and constraintDate on a task', () => {
    const doc = seedDoc([makeTask({ id: 'task-1' })]);

    setConstraint(doc, 'task-1', 'SNET', '2026-04-01');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.get('constraintType')).toBe('SNET');
    expect(ymap.get('constraintDate')).toBe('2026-04-01');
  });

  it('clears constraintDate when not provided', () => {
    const doc = seedDoc([
      makeTask({ id: 'task-1', constraintType: 'SNET', constraintDate: '2026-04-01' }),
    ]);

    setConstraint(doc, 'task-1', 'ASAP');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.get('constraintType')).toBe('ASAP');
    expect(ymap.has('constraintDate')).toBe(false);
  });

  it('clears constraintType when set to undefined', () => {
    const doc = seedDoc([
      makeTask({ id: 'task-1', constraintType: 'SNET', constraintDate: '2026-04-01' }),
    ]);

    setConstraint(doc, 'task-1', undefined);

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.has('constraintType')).toBe(false);
    expect(ymap.has('constraintDate')).toBe(false);
  });

  it('no-ops for non-existent task', () => {
    const doc = seedDoc([makeTask()]);
    setConstraint(doc, 'nonexistent', 'SNET', '2026-04-01');
    // No error thrown
  });

  it('uses local origin for transaction', () => {
    const doc = seedDoc([makeTask({ id: 'task-1' })]);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      if (txn.changed.size > 0) origins.push(txn.origin);
    });

    setConstraint(doc, 'task-1', 'SNET', '2026-04-01');
    expect(origins).toContain('local');
  });

  it('still writes constraint when WASM cascade fails', async () => {
    const { cascadeDependents } = await import('../../utils/schedulerWasm');
    vi.mocked(cascadeDependents).mockImplementationOnce(() => {
      throw new Error('WASM panic');
    });

    const doc = seedDoc([makeTask({ id: 'task-1' })]);
    setConstraint(doc, 'task-1', 'FNLT', '2026-05-01');

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const ymap = ytasks.get('task-1')!;
    expect(ymap.get('constraintType')).toBe('FNLT');
    expect(ymap.get('constraintDate')).toBe('2026-05-01');
  });
});
