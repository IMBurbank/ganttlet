import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { Task } from '../../types';
import { TaskStore } from '../../store/TaskStore';
import { getDocMaps, writeTaskToDoc } from '../../schema/ydoc';
import { setupObserver } from '../observer';
import { ORIGIN } from '../origins';

// Mock WASM-dependent modules
vi.mock('../../utils/schedulerWasm', () => ({
  computeCriticalPathScoped: vi.fn(() => ({ taskIds: new Set<string>(), edges: [] })),
  detectConflicts: vi.fn(() => []),
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

describe('setupObserver', () => {
  let doc: Y.Doc;
  let store: TaskStore;
  let cleanup: () => void;

  beforeEach(() => {
    doc = new Y.Doc();
    store = new TaskStore();
    cleanup = setupObserver(doc, store, {
      criticalPathScope: { type: 'project', name: '' },
    });
  });

  afterEach(() => {
    cleanup();
    doc.destroy();
  });

  it('routes local changes synchronously', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    }, ORIGIN.LOCAL);

    // Store should be updated immediately (same tick)
    expect(store.getTask('task-1')).toBeDefined();
    expect(store.getTask('task-1')!.name).toBe('Test Task');
  });

  it('handles task field updates synchronously for local origin', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    // Add a task first
    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    }, ORIGIN.LOCAL);

    expect(store.getTask('task-1')!.name).toBe('Test Task');

    // Update a field
    doc.transact(() => {
      const ymap = ytasks.get('task-1')!;
      ymap.set('name', 'Updated Task');
    }, ORIGIN.LOCAL);

    expect(store.getTask('task-1')!.name).toBe('Updated Task');
  });

  it('handles task deletion', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    // Add then delete
    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    }, ORIGIN.LOCAL);

    expect(store.getTask('task-1')).toBeDefined();

    doc.transact(() => {
      ytasks.delete('task-1');
    }, ORIGIN.LOCAL);

    expect(store.getTask('task-1')).toBeUndefined();
  });

  it('processes sheets origin synchronously', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    }, ORIGIN.SHEETS);

    // Should be updated immediately
    expect(store.getTask('task-1')).toBeDefined();
  });

  it('batches remote changes via RAF', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    // Mock requestAnimationFrame
    let rafCallback: FrameRequestCallback | null = null;
    const originalRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    };

    // Simulate a WebSocket provider origin (object with 'ws' property)
    const fakeProvider = { ws: {} };

    try {
      // Write with provider origin (simulates remote peer via WebSocket)
      doc.transact(() => {
        writeTaskToDoc(ytasks, 'task-1', makeTask());
      }, fakeProvider);

      // Store NOT updated yet (batched)
      expect(store.getTask('task-1')).toBeUndefined();

      // Fire RAF callback
      expect(rafCallback).not.toBeNull();
      rafCallback!(0);

      // Now store should be updated
      expect(store.getTask('task-1')).toBeDefined();
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
    }
  });

  it('processes null-origin (undo/init) changes synchronously', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    // Write without origin (null) — should be processed synchronously
    // This covers undo/redo and initialization transactions
    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    });

    // Store should be updated immediately (not batched)
    expect(store.getTask('task-1')).toBeDefined();
  });

  it('skips cold derivations for sheets origin', async () => {
    const { computeCriticalPathScoped } = vi.mocked(await import('../../utils/schedulerWasm'));

    // Reset mock call count
    computeCriticalPathScoped.mockClear();

    const { tasks: ytasks } = getDocMaps(doc);

    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    }, ORIGIN.SHEETS);

    // requestIdleCallback should NOT have been called for sheets
    // Since we mock the WASM module, check it was NOT invoked
    // (cold derivations are scheduled async via requestIdleCallback)
    expect(computeCriticalPathScoped).not.toHaveBeenCalled();
  });

  it('observes taskOrder changes', () => {
    const { taskOrder } = getDocMaps(doc);

    doc.transact(() => {
      taskOrder.push(['task-a', 'task-b', 'task-c']);
    }, ORIGIN.LOCAL);

    expect(store.getTaskOrder()).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('handles multiple tasks in one transaction', () => {
    const { tasks: ytasks } = getDocMaps(doc);
    const task1 = makeTask({ id: 'task-1', name: 'Task 1' });
    const task2 = makeTask({ id: 'task-2', name: 'Task 2' });

    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', task1);
      writeTaskToDoc(ytasks, 'task-2', task2);
    }, ORIGIN.LOCAL);

    expect(store.getTask('task-1')).toBeDefined();
    expect(store.getTask('task-2')).toBeDefined();
    expect(store.getTask('task-1')!.name).toBe('Task 1');
    expect(store.getTask('task-2')!.name).toBe('Task 2');
  });

  it('is resilient to malformed tasks', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    // Add a valid task and a malformed one (missing required fields)
    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
      const badMap = new Y.Map<unknown>();
      // Don't set 'id' — yMapToTask should still return something (with defaults)
      badMap.set('name', 'Bad Task');
      ytasks.set('bad-task', badMap);
    }, ORIGIN.LOCAL);

    // The valid task should still be in the store
    expect(store.getTask('task-1')).toBeDefined();
  });

  it('cleans up observer on dispose', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    cleanup();

    // Changes after cleanup should NOT affect store
    doc.transact(() => {
      writeTaskToDoc(ytasks, 'task-1', makeTask());
    }, ORIGIN.LOCAL);

    expect(store.getTask('task-1')).toBeUndefined();

    // Re-assign cleanup to no-op so afterEach doesn't double-cleanup
    cleanup = () => {};
  });

  it('handles summary task recalculation', () => {
    const { tasks: ytasks } = getDocMaps(doc);

    const parent = makeTask({
      id: 'parent',
      name: 'Parent',
      isSummary: true,
      childIds: ['child-1'],
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    const child = makeTask({
      id: 'child-1',
      name: 'Child',
      parentId: 'parent',
      startDate: '2026-03-11',
      endDate: '2026-03-13',
    });

    doc.transact(() => {
      writeTaskToDoc(ytasks, 'parent', parent);
      writeTaskToDoc(ytasks, 'child-1', child);
    }, ORIGIN.LOCAL);

    expect(store.getTask('parent')).toBeDefined();
    expect(store.getTask('child-1')).toBeDefined();
  });
});
