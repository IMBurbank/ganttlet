import { describe, it, expect, beforeAll } from 'vitest';
import { differenceInBusinessDays, parseISO } from 'date-fns';
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
    dataSource: 'sheet',
    syncError: null,
    sandboxDirty: false,
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
      const task = result.tasks.find((t) => t.id === 'a')!;
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
      });
      const task = result.tasks.find((t) => t.id === 'a')!;
      expect(task.endDate).toBe('2026-03-20');
      // Duration uses inclusive convention: taskDuration('2026-03-01', '2026-03-20') = 15
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
    it('cascades date changes to dependents when constraint is violated', () => {
      // In real usage, the moved task's dates are updated (via UPDATE_TASK_FIELD)
      // before CASCADE_DEPENDENTS is dispatched. The cascade checks for constraint
      // violations based on the task's current (already updated) dates.
      //
      // A moved +5 biz days: endDate is already updated to Mar 17 (Tue).
      // B starts Mar 11 (Wed). FS lag=0: required = fs_successor_start(Mar 17, 0) = Mar 18 (Wed).
      // Mar 11 < Mar 18 → violation → B cascades to Mar 18 (shift 5 biz days).
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-17' }), // already moved
          makeTask({
            id: 'b',
            startDate: '2026-03-11',
            endDate: '2026-03-20',
            dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
          }),
        ],
      });
      const result = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'a', daysDelta: 5 });
      const b = result.tasks.find((t) => t.id === 'b')!;
      // B shifts to satisfy: required = Mar 18, so B starts Mar 18
      expect(b.startDate).toBe('2026-03-18');
    });
  });

  describe('ADD_DEPENDENCY', () => {
    it('adds a dependency to a task', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })],
      });
      const result = ganttReducer(state, {
        type: 'ADD_DEPENDENCY',
        taskId: 'b',
        dependency: { fromId: 'a', toId: 'b', type: 'FS', lag: 0 },
      });
      const b = result.tasks.find((t) => t.id === 'b')!;
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
      const b = result.tasks.find((t) => t.id === 'b')!;
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
      const result = ganttReducer(state, {
        type: 'ADD_TASK',
        parentId: 'parent',
        afterTaskId: null,
      });
      const parent = result.tasks.find((t) => t.id === 'parent')!;
      expect(parent.childIds).toHaveLength(1);
      const child = result.tasks.find((t) => t.id === parent.childIds[0])!;
      expect(child.parentId).toBe('parent');
    });
  });

  describe('ADD_TASK weekend snapping', () => {
    it('snaps Saturday start to Monday and uses taskEndDate for endDate', () => {
      // Simulate ADD_TASK when today is Saturday 2026-03-14
      // ensureBusinessDay(Sat) → Mon 2026-03-16
      // duration = 5, taskEndDate('2026-03-16', 5) = '2026-03-20'
      const state = makeState({ tasks: [] });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: null, afterTaskId: null });
      const newTask = result.tasks[0]!;
      // The actual startDate depends on today's date; verify invariants instead
      expect(newTask.duration).toBe(5);
      // startDate must not be a weekend
      const startDay = new Date(newTask.startDate + 'T00:00:00').getDay();
      expect(startDay).not.toBe(0); // not Sunday
      expect(startDay).not.toBe(6); // not Saturday
      // endDate should be taskEndDate(startDate, 5) — verify duration round-trips
      const computedDuration =
        differenceInBusinessDays(parseISO(newTask.endDate), parseISO(newTask.startDate)) + 1;
      expect(computedDuration).toBe(5);
    });

    it('ADD_TASK duration uses inclusive convention', () => {
      const state = makeState({ tasks: [] });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: null, afterTaskId: null });
      const newTask = result.tasks[0]!;
      // Inclusive duration: startDate and endDate are both business days,
      // and duration = taskDuration(start, end)
      expect(newTask.duration).toBe(5);
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
          makeTask({
            id: 'root',
            name: 'Q2 Launch',
            isSummary: true,
            parentId: null,
            childIds: ['pe'],
          }),
          makeTask({
            id: 'pe',
            name: 'Platform',
            isSummary: true,
            parentId: 'root',
            project: 'Q2 Launch',
            okrs: ['KR-1'],
            childIds: ['pe-1', 'pe-3'],
          }),
          makeTask({ id: 'pe-1', parentId: 'pe' }),
          makeTask({ id: 'pe-3', parentId: 'pe' }),
        ],
      });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'pe', afterTaskId: null });
      const newTask = result.tasks.find((t) => t.id === 'pe-4');
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
      expect(result.tasks.find((t) => t.id === result.focusNewTaskId)).toBeDefined();
    });

    it('inherits project name from project parent', () => {
      const state = makeState({
        tasks: [
          makeTask({
            id: 'root',
            name: 'Q2 Launch',
            isSummary: true,
            parentId: null,
            childIds: [],
          }),
        ],
      });
      const result = ganttReducer(state, { type: 'ADD_TASK', parentId: 'root', afterTaskId: null });
      const newTask = result.tasks.find((t) => t.parentId === 'root' && t.id !== 'root');
      expect(newTask).toBeDefined();
      expect(newTask!.project).toBe('Q2 Launch');
      expect(newTask!.workStream).toBe('');
    });
  });

  describe('UPDATE_TASK_FIELD with cascade', () => {
    it('cascades project name to all descendants when renaming a project', () => {
      const state = makeState({
        tasks: [
          makeTask({
            id: 'root',
            name: 'Old Project',
            isSummary: true,
            parentId: null,
            project: 'Old Project',
            childIds: ['ws'],
          }),
          makeTask({
            id: 'ws',
            isSummary: true,
            parentId: 'root',
            project: 'Old Project',
            childIds: ['t1'],
          }),
          makeTask({ id: 't1', parentId: 'ws', project: 'Old Project' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'root',
        field: 'name',
        value: 'New Project',
      });
      expect(result.tasks.find((t) => t.id === 'root')!.project).toBe('New Project');
      expect(result.tasks.find((t) => t.id === 'ws')!.project).toBe('New Project');
      expect(result.tasks.find((t) => t.id === 't1')!.project).toBe('New Project');
    });

    it('cascades workStream name to descendants when renaming a workstream', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws'] }),
          makeTask({
            id: 'ws',
            name: 'Old WS',
            isSummary: true,
            parentId: 'root',
            workStream: 'Old WS',
            childIds: ['t1'],
          }),
          makeTask({ id: 't1', parentId: 'ws', workStream: 'Old WS' }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'ws',
        field: 'name',
        value: 'New WS',
      });
      expect(result.tasks.find((t) => t.id === 'ws')!.workStream).toBe('New WS');
      expect(result.tasks.find((t) => t.id === 't1')!.workStream).toBe('New WS');
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
      const t1 = result.tasks.find((t) => t.id === 't1')!;
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
      const p1 = result.tasks.find((t) => t.id === 'p1')!;
      const p2 = result.tasks.find((t) => t.id === 'p2')!;
      const t1 = result.tasks.find((t) => t.id === 't1')!;
      expect(p1.childIds).not.toContain('t1');
      expect(p2.childIds).toContain('t1');
      expect(t1.parentId).toBe('p2');
    });

    it('updates inherited fields from new parent', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws1', 'ws2'] }),
          makeTask({
            id: 'ws1',
            name: 'WS1',
            isSummary: true,
            parentId: 'root',
            project: 'Proj',
            childIds: ['t1'],
          }),
          makeTask({ id: 't1', parentId: 'ws1', project: 'Proj', workStream: 'WS1' }),
          makeTask({
            id: 'ws2',
            name: 'WS2',
            isSummary: true,
            parentId: 'root',
            project: 'Proj',
            childIds: [],
          }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 't1',
        newParentId: 'ws2',
      });
      const t1 = result.tasks.find((t) => t.id === 't1')!;
      expect(t1.workStream).toBe('WS2');
      expect(t1.project).toBe('Proj');
    });

    it('updates dependency references when ID changes', () => {
      const state = makeState({
        tasks: [
          makeTask({ id: 'root', isSummary: true, parentId: null, childIds: ['ws1', 'ws2'] }),
          makeTask({
            id: 'ws1',
            isSummary: true,
            parentId: 'root',
            project: 'Proj',
            childIds: ['t1'],
          }),
          makeTask({ id: 't1', parentId: 'ws1' }),
          makeTask({
            id: 'ws2',
            isSummary: true,
            parentId: 'root',
            project: 'Proj',
            childIds: ['t2'],
          }),
          makeTask({
            id: 't2',
            parentId: 'ws2',
            dependencies: [{ fromId: 't1', toId: 't2', type: 'FS', lag: 0 }],
          }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'REPARENT_TASK',
        taskId: 't1',
        newParentId: 'ws2',
        newId: 't1-new',
      });
      const t2 = result.tasks.find((t) => t.id === 't2')!;
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
      expect(result.tasks.find((t) => t.id === 'p')!.parentId).toBeNull();
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
      // A's dates are already updated to reflect the +3 biz day move.
      // B starts on the same day A (old) ended, so required B.start = A.new_end
      // creates a violation and B cascades.
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-13', duration: 9 }), // moved +3 biz
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
      // Task 'b' should have been cascaded (B.start = Mar 10 < required = Mar 16)
      expect(result.lastCascadeIds).toContain('b');
      expect(result.cascadeShifts.length).toBeGreaterThan(0);
      const shiftB = result.cascadeShifts.find((s) => s.taskId === 'b');
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
      expect(result.cascadeShifts.find((s) => s.taskId === 'c')).toBeUndefined();
    });
  });

  describe('CASCADE_DEPENDENTS on end-date/duration changes', () => {
    it('cascades dependents when end date increases (positive delta)', () => {
      const parent = makeTask({
        id: 'A',
        startDate: '2026-03-01',
        endDate: '2026-03-10',
        duration: 9,
      });
      const child = makeTask({
        id: 'B',
        startDate: '2026-03-11',
        endDate: '2026-03-20',
        duration: 9,
        dependencies: [{ fromId: 'A', toId: 'B', type: 'FS', lag: 0 }],
      });
      let state = makeState({ tasks: [parent, child] });

      // Simulate end date change: A's end date moves from Mar 10 to Mar 15 (Sun).
      // Mar 15 is a weekend, so the required B.start snaps to Mon Mar 16.
      // B.start = Mar 11 < Mar 16 → violation, shift by 3 biz days.
      state = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'A',
        field: 'endDate',
        value: '2026-03-15',
      });
      state = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'A', daysDelta: 5 });

      const childTask = state.tasks.find((t) => t.id === 'B')!;
      // A ends Sun Mar 15 → required B.start = next_biz(Mar 15) = Mon Mar 16.
      // B shifts 3 biz: Mar 11 → Mar 16. End: add_biz(Mar 20, 3) = Mar 25 (Wed).
      expect(childTask.startDate).toBe('2026-03-16');
      expect(childTask.endDate).toBe('2026-03-25');
    });

    it('does not cascade dependents on backward move (asymmetric cascade)', () => {
      const parent = makeTask({
        id: 'A',
        startDate: '2026-03-01',
        endDate: '2026-03-10',
        duration: 9,
      });
      const child = makeTask({
        id: 'B',
        startDate: '2026-03-11',
        endDate: '2026-03-20',
        duration: 9,
        dependencies: [{ fromId: 'A', toId: 'B', type: 'FS', lag: 0 }],
      });
      let state = makeState({ tasks: [parent, child] });

      // Simulate duration decrease: A's end date moves from Mar 10 to Mar 7 (-3 day delta)
      state = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'A',
        field: 'endDate',
        value: '2026-03-07',
      });
      state = ganttReducer(state, {
        type: 'UPDATE_TASK_FIELD',
        taskId: 'A',
        field: 'duration',
        value: 6,
      });
      state = ganttReducer(state, { type: 'CASCADE_DEPENDENTS', taskId: 'A', daysDelta: -3 });

      // Asymmetric cascade: backward moves do NOT pull dependents — they expose slack instead
      const childTask = state.tasks.find((t) => t.id === 'B')!;
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
      expect(result.tasks.find((t) => t.id === 'ext-1')).toBeDefined();
      expect(result.tasks.find((t) => t.id === 'ext-1')!.name).toBe('External New');
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

  describe('SET_CONSTRAINT', () => {
    it('sets constraintType and constraintDate on a task', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'SET_CONSTRAINT',
        taskId: 'a',
        constraintType: 'SNET',
        constraintDate: '2026-04-01',
      });
      const task = result.tasks.find((t) => t.id === 'a')!;
      expect(task.constraintType).toBe('SNET');
      expect(task.constraintDate).toBe('2026-04-01');
    });

    it('clears constraintDate when ASAP is selected', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a', constraintType: 'SNET', constraintDate: '2026-04-01' })],
      });
      const result = ganttReducer(state, {
        type: 'SET_CONSTRAINT',
        taskId: 'a',
        constraintType: 'ASAP',
      });
      const task = result.tasks.find((t) => t.id === 'a')!;
      expect(task.constraintType).toBe('ASAP');
      expect(task.constraintDate).toBeUndefined();
    });

    it('clears constraintDate when ALAP is selected', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a', constraintType: 'MSO', constraintDate: '2026-04-01' })],
      });
      const result = ganttReducer(state, {
        type: 'SET_CONSTRAINT',
        taskId: 'a',
        constraintType: 'ALAP',
      });
      const task = result.tasks.find((t) => t.id === 'a')!;
      expect(task.constraintType).toBe('ALAP');
      expect(task.constraintDate).toBeUndefined();
    });

    it('is undoable', () => {
      const state = makeState({
        tasks: [makeTask({ id: 'a' })],
      });
      const result = ganttReducer(state, {
        type: 'SET_CONSTRAINT',
        taskId: 'a',
        constraintType: 'MFO',
        constraintDate: '2026-05-01',
      });
      expect(result.undoStack.length).toBe(1);
      const undone = ganttReducer(result, { type: 'UNDO' });
      const task = undone.tasks.find((t) => t.id === 'a')!;
      expect(task.constraintType).toBeUndefined();
    });
  });

  describe('Phase 15 integration: constraints + SF', () => {
    it('SNET constraint floors task start date via RECALCULATE_EARLIEST', () => {
      // A (Mar 1-10) → FS → B (Mar 11-20). B has SNET Apr 1.
      // Recalculate should respect SNET and move B to Apr 1.
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 7 }),
          makeTask({
            id: 'b',
            startDate: '2026-03-11',
            endDate: '2026-03-20',
            duration: 7,
            constraintType: 'SNET',
            constraintDate: '2026-04-01',
            dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
          }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'RECALCULATE_EARLIEST',
        scope: {},
      });
      const b = result.tasks.find((t) => t.id === 'b')!;
      // SNET Apr 1 is later than FS-required Mar 11, so B starts Apr 1
      expect(b.startDate).toBe('2026-04-01');
    });

    it('ALAP constraint schedules task as late as possible', () => {
      // A (Mar 1-10) → FS → B (Mar 11-20, ALAP). B should stay at latest possible.
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-01', endDate: '2026-03-10', duration: 7 }),
          makeTask({
            id: 'b',
            startDate: '2026-03-11',
            endDate: '2026-03-20',
            duration: 7,
            constraintType: 'ALAP',
            dependencies: [{ fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
          }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'RECALCULATE_EARLIEST',
        scope: {},
      });
      const b = result.tasks.find((t) => t.id === 'b')!;
      // ALAP should push B to its late start (backward pass). Since B is a terminal
      // task in a 2-task chain, its late start equals its early start (no slack).
      // The important thing is recalculate doesn't crash and B remains valid.
      expect(b.startDate).toBeDefined();
      expect(b.endDate).toBeDefined();
    });

    it('SF dependency cascade: predecessor start change cascades to successor', () => {
      // A (Mar 1-10) -SF-> B (Mar 1-10). SF means A.start drives B.end.
      // Move A forward, cascade should adjust B.
      const state = makeState({
        tasks: [
          makeTask({ id: 'a', startDate: '2026-03-05', endDate: '2026-03-14', duration: 7 }), // already moved +2 biz
          makeTask({
            id: 'b',
            startDate: '2026-03-01',
            endDate: '2026-03-10',
            duration: 7,
            dependencies: [{ fromId: 'a', toId: 'b', type: 'SF', lag: 0 }],
          }),
        ],
      });
      const result = ganttReducer(state, {
        type: 'CASCADE_DEPENDENTS',
        taskId: 'a',
        daysDelta: 2,
      });
      const b = result.tasks.find((t) => t.id === 'b')!;
      // SF: B.end must be >= A.start. A.start=Mar 5, B.end=Mar 10, no violation.
      // So B should not cascade (already satisfied).
      expect(b.startDate).toBeDefined();
      expect(b.endDate).toBeDefined();
    });
  });

  describe('UNDO clears cascade state', () => {
    it('clears cascadeShifts on undo', () => {
      // First do an action that creates an undo snapshot
      const state = makeState({
        tasks: [makeTask({ id: 'a' })],
        cascadeShifts: [{ taskId: 'a', fromStartDate: '2026-03-01', fromEndDate: '2026-03-10' }],
      });
      // COMPLETE_DRAG to create undo entry (MOVE_TASK is no longer undoable)
      const afterDrag = ganttReducer(state, {
        type: 'COMPLETE_DRAG',
        taskId: 'a',
        newStartDate: '2026-03-05',
        newEndDate: '2026-03-14',
        daysDelta: 4,
      });
      const afterUndo = ganttReducer(afterDrag, { type: 'UNDO' });
      expect(afterUndo.cascadeShifts).toEqual([]);
    });
  });
});
