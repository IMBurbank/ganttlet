import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { getDocMaps, writeTaskToDoc } from '../../schema/ydoc';
import type { Task } from '../../types';
import { ORIGIN, TRACKED_ORIGINS } from '../origins';

// Mock WASM-dependent modules
vi.mock('../../utils/schedulerWasm', () => ({
  computeCriticalPathScoped: vi.fn(() => ({ taskIds: new Set<string>(), edges: [] })),
  detectConflicts: vi.fn(() => []),
  cascadeDependents: vi.fn(() => []),
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

describe('Y.UndoManager', () => {
  let doc: Y.Doc;
  let undoManager: Y.UndoManager;
  let ytasks: Y.Map<Y.Map<unknown>>;

  beforeEach(() => {
    doc = new Y.Doc();
    const schema = getDocMaps(doc);
    ytasks = schema.tasks;
    undoManager = new Y.UndoManager(ytasks, {
      trackedOrigins: TRACKED_ORIGINS,
      captureTimeout: 0, // no grouping delay in tests
    });
  });

  afterEach(() => {
    undoManager.destroy();
    doc.destroy();
  });

  describe('per-client scope', () => {
    it('undoes local-origin changes', () => {
      const task = makeTask();
      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      }, ORIGIN.LOCAL);

      expect(ytasks.has('task-1')).toBe(true);
      expect(undoManager.canUndo()).toBe(true);

      undoManager.undo();
      expect(ytasks.has('task-1')).toBe(false);
      expect(undoManager.canUndo()).toBe(false);
    });

    it('does not undo sheets-origin changes', () => {
      const task = makeTask();
      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      }, ORIGIN.SHEETS);

      expect(ytasks.has('task-1')).toBe(true);
      expect(undoManager.canUndo()).toBe(false);
    });

    it('does not undo remote (null origin) changes', () => {
      const task = makeTask();
      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      });

      expect(ytasks.has('task-1')).toBe(true);
      expect(undoManager.canUndo()).toBe(false);
    });

    it('redo restores undone changes', () => {
      const task = makeTask();
      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      }, ORIGIN.LOCAL);

      undoManager.undo();
      expect(ytasks.has('task-1')).toBe(false);
      expect(undoManager.canRedo()).toBe(true);

      undoManager.redo();
      expect(ytasks.has('task-1')).toBe(true);
    });
  });

  describe('cascade undo', () => {
    it('undoes a field update atomically', () => {
      const task = makeTask();
      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      }, ORIGIN.LOCAL);

      // Update name and dates in single transaction (simulating move + cascade)
      doc.transact(() => {
        const ymap = ytasks.get('task-1')!;
        ymap.set('startDate', '2026-03-15');
        ymap.set('endDate', '2026-03-17');
        ymap.set('name', 'Updated Task');
      }, ORIGIN.LOCAL);

      const ymap = ytasks.get('task-1')!;
      expect(ymap.get('startDate')).toBe('2026-03-15');
      expect(ymap.get('name')).toBe('Updated Task');

      // Undo should revert the entire transaction
      undoManager.undo();
      const ymapAfter = ytasks.get('task-1')!;
      expect(ymapAfter.get('startDate')).toBe('2026-03-11');
      expect(ymapAfter.get('endDate')).toBe('2026-03-13');
      expect(ymapAfter.get('name')).toBe('Test Task');
    });

    it('undoes multi-task cascade as single step', () => {
      const task1 = makeTask({ id: 'task-1', startDate: '2026-03-11', endDate: '2026-03-13' });
      const task2 = makeTask({ id: 'task-2', startDate: '2026-03-14', endDate: '2026-03-16' });

      doc.transact(() => {
        writeTaskToDoc(ytasks, task1.id, task1);
        writeTaskToDoc(ytasks, task2.id, task2);
      }, ORIGIN.LOCAL);

      // Simulate move + cascade: both tasks move in one transaction
      doc.transact(() => {
        const ym1 = ytasks.get('task-1')!;
        ym1.set('startDate', '2026-03-15');
        ym1.set('endDate', '2026-03-17');
        const ym2 = ytasks.get('task-2')!;
        ym2.set('startDate', '2026-03-18');
        ym2.set('endDate', '2026-03-20');
      }, ORIGIN.LOCAL);

      // One undo reverts both tasks
      undoManager.undo();
      expect(ytasks.get('task-1')!.get('startDate')).toBe('2026-03-11');
      expect(ytasks.get('task-2')!.get('startDate')).toBe('2026-03-14');
    });
  });

  describe('sandbox clear', () => {
    it('clear() empties undo/redo stacks', () => {
      const task = makeTask();
      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      }, ORIGIN.LOCAL);

      expect(undoManager.canUndo()).toBe(true);

      undoManager.clear();

      expect(undoManager.canUndo()).toBe(false);
      expect(undoManager.canRedo()).toBe(false);
      // Data is still present
      expect(ytasks.has('task-1')).toBe(true);
    });

    it('after clear, new changes can still be undone', () => {
      const task1 = makeTask({ id: 'task-1' });
      doc.transact(() => {
        writeTaskToDoc(ytasks, task1.id, task1);
      }, ORIGIN.LOCAL);

      undoManager.clear();

      const task2 = makeTask({ id: 'task-2' });
      doc.transact(() => {
        writeTaskToDoc(ytasks, task2.id, task2);
      }, ORIGIN.LOCAL);

      expect(undoManager.canUndo()).toBe(true);
      undoManager.undo();
      expect(ytasks.has('task-2')).toBe(false);
      expect(ytasks.has('task-1')).toBe(true);
    });
  });

  describe('promotion clear (sandbox to sheet)', () => {
    it('clears undo/redo stacks when spreadsheetId changes (simulating promotion)', () => {
      // Build up sandbox undo history
      const task1 = makeTask({ id: 'task-1' });
      const task2 = makeTask({ id: 'task-2', name: 'Second Task' });

      doc.transact(() => {
        writeTaskToDoc(ytasks, task1.id, task1);
      }, ORIGIN.LOCAL);

      doc.transact(() => {
        writeTaskToDoc(ytasks, task2.id, task2);
      }, ORIGIN.LOCAL);

      doc.transact(() => {
        ytasks.get('task-1')!.set('name', 'Edited in sandbox');
      }, ORIGIN.LOCAL);

      expect(undoManager.canUndo()).toBe(true);

      // Simulate what TaskStoreProvider does when spreadsheetId changes
      undoManager.clear();

      expect(undoManager.canUndo()).toBe(false);
      expect(undoManager.canRedo()).toBe(false);

      // All tasks still exist — only the undo stacks were cleared
      expect(ytasks.has('task-1')).toBe(true);
      expect(ytasks.has('task-2')).toBe(true);
      expect(ytasks.get('task-1')!.get('name')).toBe('Edited in sandbox');

      // New edits after promotion are undoable
      doc.transact(() => {
        ytasks.get('task-1')!.set('name', 'Edited after promotion');
      }, ORIGIN.LOCAL);

      expect(undoManager.canUndo()).toBe(true);
      undoManager.undo();
      expect(ytasks.get('task-1')!.get('name')).toBe('Edited in sandbox');

      // Cannot undo further — pre-promotion history is gone
      expect(undoManager.canUndo()).toBe(false);
    });
  });

  describe('delete and undo', () => {
    it('undoes task deletion restoring all fields', () => {
      const task = makeTask({
        name: 'Important Task',
        owner: 'Alice',
        startDate: '2026-03-11',
        endDate: '2026-03-13',
      });

      doc.transact(() => {
        writeTaskToDoc(ytasks, task.id, task);
      }, ORIGIN.LOCAL);

      // Delete task
      doc.transact(() => {
        ytasks.delete(task.id);
      }, ORIGIN.LOCAL);

      expect(ytasks.has('task-1')).toBe(false);

      // Undo delete
      undoManager.undo();
      expect(ytasks.has('task-1')).toBe(true);
      const restored = ytasks.get('task-1')!;
      expect(restored.get('name')).toBe('Important Task');
      expect(restored.get('owner')).toBe('Alice');
    });
  });
});
