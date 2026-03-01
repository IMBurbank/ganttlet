// ============================================================================
// Ganttlet Type Definitions
// ============================================================================

export type TaskType = 'task' | 'summary' | 'milestone';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ResourceRole = 'engineer' | 'designer' | 'pm' | 'ux' | 'qa' | 'devops';
export type ZoomLevel = 'day' | 'week' | 'month';
export type ColorMode = 'workstream' | 'project' | 'resource' | 'criticality';
export type ChangeType = 'create' | 'update' | 'delete' | 'move' | 'link' | 'unlink';

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  startDate: Date;
  endDate: Date;
  duration: number; // working days
  percentComplete: number; // 0-100
  parentId: string | null;
  wbsCode: string;
  level: number;
  isCollapsed: boolean;
  workstreamId: string;
  projectId: string;
  assignedResourceIds: string[];
  // CPM fields
  earlyStart: Date | null;
  earlyFinish: Date | null;
  lateStart: Date | null;
  lateFinish: Date | null;
  totalFloat: number | null;
  freeFloat: number | null;
  isCritical: boolean;
  notes: string;
  sortOrder: number;
}

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number; // positive = lag, negative = lead
}

export interface Resource {
  id: string;
  name: string;
  initials: string;
  role: ResourceRole;
  avatarColor: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
}

export interface Workstream {
  id: string;
  name: string;
  color: string;
  projectId: string;
}

export interface ChangeRecord {
  id: string;
  timestamp: Date;
  userId: string;
  changeType: ChangeType;
  taskId: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  description: string;
}

export interface CollaborationUser {
  id: string;
  name: string;
  avatarColor: string;
  initials: string;
  isYou: boolean;
  cursorX: number;
  cursorY: number;
  selectedTaskId: string | null;
  isOnline: boolean;
  lastSeen: Date;
}

export interface ColumnConfig {
  id: string;
  label: string;
  width: number;
  visible: boolean;
  field: keyof Task | 'resources';
}

// 12-color fixed palette
export const COLORS = {
  indigo: '#6366f1',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  teal: '#14b8a6',
  green: '#22c55e',
  lime: '#84cc16',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899',
  purple: '#a855f7',
  violet: '#8b5cf6',
} as const;

export const COLOR_ARRAY = Object.values(COLORS);
