import type { GanttState, CriticalPathScope } from '../types';
import { defaultColumns } from '../data/defaultColumns';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('ganttlet-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  }
  return 'dark';
}

export const initialState: GanttState = {
  tasks: [],
  columns: defaultColumns,
  colorBy: 'owner',
  zoomLevel: 'day',
  searchQuery: '',
  changeHistory: [],
  users: [],
  isHistoryPanelOpen: false,
  isSyncing: false,
  syncComplete: false,
  contextMenu: null,
  showOwnerOnBar: true,
  showAreaOnBar: true,
  showOkrsOnBar: false,
  showCriticalPath: false,
  dependencyEditor: null,
  theme: getInitialTheme(),
  collabUsers: [],
  isCollabConnected: false,
  undoStack: [],
  redoStack: [],
  lastCascadeIds: [],
  cascadeShifts: [],
  criticalPathScope: { type: 'project', name: '' } as CriticalPathScope,
  collapseWeekends: true,
  focusNewTaskId: null,
  isLeftPaneCollapsed: false,
  reparentPicker: null,
  dataSource: undefined,
  syncError: null,
  sandboxDirty: false,
};
