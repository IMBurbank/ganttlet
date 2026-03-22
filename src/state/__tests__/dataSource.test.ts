import { describe, it, expect } from 'vitest';
import { ganttReducer } from '../ganttReducer';
import { initialState } from '../initialState';
import type { GanttState, Task, ChangeRecord } from '../../types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test',
    name: 'Test',
    startDate: '2026-03-02',
    endDate: '2026-03-13',
    duration: 10,
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

function makeState(overrides: Partial<GanttState> = {}): GanttState {
  return {
    ...initialState,
    ...overrides,
  };
}

describe('dataSource reducer actions', () => {
  describe('SET_DATA_SOURCE', () => {
    it('sets dataSource and resets sandboxDirty', () => {
      const state = makeState({ sandboxDirty: true, dataSource: 'sandbox' });
      const result = ganttReducer(state, { type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
      expect(result.dataSource).toBe('sheet');
      expect(result.sandboxDirty).toBe(false);
    });

    it('sets dataSource to loading', () => {
      const state = makeState({ dataSource: undefined });
      const result = ganttReducer(state, { type: 'SET_DATA_SOURCE', dataSource: 'loading' });
      expect(result.dataSource).toBe('loading');
    });

    it('sets dataSource to empty', () => {
      const state = makeState({ dataSource: 'loading' });
      const result = ganttReducer(state, { type: 'SET_DATA_SOURCE', dataSource: 'empty' });
      expect(result.dataSource).toBe('empty');
    });
  });

  describe('SET_SYNC_ERROR', () => {
    it('sets sync error', () => {
      const state = makeState();
      const error = { type: 'auth' as const, message: 'Session expired', since: 1000 };
      const result = ganttReducer(state, { type: 'SET_SYNC_ERROR', error });
      expect(result.syncError).toEqual(error);
    });

    it('clears sync error', () => {
      const state = makeState({
        syncError: { type: 'auth', message: 'test', since: 1000 },
      });
      const result = ganttReducer(state, { type: 'SET_SYNC_ERROR', error: null });
      expect(result.syncError).toBeNull();
    });
  });

  describe('ENTER_SANDBOX', () => {
    it('sets dataSource to sandbox and loads tasks/history', () => {
      const tasks = [makeTask({ id: 'sandbox-1' })];
      const changeHistory: ChangeRecord[] = [
        {
          id: 'ch-1',
          timestamp: '2026-03-01T00:00:00Z',
          user: 'Test',
          taskId: 'sandbox-1',
          taskName: 'Test',
          field: 'name',
          oldValue: 'a',
          newValue: 'b',
        },
      ];
      const state = makeState({ dataSource: undefined });
      const result = ganttReducer(state, { type: 'ENTER_SANDBOX', tasks, changeHistory });
      expect(result.dataSource).toBe('sandbox');
      expect(result.tasks).toEqual(tasks);
      expect(result.changeHistory).toEqual(changeHistory);
    });
  });

  describe('RESET_STATE', () => {
    it('resets to initial state', () => {
      const state = makeState({
        tasks: [makeTask()],
        dataSource: 'sheet',
        syncError: { type: 'auth', message: 'test', since: 1000 },
        sandboxDirty: true,
      });
      const result = ganttReducer(state, { type: 'RESET_STATE' });
      expect(result.tasks).toEqual([]);
      expect(result.dataSource).toBeUndefined();
      expect(result.syncError).toBeNull();
      expect(result.sandboxDirty).toBe(false);
    });
  });

  describe('sandboxDirty tracking', () => {
    it('sets sandboxDirty when task is modified in sandbox mode', () => {
      const state = makeState({
        dataSource: 'sandbox',
        sandboxDirty: false,
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'MOVE_TASK',
        taskId: 'a',
        newStartDate: '2026-04-01',
        newEndDate: '2026-04-10',
      });
      expect(result.sandboxDirty).toBe(true);
    });

    it('does not set sandboxDirty for non-task-modifying actions in sandbox', () => {
      const state = makeState({ dataSource: 'sandbox', sandboxDirty: false });
      const result = ganttReducer(state, { type: 'SET_ZOOM', zoomLevel: 'week' });
      expect(result.sandboxDirty).toBe(false);
    });

    it('resets sandboxDirty on SET_DATA_SOURCE', () => {
      const state = makeState({ dataSource: 'sandbox', sandboxDirty: true });
      const result = ganttReducer(state, { type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
      expect(result.sandboxDirty).toBe(false);
    });
  });

  describe('RESET_SYNC clears isSyncing', () => {
    it('clears isSyncing after START_SYNC was dispatched', () => {
      const state = makeState({ dataSource: 'loading' });
      const syncing = ganttReducer(state, { type: 'START_SYNC' });
      expect(syncing.isSyncing).toBe(true);
      const reset = ganttReducer(syncing, { type: 'RESET_SYNC' });
      expect(reset.isSyncing).toBe(false);
      expect(reset.syncComplete).toBe(false);
    });

    it('error path: START_SYNC → RESET_SYNC → SET_SYNC_ERROR leaves isSyncing false', () => {
      let state = makeState({ dataSource: 'loading' });
      state = ganttReducer(state, { type: 'START_SYNC' });
      expect(state.isSyncing).toBe(true);
      state = ganttReducer(state, { type: 'RESET_SYNC' });
      state = ganttReducer(state, {
        type: 'SET_SYNC_ERROR',
        error: { type: 'auth', message: 'Session expired', since: 1000 },
      });
      expect(state.isSyncing).toBe(false);
      expect(state.syncError).not.toBeNull();
    });
  });

  describe('empty→sheet auto-transition', () => {
    it('transitions from empty to sheet on task-modifying action', () => {
      const state = makeState({
        dataSource: 'empty',
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'a',
        field: 'name',
        value: 'Updated',
      });
      expect(result.dataSource).toBe('sheet');
    });

    it('does not transition for non-task-modifying actions', () => {
      const state = makeState({ dataSource: 'empty' });
      const result = ganttReducer(state, { type: 'SET_THEME', theme: 'light' });
      expect(result.dataSource).toBe('empty');
    });
  });

  describe('T2.4 — lastTaskSource tracking', () => {
    it('SET_TASKS with source yjs sets lastTaskSource to yjs', () => {
      const state = makeState({ lastTaskSource: 'local' });
      const result = ganttReducer(state, {
        type: 'SET_TASKS',
        tasks: [makeTask()],
        source: 'yjs',
      });
      expect(result.lastTaskSource).toBe('yjs');
    });

    it('SET_TASKS with source sheets sets lastTaskSource to sheets', () => {
      const state = makeState({ lastTaskSource: 'local' });
      const result = ganttReducer(state, {
        type: 'SET_TASKS',
        tasks: [makeTask()],
        source: 'sheets',
      });
      expect(result.lastTaskSource).toBe('sheets');
    });

    it('SET_TASKS without source defaults to local', () => {
      const state = makeState({ lastTaskSource: 'yjs' });
      const result = ganttReducer(state, {
        type: 'SET_TASKS',
        tasks: [makeTask()],
      });
      expect(result.lastTaskSource).toBe('local');
    });

    it('MERGE_EXTERNAL_TASKS sets lastTaskSource to sheets', () => {
      const state = makeState({
        lastTaskSource: 'local',
        tasks: [makeTask({ id: 'existing' })],
      });
      const result = ganttReducer(state, {
        type: 'MERGE_EXTERNAL_TASKS',
        externalTasks: [makeTask({ id: 'existing' })],
      });
      expect(result.lastTaskSource).toBe('sheets');
    });

    it('MOVE_TASK (task-modifying) resets lastTaskSource to local', () => {
      const state = makeState({
        lastTaskSource: 'yjs',
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'MOVE_TASK',
        taskId: 'a',
        newStartDate: '2026-04-01',
        newEndDate: '2026-04-05',
      });
      expect(result.lastTaskSource).toBe('local');
    });

    it('postProcess does NOT reset lastTaskSource for SET_TASKS', () => {
      const state = makeState({ lastTaskSource: 'local' });
      const result = ganttReducer(state, {
        type: 'SET_TASKS',
        tasks: [makeTask()],
        source: 'yjs',
      });
      // SET_TASKS is excluded from the postProcess reset
      expect(result.lastTaskSource).toBe('yjs');
    });

    it('UNDO sets lastTaskSource to local', () => {
      const state = makeState({
        lastTaskSource: 'yjs',
        tasks: [makeTask({ id: 'a' })],
        undoStack: [[makeTask({ id: 'a', name: 'Old' })]],
      });
      const result = ganttReducer(state, { type: 'UNDO' });
      expect(result.lastTaskSource).toBe('local');
    });

    it('REDO sets lastTaskSource to local', () => {
      const state = makeState({
        lastTaskSource: 'yjs',
        tasks: [makeTask({ id: 'a' })],
        redoStack: [[makeTask({ id: 'a', name: 'Future' })]],
      });
      const result = ganttReducer(state, { type: 'REDO' });
      expect(result.lastTaskSource).toBe('local');
    });

    it('Yjs SET_TASKS followed by TOGGLE_EXPAND: lastTaskSource stays local (postProcess)', () => {
      // Simulates: remote Yjs change arrives, then user expands a row
      let state = makeState({
        dataSource: 'sheet',
        tasks: [makeTask({ id: 'a', isExpanded: false })],
      });
      // Yjs update
      state = ganttReducer(state, { type: 'SET_TASKS', tasks: state.tasks, source: 'yjs' });
      expect(state.lastTaskSource).toBe('yjs');
      // User expands — postProcess resets to 'local'
      state = ganttReducer(state, { type: 'TOGGLE_EXPAND', taskId: 'a' });
      expect(state.lastTaskSource).toBe('local');
    });

    it('TOGGLE_EXPAND alone changes lastTaskSource to local but tasks also change (no spurious skip)', () => {
      // TOGGLE_EXPAND is in TASK_MODIFYING_ACTIONS — it changes tasks AND resets lastTaskSource
      // This means auto-save would fire (tasks changed, lastTaskSource='local')
      const state = makeState({
        dataSource: 'sheet',
        lastTaskSource: 'yjs',
        tasks: [makeTask({ id: 'a', isExpanded: false })],
      });
      const result = ganttReducer(state, { type: 'TOGGLE_EXPAND', taskId: 'a' });
      expect(result.lastTaskSource).toBe('local');
      expect(result.tasks[0].isExpanded).toBe(true);
    });
  });
});
