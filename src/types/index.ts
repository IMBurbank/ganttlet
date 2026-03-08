export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';

export interface Dependency {
  fromId: string;
  toId: string;
  type: DependencyType;
  lag: number; // days, can be negative for lead
}

export interface Task {
  id: string;
  name: string;
  startDate: string; // ISO date string
  endDate: string;
  /** Number of business days (Mon-Fri) from startDate to endDate, inclusive of start, exclusive of end. Always derived — never edit directly. */
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
  isExpanded: boolean;
  isHidden: boolean;
  notes: string;
  okrs: string[];
  constraintType?: 'ASAP' | 'SNET' | 'ALAP' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
  constraintDate?: string;
}

export interface ConflictResult {
  task_id: string;
  conflict_type: string;
  constraint_date: string;
  actual_date: string;
  message: string;
}

export type ColorByField = 'owner' | 'workStream' | 'project' | 'functionalArea';

export type ZoomLevel = 'day' | 'week' | 'month';

export interface ChangeRecord {
  id: string;
  timestamp: string;
  user: string;
  taskId: string;
  taskName: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface FakeUser {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isOnline: boolean;
  viewingTaskId: string | null;
  viewingCellColumn: string | null;
}

export interface CollabUser {
  clientId: number;
  name: string;
  email: string;
  color: string;
  viewingTaskId: string | null;
  viewingCellColumn: string | null;
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

export interface CascadeShift {
  taskId: string;
  fromStartDate: string;
  fromEndDate: string;
}

export interface GanttState {
  tasks: Task[];
  columns: ColumnConfig[];
  colorBy: ColorByField;
  zoomLevel: ZoomLevel;
  searchQuery: string;
  changeHistory: ChangeRecord[];
  users: FakeUser[];
  isHistoryPanelOpen: boolean;
  isSyncing: boolean;
  syncComplete: boolean;
  contextMenu: { x: number; y: number; taskId: string } | null;
  showOwnerOnBar: boolean;
  showAreaOnBar: boolean;
  showOkrsOnBar: boolean;
  showCriticalPath: boolean;
  dependencyEditor: { taskId: string; highlightFromId?: string } | null;
  theme: 'light' | 'dark';
  collabUsers: CollabUser[];
  isCollabConnected: boolean;
  undoStack: Task[][];
  redoStack: Task[][];
  lastCascadeIds: string[];
  cascadeShifts: CascadeShift[];
  criticalPathScope: CriticalPathScope;
  collapseWeekends: boolean;
  focusNewTaskId: string | null;
  isLeftPaneCollapsed: boolean;
  reparentPicker: { taskId: string } | null;
}
