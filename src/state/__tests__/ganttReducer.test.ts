import { describe, it, expect, beforeAll } from 'vitest';
import { ganttReducer } from '../ganttReducer';
import type { GanttState, Task } from '../../types';
import { initScheduler } from '../../utils/schedulerWasm';

beforeAll(async () => {
  await initScheduler();
});

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'test',
    name: 'Test',
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    duration: 7,
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
    tasks: [],
    columns: [],
    colorBy: 'owner',
    zoomLevel: 'day',
    searchQuery: '',
    changeHistory: [],
    users: [],
    isHistoryPanelOpen: false,
    isSyncing: false,
    syncComplete: false,
    contextMenu: null,
    showOwnerOnBar: false,
    showAreaOnBar: false,
    showOkrsOnBar: false,
    showCriticalPath: false,
    dependencyEditor: null,
    theme: 'dark',
    collabUsers: [],
    isCollabConnected: false,
    undoStack: [],
    redoStack: [],
    lastCascadeIds: [],
    criticalPathScope: { type: 'all' },
    collapseWeekends: true,
    ...overrides,
  };
}

describe('ganttReducer', () => {
  describe('MOVE_TASK', () => {
    it('updates task start and end dates', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'MOVE_TASK',
        taskId: 'a',
        newStartDate: '2026-04-01',
        newEndDate: '2026-04-10',
      });
      const task = result.tasks.find(t => t.id === 'a')!;
      expect(task.startDate).toBe('2026-04-01');
      expect(task.endDate).toBe('2026-04-10');
    });
  });

  describe('RESIZE_TASK', () => {
    it('updates end date and duration', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'RESIZE_TASK',
        taskId: 'a',
        newEndDate: '2026-03-20',
        newDuration: 15,
      });
      const task = result.tasks.find(t => t.id === 'a')!;
      expect(task.endDate).toBe('2026-03-20');
      expect(task.duration).toBe(15);
    });
  });

  describe('UPDATE_TASK_FIELD', () => {
    it('updates a string field', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a', name: 'Old Name' })],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'a',
        field: 'name',
        value: 'New Name',
      });
      expect(result.tasks[0].name).toBe('New Name');
    });

    it('updates a boolean field', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a', done: false })],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'a',
        field: 'done',
        value: true,
      });
      expect(result.tasks[0].done).toBe(true);
    });
  });

  describe('TOGGLE_EXPAND', () => {
    it('toggles isExpanded', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a', isExpanded: false })],
      });
      const result = ganttReducer(state, { type: 'TOGGLE_EXPAND', taskId: 'a' });
      expect(result.tasks[0].isExpanded).toBe(true);
    });
  });

  describe('SET_ZOOM', () => {
    it('changes zoom level', () => {
      const state = makeState({ zoomLevel: 'day' });
      const result = ganttReducer(state, { type: 'SET_ZOOM', zoomLevel: 'week' });
      expect(result.zoomLevel).toBe('week');
    });
  });

  describe('CASCADE_DEPENDENTS', () => {
    it('cascades date changes to dependents', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10' }),
          makeTask({ id: 'b', startDate: '2026-03-11', endDate: '2026-03-20', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
        ],
      });
      const result = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'a', daysDelta: 5 });
      const b = result.tasks.find(t => t.id === 'b')!;
      expect(b.startDate).toBe('2026-03-16');
    });
  });

  describe('ADD_DEPENDENCY', () => {
    it('adds a dependency to a task', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'a' }),
          makeTask({ id: 'b' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'ADD_DEPENDENCY',
        taskId: 'b',
        dependency: { fromId: 'a', toId: 'b', type: 'FS', lag: 0 },
      });
      const b = result.tasks.find(t => t.id === 'b')!;
      expect(b.dependencies).toHaveLength(1);
      expect(b.dependencies[0].fromId).toBe('a');
    });
  });

  describe('REMOVE_DEPENDENCY', () => {
    it('removes a dependency from a task', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'a' }),
          makeTask({ id: 'b', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REMOVE_DEPENDENCY',
        taskId: 'b',
        fromId: 'a',
      });
      const b = result.tasks.find(t => t.id === 'b')!;
      expect(b.dependencies).toHaveLength(0);
    });
  });

  describe('TOGGLE_CRITICAL_PATH', () => {
    it('toggles showCriticalPath', () => {
      const state = makeState({ showCriticalPath: false });
      const result = ganttReducer(state, { type: 'TOGGLE_CRITICAL_PATH' });
      expect(result.showCriticalPath).toBe(true);
    });
  });

  describe('SET_THEME', () => {
    it('sets theme', () => {
      const state = makeState({ theme: 'dark' });
      const result = ganttReducer(state, { type: 'SET_THEME', theme: 'light' });
      expect(result.theme).toBe('light');
    });
  });

  describe('ADD_TASK', () => {
    it('adds a root-level task', () => {
      const state = makeState({ tasks: [makeTask({ id: 'a' })] });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: null, afterTaskId: null });
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[1].name).toBe('New Task');
      expect(result.tasks[1].parentId).toBeNull();
    });

    it('adds a subtask to a parent', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'parent', isSummary: true, childIds: [] })],
      });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'parent', afterTaskId: null });
      const parent = result.tasks.find(t => t.id === 'parent')!;
      expect(parent.childIds).toHaveLength(1);
      const child = result.tasks.find(t => t.id === parent.childIds[0])!;
      expect(child.parentId).toBe('parent');
    });
  });

  describe('DELETE_TASK', () => {
    it('deletes a task and cleans up dependencies', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'a' }),
          makeTask({ id: 'b', dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }] }),
        ],
      });
      const result = ganttReducer(state, { type: 'DELETE_TASK', taskId: 'a' });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe('b');
      expect(result.tasks[0].dependencies).toHaveLength(0);
    });

    it('deletes task and all its children', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'parent', isSummary: true, childIds: ['child1', 'child2'] }),
          makeTask({ id: 'child1', parentId: 'parent' }),
          makeTask({ id: 'child2', parentId: 'parent' }),
        ],
      });
      const result = ganttReducer(state, { type: 'DELETE_TASK', taskId: 'parent' });
      expect(result.tasks).toHaveLength(0);
    });
  });
});
