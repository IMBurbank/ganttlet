import { describe, it, expect, vi } from 'vitest';
import { TaskStore } from '../TaskStore';
import type { Task } from '../../types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    startDate: '2026-03-25',
    endDate: '2026-03-31',
    duration: 5,
    owner: 'alice',
    workStream: 'ws-1',
    project: 'proj-1',
    functionalArea: 'eng',
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

describe('TaskStore', () => {
  it('stores and retrieves tasks', () => {
    const store = new TaskStore();
    const task = makeTask({ id: 'a' });
    store.batchUpdate(new Map([['a', task]]), new Set());
    expect(store.getTask('a')).toBe(task);
    expect(store.getTask('nonexistent')).toBeUndefined();
  });

  it('getAllTasks returns the internal map', () => {
    const store = new TaskStore();
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', name: 'B' });
    store.batchUpdate(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      new Set()
    );
    const all = store.getAllTasks();
    expect(all.size).toBe(2);
    expect(all.get('a')).toBe(a);
  });

  it('getAllTasksArray returns array of tasks', () => {
    const store = new TaskStore();
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    store.batchUpdate(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      new Set()
    );
    expect(store.getAllTasksArray()).toHaveLength(2);
  });

  it('batchUpdate notifies only changed task listeners (O(1) verification)', () => {
    const store = new TaskStore();
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    store.batchUpdate(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      new Set()
    );

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    store.subscribe('a', listenerA);
    store.subscribe('b', listenerB);

    // Update only task B
    const bUpdated = makeTask({ id: 'b', name: 'Updated B' });
    store.batchUpdate(new Map([['b', bUpdated]]), new Set());

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it('batchUpdate notifies deleted task listeners', () => {
    const store = new TaskStore();
    const a = makeTask({ id: 'a' });
    store.batchUpdate(new Map([['a', a]]), new Set());

    const listener = vi.fn();
    store.subscribe('a', listener);

    store.batchUpdate(new Map(), new Set(['a']));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getTask('a')).toBeUndefined();
  });

  it('batchUpdate notifies global listeners on any change', () => {
    const store = new TaskStore();
    const globalListener = vi.fn();
    store.subscribeGlobal(globalListener);

    const a = makeTask({ id: 'a' });
    store.batchUpdate(new Map([['a', a]]), new Set());
    expect(globalListener).toHaveBeenCalledTimes(1);
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = new TaskStore();
    const listener = vi.fn();
    const unsub = store.subscribe('a', listener);

    store.batchUpdate(new Map([['a', makeTask({ id: 'a' })]]), new Set());
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.batchUpdate(new Map([['a', makeTask({ id: 'a', name: 'v2' })]]), new Set());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribeGlobal returns an unsubscribe function', () => {
    const store = new TaskStore();
    const listener = vi.fn();
    const unsub = store.subscribeGlobal(listener);

    store.batchUpdate(new Map([['a', makeTask({ id: 'a' })]]), new Set());
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.batchUpdate(new Map([['a', makeTask({ id: 'a', name: 'v2' })]]), new Set());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('taskOrder can be set and retrieved', () => {
    const store = new TaskStore();
    store.setTaskOrder(['a', 'b', 'c']);
    expect(store.getTaskOrder()).toEqual(['a', 'b', 'c']);
  });

  it('setTaskOrder notifies global listeners', () => {
    const store = new TaskStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);

    store.setTaskOrder(['x', 'y']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setDerived updates critical path and conflicts', () => {
    const store = new TaskStore();
    const cp = new Set(['a', 'b']);
    const cf = new Map([['c', 'constraint violation']]);
    store.setDerived(cp, cf);

    expect(store.getCriticalPath()).toBe(cp);
    expect(store.getConflicts()).toBe(cf);
  });

  it('setDerived notifies global listeners', () => {
    const store = new TaskStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);

    store.setDerived(new Set(), new Map());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('multiple listeners on the same task all fire', () => {
    const store = new TaskStore();
    const l1 = vi.fn();
    const l2 = vi.fn();
    store.subscribe('a', l1);
    store.subscribe('a', l2);

    store.batchUpdate(new Map([['a', makeTask({ id: 'a' })]]), new Set());
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it('handles batch with both changed and deleted tasks', () => {
    const store = new TaskStore();
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    store.batchUpdate(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      new Set()
    );

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    store.subscribe('a', listenerA);
    store.subscribe('b', listenerB);

    // Update a, delete b
    const aUpdated = makeTask({ id: 'a', name: 'Updated' });
    store.batchUpdate(new Map([['a', aUpdated]]), new Set(['b']));

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(store.getTask('a')?.name).toBe('Updated');
    expect(store.getTask('b')).toBeUndefined();
  });
});
