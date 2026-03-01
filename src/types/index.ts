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
  duration: number; // business days
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
}

export interface ColumnConfig {
  key: string;
  label: string;
  width: number;
  visible: boolean;
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
}
