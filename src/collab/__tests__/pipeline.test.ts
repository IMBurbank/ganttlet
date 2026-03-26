import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { TaskStore } from '../../store/TaskStore';
import { setupObserver } from '../observer';
import { initSchema, taskToYMap } from '../../schema/ydoc';
import type { Task } from '../../types';

// Mock WASM scheduler functions
vi.mock('../../utils/schedulerWasm', () => ({
  cascadeDependents: vi.fn(() => []),
  computeCriticalPathScoped: vi.fn(() => ({ taskIds: new Set(), edges: [] })),
  detectConflicts: vi.fn(() => []),
  recalculateEarliest: vi.fn(() => []),
}));

// Mock summaryUtils to avoid complex date logic in pipeline tests
vi.mock('../../utils/summaryUtils', () => ({
  recalcSummaryDates: vi.fn((tasks: Task[]) => tasks),
}));

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

describe('Observer pipeline integration', () => {
  let doc: Y.Doc;
  let taskStore: TaskStore;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    // Polyfill requestAnimationFrame for jsdom
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) =>
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline), 16)
    );

    doc = new Y.Doc();
    taskStore = new TaskStore();
    initSchema(doc);

    cleanup = setupObserver(doc, taskStore, {
      criticalPathScope: { type: 'project', name: 'Alpha' },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('local mutation -> immediate store update', () => {
    const task = makeTask('t1');
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;

    doc.transact(() => {
      ytasks.set('t1', taskToYMap(task));
    }, 'local');

    // Should be available immediately (same tick)
    const stored = taskStore.getTask('t1');
    expect(stored).toBeDefined();
    expect(stored!.id).toBe('t1');
    expect(stored!.name).toBe('Task t1');
  });

  it('remote mutation -> batched via RAF', () => {
    const task = makeTask('t2');
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;

    // No origin = remote
    doc.transact(() => {
      ytasks.set('t2', taskToYMap(task));
    });

    // Should NOT be available immediately
    expect(taskStore.getTask('t2')).toBeUndefined();

    // After RAF fires (16ms)
    vi.advanceTimersByTime(16);
    const stored = taskStore.getTask('t2');
    expect(stored).toBeDefined();
    expect(stored!.id).toBe('t2');
  });

  it('sheets mutation -> immediate, no cold derivations', async () => {
    const { computeCriticalPathScoped } = await import('../../utils/schedulerWasm');
    const cpMock = vi.mocked(computeCriticalPathScoped);
    cpMock.mockClear();

    const task = makeTask('t3');
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;

    doc.transact(() => {
      ytasks.set('t3', taskToYMap(task));
    }, 'sheets');

    // Should be available immediately
    expect(taskStore.getTask('t3')).toBeDefined();

    // Cold derivations should NOT be scheduled (no computeCriticalPathScoped call)
    vi.advanceTimersByTime(100);
    expect(cpMock).not.toHaveBeenCalled();
  });

  it('delete propagates', () => {
    const task = makeTask('t4');
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;

    // Add task locally first
    doc.transact(() => {
      ytasks.set('t4', taskToYMap(task));
    }, 'local');
    expect(taskStore.getTask('t4')).toBeDefined();

    // Delete it
    doc.transact(() => {
      ytasks.delete('t4');
    }, 'local');
    expect(taskStore.getTask('t4')).toBeUndefined();
  });

  it('multiple remote changes batch correctly', () => {
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;

    // Add 3 tasks in separate remote transactions
    doc.transact(() => {
      ytasks.set('r1', taskToYMap(makeTask('r1')));
    });
    doc.transact(() => {
      ytasks.set('r2', taskToYMap(makeTask('r2')));
    });
    doc.transact(() => {
      ytasks.set('r3', taskToYMap(makeTask('r3')));
    });

    // None available yet
    expect(taskStore.getTask('r1')).toBeUndefined();
    expect(taskStore.getTask('r2')).toBeUndefined();
    expect(taskStore.getTask('r3')).toBeUndefined();

    // After one RAF, all 3 appear
    vi.advanceTimersByTime(16);
    expect(taskStore.getTask('r1')).toBeDefined();
    expect(taskStore.getTask('r2')).toBeDefined();
    expect(taskStore.getTask('r3')).toBeDefined();
  });

  it('undo origin marks transaction with UndoManager instance', () => {
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const undoManager = new Y.UndoManager(ytasks, { trackedOrigins: new Set(['local']) });

    // Track transaction origins
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn: Y.Transaction) => {
      origins.push(txn.origin);
    });

    // Make a local edit
    doc.transact(() => {
      ytasks.set('u1', taskToYMap(makeTask('u1')));
    }, 'local');

    origins.length = 0; // Clear previous origins

    // Undo it
    undoManager.undo();

    // The undo transaction's origin should be the UndoManager instance
    expect(origins.length).toBeGreaterThan(0);
    expect(origins[0]).toBe(undoManager);
  });
});
