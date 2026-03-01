import type { GanttState } from '../types';
import type { GanttAction } from './actions';
import { cascadeDependents } from '../utils/dependencyUtils';
import { recalcSummaryDates } from '../utils/summaryUtils';

export function ganttReducer(state: GanttState, action: GanttAction): GanttState {
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
      tasks = recalcSummaryDates(tasks);
      return { ...state, tasks };
    }

    default:
      return state;
  }
}
