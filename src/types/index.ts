export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';

export interface Dependency {
  fromId: string;
  toId: string;
  type: DependencyType;
  lag: number; // days, can be negative for lead
}

/**
 * Task — the core domain object. Stored in Y.Doc and persisted to Google Sheets.
 *
 * **Adding a field?** Don't edit setKnownFields/yMapToTask manually — they're
 * registry-driven. See the "Adding a Task field" checklist in src/CLAUDE.md.
 */
export interface Task {
  id: string;
  name: string;
  startDate: string; // ISO date string
  endDate: string;
  /** Business days in [startDate, endDate] inclusive of both. Always derived via taskDuration() — never edit directly. */
  duration: number;
  owner: string;
  workStream: string;
  project: string;
  functionalArea: string;
  done: boolean;
  description: string;
  isMilestone: boolean;
  isSummary: boolean;
  parentId: string | null;
  childIds: string[];
  dependencies: Dependency[];
  notes: string;
  okrs: string[];
  constraintType?: 'ASAP' | 'SNET' | 'ALAP' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
  constraintDate?: string;
}

export interface ConflictResult {
  taskId: string;
  conflictType: string;
  constraintDate: string;
  actualDate: string;
  message: string;
}

export type ColorByField = 'owner' | 'workStream' | 'project' | 'functionalArea';

export type ZoomLevel = 'day' | 'week' | 'month';

export interface CollabUser {
  clientId: number;
  name: string;
  email: string;
  color: string;
  viewingTaskId: string | null;
  dragging: { taskId: string; startDate: string; endDate: string } | null;
}

export interface ColumnConfig {
  key: string;
  label: string;
  width: number;
  visible: boolean;
}

export type CriticalPathScope =
  | { type: 'project'; name: string }
  | { type: 'workstream'; name: string };

export interface SyncError {
  type: 'auth' | 'not_found' | 'forbidden' | 'rate_limit' | 'network' | 'header_mismatch';
  message: string;
  since: number;
}

export interface ConflictRecord {
  taskId: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  baseValue: unknown;
}

export type MutateAction =
  | { type: 'MOVE_TASK'; taskId: string; newStart: string; newEnd: string }
  | { type: 'RESIZE_TASK'; taskId: string; newEnd: string }
  | { type: 'UPDATE_FIELD'; taskId: string; field: string; value: unknown }
  | { type: 'SET_CONSTRAINT'; taskId: string; constraintType: string; constraintDate?: string }
  | { type: 'ADD_TASK'; task: Partial<Task>; afterTaskId?: string }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'REPARENT_TASK'; taskId: string; newParentId: string }
  | { type: 'ADD_DEPENDENCY'; taskId: string; dep: Dependency }
  | { type: 'UPDATE_DEPENDENCY'; taskId: string; fromId: string; update: Partial<Dependency> }
  | { type: 'REMOVE_DEPENDENCY'; taskId: string; fromId: string }
  | { type: 'RECALCULATE_EARLIEST'; taskIds: string[] }
  | { type: 'INITIALIZE_TASKS'; tasks: Task[] };
