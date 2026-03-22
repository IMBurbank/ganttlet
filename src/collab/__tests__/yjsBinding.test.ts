import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { Task } from '../../types';
import { applyTasksToYjs, applyActionToYjs, bindYjsToDispatch } from '../yjsBinding';

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

// Mock the WASM scheduler — not needed for these tests
vi.mock('../../utils/schedulerWasm', () => ({
  cascadeDependents: vi.fn((tasks: Task[]) => tasks),
}));

describe('T1.3 — isLocalUpdate scoped per Y.Doc', () => {
  it('applyTasksToYjs on doc A does not suppress doc B observer', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const dispatchB = vi.fn();

    // Bind observer on doc B
    const cleanup = bindYjsToDispatch(docB, dispatchB);

    // Apply tasks to doc A (sets local flag for A only)
    applyTasksToYjs(docA, [makeTask({ id: 'a1' })]);

    // Now modify doc B externally — observer should fire
    docB.transact(() => {
      const yarray = docB.getArray<Y.Map<unknown>>('tasks');
      const ymap = new Y.Map<unknown>();
      ymap.set('id', 'b1');
      ymap.set('name', 'Remote Task');
      ymap.set('startDate', '2026-03-11');
      ymap.set('endDate', '2026-03-13');
      ymap.set('duration', 3);
      ymap.set('owner', '');
      ymap.set('workStream', '');
      ymap.set('project', '');
      ymap.set('functionalArea', '');
      ymap.set('done', false);
      ymap.set('description', '');
      ymap.set('isMilestone', false);
      ymap.set('isSummary', false);
      ymap.set('parentId', null);
      ymap.set('childIds', '[]');
      ymap.set('dependencies', '[]');
      ymap.set('isExpanded', true);
      ymap.set('isHidden', false);
      ymap.set('notes', '');
      ymap.set('okrs', '[]');
      yarray.push([ymap]);
    });

    expect(dispatchB).toHaveBeenCalled();
    const action = dispatchB.mock.calls[0][0];
    expect(action.type).toBe('SET_TASKS');
    expect(action.source).toBe('yjs');

    cleanup();
  });

  it('MOVE_TASK on doc A does not suppress doc B observer', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Set up doc A with a task
    applyTasksToYjs(docA, [makeTask({ id: 'shared-1' })]);

    // Bind observer on doc B
    const dispatchB = vi.fn();
    const cleanup = bindYjsToDispatch(docB, dispatchB);

    // Apply MOVE_TASK to doc A
    applyActionToYjs(docA, {
      type: 'MOVE_TASK',
      taskId: 'shared-1',
      newStartDate: '2026-04-01',
      newEndDate: '2026-04-05',
    });

    // Modify doc B — observer should fire (not suppressed by A's local flag)
    docB.transact(() => {
      const yarray = docB.getArray<Y.Map<unknown>>('tasks');
      const ymap = new Y.Map<unknown>();
      ymap.set('id', 'b-task');
      ymap.set('name', 'B Task');
      ymap.set('startDate', '2026-03-11');
      ymap.set('endDate', '2026-03-13');
      ymap.set('duration', 3);
      ymap.set('owner', '');
      ymap.set('workStream', '');
      ymap.set('project', '');
      ymap.set('functionalArea', '');
      ymap.set('done', false);
      ymap.set('description', '');
      ymap.set('isMilestone', false);
      ymap.set('isSummary', false);
      ymap.set('parentId', null);
      ymap.set('childIds', '[]');
      ymap.set('dependencies', '[]');
      ymap.set('isExpanded', true);
      ymap.set('isHidden', false);
      ymap.set('notes', '');
      ymap.set('okrs', '[]');
      yarray.push([ymap]);
    });

    expect(dispatchB).toHaveBeenCalled();
    cleanup();
  });

  it('local applyTasksToYjs suppresses own doc observer', () => {
    const doc = new Y.Doc();
    const dispatch = vi.fn();

    const cleanup = bindYjsToDispatch(doc, dispatch);

    // This is a local update — observer should NOT fire
    applyTasksToYjs(doc, [makeTask({ id: 'local-1' })]);

    expect(dispatch).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('applyActionToYjs ignores SET_TASKS (dead code removed)', () => {
  it('SET_TASKS action is a no-op — does not modify Yjs doc', () => {
    const doc = new Y.Doc();
    applyTasksToYjs(doc, [makeTask({ id: 'existing-1' })]);

    const yarray = doc.getArray<Y.Map<unknown>>('tasks');
    const beforeLength = yarray.length;

    // Calling applyActionToYjs with SET_TASKS should NOT modify the doc
    applyActionToYjs(doc, {
      type: 'SET_TASKS',
      tasks: [makeTask({ id: 'new-1' }), makeTask({ id: 'new-2' })],
    });

    expect(yarray.length).toBe(beforeLength);
  });
});

describe('T2.4 — SET_TASKS dispatch includes source: yjs', () => {
  it('bindYjsToDispatch observer dispatches SET_TASKS with source yjs', () => {
    const doc = new Y.Doc();
    const dispatch = vi.fn();
    const cleanup = bindYjsToDispatch(doc, dispatch);

    // Simulate remote change (not through applyTasksToYjs)
    doc.transact(() => {
      const yarray = doc.getArray<Y.Map<unknown>>('tasks');
      const ymap = new Y.Map<unknown>();
      ymap.set('id', 'remote-1');
      ymap.set('name', 'Remote');
      ymap.set('startDate', '2026-03-11');
      ymap.set('endDate', '2026-03-13');
      ymap.set('duration', 3);
      ymap.set('owner', '');
      ymap.set('workStream', '');
      ymap.set('project', '');
      ymap.set('functionalArea', '');
      ymap.set('done', false);
      ymap.set('description', '');
      ymap.set('isMilestone', false);
      ymap.set('isSummary', false);
      ymap.set('parentId', null);
      ymap.set('childIds', '[]');
      ymap.set('dependencies', '[]');
      ymap.set('isExpanded', true);
      ymap.set('isHidden', false);
      ymap.set('notes', '');
      ymap.set('okrs', '[]');
      yarray.push([ymap]);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe('SET_TASKS');
    expect(action.source).toBe('yjs');

    cleanup();
  });
});
