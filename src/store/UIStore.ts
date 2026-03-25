import { createContext } from 'react';
import type { ColorByField, ColumnConfig } from '../types';
import type { ConflictRecord } from '../types';

export interface UIState {
  dataSource: 'sandbox' | 'loading' | 'sheet' | 'empty' | undefined;
  zoomLevel: 'day' | 'week' | 'month';
  colorBy: ColorByField;
  showCriticalPath: boolean;
  criticalPathScope: { type: 'all' } | { type: 'project' | 'workstream'; name: string };
  theme: 'light' | 'dark';
  columns: ColumnConfig[];
  searchQuery: string;
  expandedTasks: Set<string>;
  isLeftPaneCollapsed: boolean;
  showOwnerOnBar: boolean;
  showAreaOnBar: boolean;
  showOkrsOnBar: boolean;
  collapseWeekends: boolean;
  contextMenu: { x: number; y: number; taskId: string } | null;
  dependencyEditor: { taskId: string; highlightFromId?: string } | null;
  reparentPicker: { taskId: string } | null;
  focusNewTaskId: string | null;
  pendingConflicts: ConflictRecord[] | null;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'name', label: 'Task Name', width: 200, visible: true },
  { key: 'startDate', label: 'Start Date', width: 100, visible: true },
  { key: 'endDate', label: 'End Date', width: 100, visible: true },
  { key: 'duration', label: 'Duration', width: 80, visible: true },
  { key: 'owner', label: 'Owner', width: 120, visible: true },
  { key: 'done', label: 'Done', width: 60, visible: true },
];

export function createDefaultUIState(): UIState {
  return {
    dataSource: undefined,
    zoomLevel: 'week',
    colorBy: 'workStream',
    showCriticalPath: false,
    criticalPathScope: { type: 'all' },
    theme: 'light',
    columns: DEFAULT_COLUMNS,
    searchQuery: '',
    expandedTasks: new Set<string>(),
    isLeftPaneCollapsed: false,
    showOwnerOnBar: false,
    showAreaOnBar: false,
    showOkrsOnBar: false,
    collapseWeekends: false,
    contextMenu: null,
    dependencyEditor: null,
    reparentPicker: null,
    focusNewTaskId: null,
    pendingConflicts: null,
  };
}

export class UIStore {
  private state: UIState;
  private listeners = new Set<() => void>();

  constructor(initialState?: Partial<UIState>) {
    this.state = { ...createDefaultUIState(), ...initialState };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): UIState {
    return this.state;
  }

  setState(update: Partial<UIState>): void {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((l) => l());
  }
}

export const UIStoreContext = createContext<UIStore | null>(null);
