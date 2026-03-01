import type { GanttState, Task } from '../types';
import type { GanttAction } from './actions';
import { cascadeDependents } from '../utils/schedulerWasm';
import { recalcSummaryDates } from '../utils/summaryUtils';

const UNDOABLE_ACTIONS = new Set([
  'MOVE_TASK', 'RESIZE_TASK', 'CASCADE_DEPENDENTS',
  'ADD_DEPENDENCY', 'UPDATE_DEPENDENCY', 'REMOVE_DEPENDENCY',
  'ADD_TASK', 'DELETE_TASK',
]);

export function ganttReducer(state: GanttState, action: GanttAction): GanttState {
  // Snapshot before undoable actions
  let stateForReducer = state;
  if (UNDOABLE_ACTIONS.has(action.type)) {
    const undoStack = [...state.undoStack, state.tasks].slice(-50);
    stateForReducer = { ...state, undoStack, redoStack: [] };
  }

  return ganttReducerInner(stateForReducer, action);
}

function ganttReducerInner(state: GanttState, action: GanttAction): GanttState {
  switch (action.type) {
    case 'MOVE_TASK': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, startDate: action.newStartDate, endDate: action.newEndDate }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'RESIZE_TASK': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, endDate: action.newEndDate, duration: action.newDuration }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'UPDATE_TASK_FIELD': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, [action.field]: action.value }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'TOGGLE_EXPAND': {
      const tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, isExpanded: !t.isExpanded }
          : t
      );
      return { ...state, tasks };
    }

    case 'SET_COLOR_BY':
      return { ...state, colorBy: action.colorBy };

    case 'SET_ZOOM':
      return { ...state, zoomLevel: action.zoomLevel };

    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };

    case 'TOGGLE_COLUMN': {
      const columns = state.columns.map(c =>
        c.key === action.columnKey ? { ...c, visible: !c.visible } : c
      );
      return { ...state, columns };
    }

    case 'SET_COLUMNS':
      return { ...state, columns: action.columns };

    case 'HIDE_TASK': {
      const tasks = state.tasks.map(t =>
        t.id === action.taskId ? { ...t, isHidden: true } : t
      );
      return { ...state, tasks };
    }

    case 'SHOW_ALL_TASKS': {
      const tasks = state.tasks.map(t => ({ ...t, isHidden: false }));
      return { ...state, tasks };
    }

    case 'TOGGLE_HISTORY_PANEL':
      return { ...state, isHistoryPanelOpen: !state.isHistoryPanelOpen };

    case 'START_SYNC':
      return { ...state, isSyncing: true, syncComplete: false };

    case 'COMPLETE_SYNC':
      return { ...state, isSyncing: false, syncComplete: true };

    case 'RESET_SYNC':
      return { ...state, syncComplete: false };

    case 'SET_CONTEXT_MENU':
      return { ...state, contextMenu: action.menu };

    case 'ADD_CHANGE_RECORD': {
      const record = {
        id: `ch-${Date.now()}`,
        timestamp: new Date().toISOString(),
        user: action.user,
        taskId: action.taskId,
        taskName: action.taskName,
        field: action.field,
        oldValue: action.oldValue,
        newValue: action.newValue,
      };
      return { ...state, changeHistory: [record, ...state.changeHistory] };
    }

    case 'CASCADE_DEPENDENTS': {
      let tasks = cascadeDependents(state.tasks, action.taskId, action.daysDelta);
      // Track which task IDs had their dates changed
      const changedIds: string[] = [];
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].startDate !== state.tasks[i]?.startDate || tasks[i].endDate !== state.tasks[i]?.endDate) {
          changedIds.push(tasks[i].id);
        }
      }
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks, lastCascadeIds: changedIds };
    }

    case 'TOGGLE_SHOW_OWNER_ON_BAR':
      return { ...state, showOwnerOnBar: !state.showOwnerOnBar };

    case 'TOGGLE_SHOW_AREA_ON_BAR':
      return { ...state, showAreaOnBar: !state.showAreaOnBar };

    case 'TOGGLE_SHOW_OKRS_ON_BAR':
      return { ...state, showOkrsOnBar: !state.showOkrsOnBar };

    case 'TOGGLE_CRITICAL_PATH':
      return { ...state, showCriticalPath: !state.showCriticalPath };

    case 'ADD_DEPENDENCY': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, dependencies: [...t.dependencies, action.dependency] }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'UPDATE_DEPENDENCY': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? {
              ...t,
              dependencies: t.dependencies.map(d =>
                d.fromId === action.fromId
                  ? { ...d, type: action.newType, lag: action.newLag }
                  : d
              ),
            }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'REMOVE_DEPENDENCY': {
      let tasks = state.tasks.map(t =>
        t.id === action.taskId
          ? { ...t, dependencies: t.dependencies.filter(d => d.fromId !== action.fromId) }
          : t
      );
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'SET_TASKS':
      return { ...state, tasks: action.tasks };

    case 'SET_DEPENDENCY_EDITOR':
      return { ...state, dependencyEditor: action.editor };

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'ADD_TASK': {
      const newId = `task-${Date.now()}`;
      const today = new Date().toISOString().split('T')[0];
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 5);
      const endDateStr = endDate.toISOString().split('T')[0];

      const newTask: Task = {
        id: newId,
        name: 'New Task',
        startDate: today,
        endDate: endDateStr,
        duration: 5,
        owner: '',
        workStream: '',
        project: '',
        functionalArea: '',
        done: false,
        description: '',
        isMilestone: false,
        isSummary: false,
        parentId: action.parentId,
        childIds: [],
        dependencies: [],
        isExpanded: false,
        isHidden: false,
        notes: '',
        okrs: [],
      };

      let tasks = [...state.tasks];

      // If it has a parent, add to parent's childIds
      if (action.parentId) {
        tasks = tasks.map(t =>
          t.id === action.parentId
            ? { ...t, childIds: [...t.childIds, newId] }
            : t
        );
      }

      // Insert after the specified task, or at the end
      if (action.afterTaskId) {
        const idx = tasks.findIndex(t => t.id === action.afterTaskId);
        if (idx !== -1) {
          let insertIdx = idx + 1;
          const afterTask = tasks[idx];
          if (afterTask.isSummary && afterTask.isExpanded) {
            const descendants = new Set<string>();
            const queue = [...afterTask.childIds];
            while (queue.length > 0) {
              const cid = queue.pop()!;
              descendants.add(cid);
              const child = tasks.find(t => t.id === cid);
              if (child) queue.push(...child.childIds);
            }
            while (insertIdx < tasks.length && descendants.has(tasks[insertIdx].id)) {
              insertIdx++;
            }
          }
          tasks.splice(insertIdx, 0, newTask);
        } else {
          tasks.push(newTask);
        }
      } else {
        tasks.push(newTask);
      }

      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    case 'DELETE_TASK': {
      const toDelete = new Set<string>();
      const queue = [action.taskId];
      while (queue.length > 0) {
        const id = queue.pop()!;
        toDelete.add(id);
        const task = state.tasks.find(t => t.id === id);
        if (task) queue.push(...task.childIds);
      }

      let tasks = state.tasks
        .filter(t => !toDelete.has(t.id))
        .map(t => ({
          ...t,
          childIds: t.childIds.filter(cid => !toDelete.has(cid)),
          dependencies: t.dependencies.filter(d => !toDelete.has(d.fromId)),
        }));

      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks, contextMenu: null };
    }

    case 'SET_COLLAB_USERS':
      return { ...state, collabUsers: action.users };

    case 'SET_COLLAB_CONNECTED':
      return { ...state, isCollabConnected: action.connected };

    case 'SET_LAST_CASCADE_IDS':
      return { ...state, lastCascadeIds: action.taskIds };

    case 'SET_CRITICAL_PATH_SCOPE':
      return { ...state, criticalPathScope: action.scope };

    case 'TOGGLE_COLLAPSE_WEEKENDS':
      return { ...state, collapseWeekends: !state.collapseWeekends };

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        ...state,
        tasks: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.tasks],
        lastCascadeIds: [],
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        ...state,
        tasks: next,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, state.tasks],
        lastCascadeIds: [],
      };
    }

    default:
      return state;
  }
}
