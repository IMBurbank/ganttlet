import type {
  ColorByField,
  ZoomLevel,
  ColumnConfig,
  CollabUser,
  Dependency,
  DependencyType,
  Task,
  CriticalPathScope,
  CascadeShift,
  DataSource,
  SyncError,
  ChangeRecord,
} from '../types';

export type GanttAction =
  | { type: 'MOVE_TASK'; taskId: string; newStartDate: string; newEndDate: string }
  | { type: 'RESIZE_TASK'; taskId: string; newEndDate: string; newDuration?: number }
  | {
      type: 'UPDATE_TASK_FIELD';
      taskId: string;
      field: string;
      value: string | number | boolean | string[];
    }
  | { type: 'TOGGLE_EXPAND'; taskId: string }
  | { type: 'SET_COLOR_BY'; colorBy: ColorByField }
  | { type: 'SET_ZOOM'; zoomLevel: ZoomLevel }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_COLUMN'; columnKey: string }
  | { type: 'SET_COLUMNS'; columns: ColumnConfig[] }
  | { type: 'HIDE_TASK'; taskId: string }
  | { type: 'SHOW_ALL_TASKS' }
  | { type: 'TOGGLE_HISTORY_PANEL' }
  | { type: 'START_SYNC' }
  | { type: 'COMPLETE_SYNC' }
  | { type: 'RESET_SYNC' }
  | { type: 'SET_CONTEXT_MENU'; menu: { x: number; y: number; taskId: string } | null }
  | {
      type: 'ADD_CHANGE_RECORD';
      taskId: string;
      taskName: string;
      field: string;
      oldValue: string;
      newValue: string;
      user: string;
    }
  | { type: 'CASCADE_DEPENDENTS'; taskId: string; daysDelta: number }
  | { type: 'TOGGLE_SHOW_OWNER_ON_BAR' }
  | { type: 'TOGGLE_SHOW_AREA_ON_BAR' }
  | { type: 'TOGGLE_SHOW_OKRS_ON_BAR' }
  | { type: 'TOGGLE_CRITICAL_PATH' }
  | { type: 'ADD_DEPENDENCY'; taskId: string; dependency: Dependency }
  | {
      type: 'UPDATE_DEPENDENCY';
      taskId: string;
      fromId: string;
      newType: DependencyType;
      newLag: number;
    }
  | { type: 'REMOVE_DEPENDENCY'; taskId: string; fromId: string }
  | { type: 'SET_DEPENDENCY_EDITOR'; editor: { taskId: string; highlightFromId?: string } | null }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'SET_TASKS'; tasks: Task[] }
  | { type: 'MERGE_EXTERNAL_TASKS'; externalTasks: Task[] }
  | { type: 'ADD_TASK'; parentId: string | null; afterTaskId: string | null }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'SET_COLLAB_USERS'; users: CollabUser[] }
  | { type: 'SET_COLLAB_CONNECTED'; connected: boolean }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_LAST_CASCADE_IDS'; taskIds: string[] }
  | { type: 'SET_CASCADE_SHIFTS'; shifts: CascadeShift[] }
  | { type: 'SET_CRITICAL_PATH_SCOPE'; scope: CriticalPathScope }
  | { type: 'TOGGLE_COLLAPSE_WEEKENDS' }
  | { type: 'REPARENT_TASK'; taskId: string; newParentId: string | null; newId?: string }
  | { type: 'SET_REPARENT_PICKER'; picker: { taskId: string } | null }
  | { type: 'TOGGLE_LEFT_PANE' }
  | { type: 'CLEAR_FOCUS_NEW_TASK' }
  | {
      type: 'RECALCULATE_EARLIEST';
      scope: { taskId?: string; workstream?: string; project?: string };
    }
  | {
      type: 'COMPLETE_DRAG';
      taskId: string;
      newStartDate: string;
      newEndDate: string;
      daysDelta: number;
    }
  | {
      type: 'SET_CONSTRAINT';
      taskId: string;
      constraintType: Task['constraintType'];
      constraintDate?: string;
    }
  | { type: 'SET_DATA_SOURCE'; dataSource: DataSource }
  | { type: 'SET_SYNC_ERROR'; error: SyncError | null }
  | { type: 'ENTER_SANDBOX'; tasks: Task[]; changeHistory: ChangeRecord[] }
  | { type: 'RESET_STATE' };

/** Action types that modify task data and should be synced to Yjs */
export const TASK_MODIFYING_ACTIONS = new Set([
  'MOVE_TASK',
  'RESIZE_TASK',
  'UPDATE_TASK_FIELD',
  'TOGGLE_EXPAND',
  'HIDE_TASK',
  'SHOW_ALL_TASKS',
  'CASCADE_DEPENDENTS',
  'COMPLETE_DRAG',
  'ADD_DEPENDENCY',
  'UPDATE_DEPENDENCY',
  'REMOVE_DEPENDENCY',
  'SET_CONSTRAINT',
]);
