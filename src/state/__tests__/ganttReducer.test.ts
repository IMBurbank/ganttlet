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
    cascadeShifts: [],
    criticalPathScope: { type: 'project', name: '' },
    collapseWeekends: true,
    focusNewTaskId: null,
    isLeftPaneCollapsed: false,
    reparentPicker: null,
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

  describe('ADD_TASK with hierarchy inheritance', () => {
    it('inherits project, workStream, okrs from workstream parent and gets prefixed ID', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', name: 'Q2 Launch', isSummary: true, parentId: null, childIds: ['pe'] }),
          makeTask({ id: 'pe', name: 'Platform', isSummary: true, parentId: 'root', project: 'Q2 Launch', okrs: ['KR-1'], childIds: ['pe-1', 'pe-3'] }),
          makeTask({ id: 'pe-1', parentId: 'pe' }),
          makeTask({ id: 'pe-3', parentId: 'pe' }),
        ],
      });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'pe', afterTaskId: null });
      const newTask = result.tasks.find(t => t.id === 'pe-4');
      expect(newTask).toBeDefined();
      expect(newTask!.project).toBe('Q2 Launch');
      expect(newTask!.workStream).toBe('Platform');
      expect(newTask!.okrs).toEqual(['KR-1']);
      expect(newTask!.parentId).toBe('pe');
    });

    it('sets focusNewTaskId after adding task', () => {
      const state = makeState({ tasks: [] });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: null, afterTaskId: null });
      expect(result.focusNewTaskId).toBeTruthy();
      expect(result.tasks.find(t => t.id === result.focusNewTaskId)).toBeDefined();
    });

    it('inherits project name from project parent', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', name: 'Q2 Launch', isSummary: true, parentId: null, childIds: [] }),
        ],
      });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'root', afterTaskId: null });
      const newTask = result.tasks.find(t => t.parentId === 'root' && t.id !== 'root');
      expect(newTask).toBeDefined();
      expect(newTask!.project).toBe('Q2 Launch');
      expect(newTask!.workStream).toBe('');
    });
  });

  describe('UPDATE_TASK_FIELD with cascade', () => {
    it('cascades project name to all descendants when renaming a project', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', name: 'Old Project', isSummary: true, parentId: null, project: 'Old Project', childIds: ['ws'] }),
          makeTask({ id: 'ws', isSummary: true, parentId: 'root', project: 'Old Project', childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'ws', project: 'Old Project' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'root',
        field: 'name',
        value: 'New Project',
      });
      expect(result.tasks.find(t => t.id === 'root')!.project).toBe('New Project');
      expect(result.tasks.find(t => t.id === 'ws')!.project).toBe('New Project');
      expect(result.tasks.find(t => t.id === 't1')!.project).toBe('New Project');
    });

    it('cascades workStream name to descendants when renaming a workstream', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] }),
          makeTask({ id: 'ws', name: 'Old WS', isSummary: true, parentId: 'root', workStream: 'Old WS', childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'ws', workStream: 'Old WS' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'ws',
        field: 'name',
        value: 'New WS',
      });
      expect(result.tasks.find(t => t.id === 'ws')!.workStream).toBe('New WS');
      expect(result.tasks.find(t => t.id === 't1')!.workStream).toBe('New WS');
    });
  });

  describe('ADD_DEPENDENCY with hierarchy validation', () => {
    it('rejects dependency where predecessor is ancestor of successor', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'root' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'ADD_DEPENDENCY',
        taskId: 't1',
        dependency: { fromId: 'root', toId: 't1', type: 'FS', lag: 0 },
      });
      // Should be silently rejected
      const t1 = result.tasks.find(t => t.id === 't1')!;
      expect(t1.dependencies).toHaveLength(0);
    });
  });

  describe('REPARENT_TASK', () => {
    it('updates parentId and childIds correctly', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'p1', isSummary: true, childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'p1' }),
          makeTask({ id: 'p2', isSummary: true, childIds: [] }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 't1',
        newParentId: 'p2',
      });
      const p1 = result.tasks.find(t => t.id === 'p1')!;
      const p2 = result.tasks.find(t => t.id === 'p2')!;
      const t1 = result.tasks.find(t => t.id === 't1')!;
      expect(p1.childIds).not.toContain('t1');
      expect(p2.childIds).toContain('t1');
      expect(t1.parentId).toBe('p2');
    });

    it('updates inherited fields from new parent', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws1', 'ws2'] }),
          makeTask({ id: 'ws1', name: 'WS1', isSummary: true, parentId: 'root', project: 'Proj', childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'ws1', project: 'Proj', workStream: 'WS1' }),
          makeTask({ id: 'ws2', name: 'WS2', isSummary: true, parentId: 'root', project: 'Proj', childIds: [] }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 't1',
        newParentId: 'ws2',
      });
      const t1 = result.tasks.find(t => t.id === 't1')!;
      expect(t1.workStream).toBe('WS2');
      expect(t1.project).toBe('Proj');
    });

    it('updates dependency references when ID changes', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws1', 'ws2'] }),
          makeTask({ id: 'ws1', isSummary: true, parentId: 'root', project: 'Proj', childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'ws1' }),
          makeTask({ id: 'ws2', isSummary: true, parentId: 'root', project: 'Proj', childIds: ['t2'] }),
          makeTask({ id: 't2', parentId: 'ws2', dependencies: [{ fromId: 't1', toId: 't2', type: 'FS', lag: 0 }] }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 't1',
        newParentId: 'ws2',
        newId: 't1-new',
      });
      const t2 = result.tasks.find(t => t.id === 't2')!;
      expect(t2.dependencies[0].fromId).toBe('t1-new');
    });

    it('rejects reparent to own descendant', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'p', isSummary: true, childIds: ['c'] }),
          makeTask({ id: 'c', parentId: 'p' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 'p',
        newParentId: 'c',
      });
      // Should be unchanged
      expect(result.tasks.find(t => t.id === 'p')!.parentId).toBeNull();
    });

    it('clears reparentPicker after reparent', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'p1', isSummary: true, childIds: ['t1'] }),
          makeTask({ id: 't1', parentId: 'p1' }),
          makeTask({ id: 'p2', isSummary: true, childIds: [] }),
        ],
        reparentPicker: { taskId: 't1' },
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 't1',
        newParentId: 'p2',
      });
      expect(result.reparentPicker).toBeNull();
    });
  });

  describe('TOGGLE_LEFT_PANE', () => {
    it('toggles isLeftPaneCollapsed', () => {
      const state = makeState({ isLeftPaneCollapsed: false });
      const result = ganttReducer(state, { type: 'TOGGLE_LEFT_PANE' });
      expect(result.isLeftPaneCollapsed).toBe(true);
      const result2 = ganttReducer(result, { type: 'TOGGLE_LEFT_PANE' });
      expect(result2.isLeftPaneCollapsed).toBe(false);
    });
  });

  describe('CLEAR_FOCUS_NEW_TASK', () => {
    it('clears focusNewTaskId', () => {
      const state = makeState({ focusNewTaskId: 'some-id' });
      const result = ganttReducer(state, { type: 'CLEAR_FOCUS_NEW_TASK' });
      expect(result.focusNewTaskId).toBeNull();
    });
  });

  describe('SET_REPARENT_PICKER', () => {
    it('sets reparent picker', () => {
      const state = makeState({ reparentPicker: null });
      const result = ganttReducer(state, { type: 'SET_REPARENT_PICKER', picker: { taskId: 'x' } });
      expect(result.reparentPicker).toEqual({ taskId: 'x' });
    });

    it('clears reparent picker', () => {
      const state = makeState({ reparentPicker: { taskId: 'x' } });
      const result = ganttReducer(state, { type: 'SET_REPARENT_PICKER', picker: null });
      expect(result.reparentPicker).toBeNull();
    });
  });

  describe('CASCADE_DEPENDENTS', () => {
    it('populates cascadeShifts with pre-cascade dates for changed tasks', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
          makeTask({
            id: 'b',
            startDate: '2026-03-10',
            endDate: '2026-03-19',
            duration: 9,
            dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
          }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'CASCADE_DEPENDENTS',
        taskId: 'a',
        daysDelta: 3,
      });
      // Task 'b' should have been cascaded
      expect(result.lastCascadeIds).toContain('b');
      expect(result.cascadeShifts.length).toBeGreaterThan(0);
      const shiftB = result.cascadeShifts.find(s => s.taskId === 'b');
      expect(shiftB).toBeDefined();
      expect(shiftB!.fromStartDate).toBe('2026-03-10');
      expect(shiftB!.fromEndDate).toBe('2026-03-19');
    });

    it('does not include unchanged tasks in cascadeShifts', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 }),
          makeTask({ id: 'c', startDate: '2026-03-01', endDate: '2026-03-05', duration: 4 }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'CASCADE_DEPENDENTS',
        taskId: 'a',
        daysDelta: 3,
      });
      // 'c' has no dependency on 'a', so it shouldn't be cascaded
      expect(result.cascadeShifts.find(s => s.taskId === 'c')).toBeUndefined();
    });
  });

  describe('CASCADE_DEPENDENTS on end-date/duration changes', () => {
    it('cascades dependents when end date increases (positive delta)', () => {
      const parent = makeTask({ id: 'A', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 });
      const child = makeTask({
        id: 'B', startDate: '2026-03-11', endDate: '2026-03-20', duration: 9,
        dependencies: [{ fromId: 'A', toId: 'B', type: 'FS', lag: 0 }],
      });
      let state = makeState({ tasks: [parent, child] });

      // Simulate end date change: A's end date moves from Mar 10 to Mar 15 (5 day delta)
      state = ganttReducer(state, { type: 'UPDATE_TASK_FIELD', taskId: 'A', field: 'endDate', value: '2026-03-15' });
      state = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'A', daysDelta: 5 });

      const childTask = state.tasks.find(t => t.id === 'B')!;
      expect(childTask.startDate).toBe('2026-03-16');
      expect(childTask.endDate).toBe('2026-03-25');
    });

    it('does not cascade dependents on backward move (asymmetric cascade)', () => {
      const parent = makeTask({ id: 'A', startDate: '2026-03-01', endDate: '2026-03-10', duration: 9 });
      const child = makeTask({
        id: 'B', startDate: '2026-03-11', endDate: '2026-03-20', duration: 9,
        dependencies: [{ fromId: 'A', toId: 'B', type: 'FS', lag: 0 }],
      });
      let state = makeState({ tasks: [parent, child] });

      // Simulate duration decrease: A's end date moves from Mar 10 to Mar 7 (-3 day delta)
      state = ganttReducer(state, { type: 'UPDATE_TASK_FIELD', taskId: 'A', field: 'endDate', value: '2026-03-07' });
      state = ganttReducer(state, { type: 'UPDATE_TASK_FIELD', taskId: 'A', field: 'duration', value: 6 });
      state = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'A', daysDelta: -3 });

      // Asymmetric cascade: backward moves do NOT pull dependents — they expose slack instead
      const childTask = state.tasks.find(t => t.id === 'B')!;
      expect(childTask.startDate).toBe('2026-03-11');
      expect(childTask.endDate).toBe('2026-03-20');
    });
  });

  describe('SET_CASCADE_SHIFTS', () => {
    it('sets cascade shifts', () => {
      const state = makeState({ cascadeShifts: [] });
      const shifts = [{ taskId: 't1', fromStartDate: '2026-03-01', fromEndDate: '2026-03-10' }];
      const result = ganttReducer(state, { type: 'SET_CASCADE_SHIFTS', shifts });
      expect(result.cascadeShifts).toEqual(shifts);
    });

    it('clears cascade shifts', () => {
      const state = makeState({
        cascadeShifts: [{ taskId: 't1', fromStartDate: '2026-03-01', fromEndDate: '2026-03-10' }],
      });
      const result = ganttReducer(state, { type: 'SET_CASCADE_SHIFTS', shifts: [] });
      expect(result.cascadeShifts).toEqual([]);
    });
  });

  describe('MERGE_EXTERNAL_TASKS', () => {
    it('adds new external tasks that are not in local state', () => {
      const localTask = makeTask({ id: 'local-1', name: 'Local Task' });
      const externalNew = makeTask({ id: 'ext-1', name: 'External New' });
      const state = makeState({ tasks: [localTask] });

      const result = ganttReducer(state, {
        type: 'MERGE_EXTERNAL_TASKS',
        externalTasks: [localTask, externalNew],
      });

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.find(t => t.id === 'ext-1')).toBeDefined();
      expect(result.tasks.find(t => t.id === 'ext-1')!.name).toBe('External New');
    });

    it('uses external version for tasks not in local state', () => {
      const externalTask = makeTask({ id: 'new-1', name: 'From Sheets', owner: 'Alice' });
      const state = makeState({ tasks: [] });

      const result = ganttReducer(state, {
        type: 'MERGE_EXTERNAL_TASKS',
        externalTasks: [externalTask],
      });

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe('From Sheets');
      expect(result.tasks[0].owner).toBe('Alice');
    });

    it('preserves local version when task exists locally', () => {
      const localTask = makeTask({ id: 't1', name: 'Local Edit', owner: 'Bob' });
      const externalTask = makeTask({ id: 't1', name: 'Sheet Version', owner: 'Alice' });
      const state = makeState({ tasks: [localTask] });

      const result = ganttReducer(state, {
        type: 'MERGE_EXTERNAL_TASKS',
        externalTasks: [externalTask],
      });

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe('Local Edit');
      expect(result.tasks[0].owner).toBe('Bob');
    });

    it('removes local tasks not present in external tasks', () => {
      const localTask1 = makeTask({ id: 't1', name: 'Keep' });
      const localTask2 = makeTask({ id: 't2', name: 'Deleted in sheets' });
      const state = makeState({ tasks: [localTask1, localTask2] });

      const result = ganttReducer(state, {
        type: 'MERGE_EXTERNAL_TASKS',
        externalTasks: [makeTask({ id: 't1', name: 'Keep' })],
      });

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe('t1');
    });
  });

  describe('UNDO clears cascade state', () => {
    it('clears cascadeShifts on undo', () => {
      // First do an action that creates an undo snapshot
      const state = makeState({
        tasks: [makeTask({ id: 'a' })],
        cascadeShifts: [{ taskId: 'a', fromStartDate: '2026-03-01', fromEndDate: '2026-03-10' }],
      });
      // Move task to create undo entry
      const afterMove = ganttReducer(state, {
        type: 'MOVE_TASK',
        taskId: 'a',
        newStartDate: '2026-03-05',
        newEndDate: '2026-03-14',
      });
      const afterUndo = ganttReducer(afterMove, { type: 'UNDO' });
      expect(afterUndo.cascadeShifts).toEqual([]);
    });
  });
});
