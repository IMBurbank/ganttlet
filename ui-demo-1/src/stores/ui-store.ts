import { create } from 'zustand';
import type { ColorMode, ColumnConfig } from '../types';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'wbs', label: 'WBS', width: 60, visible: true, field: 'wbsCode' },
  { id: 'name', label: 'Task Name', width: 200, visible: true, field: 'name' },
  { id: 'start', label: 'Start', width: 90, visible: true, field: 'startDate' },
  { id: 'end', label: 'End', width: 90, visible: true, field: 'endDate' },
  { id: 'duration', label: 'Duration', width: 70, visible: true, field: 'duration' },
  { id: 'pctComplete', label: '%', width: 45, visible: true, field: 'percentComplete' },
  { id: 'resources', label: 'Resources', width: 90, visible: false, field: 'resources' as any },
];

interface UIStore {
  selectedTaskId: string | null;
  detailPanelOpen: boolean;
  historyPanelOpen: boolean;
  colorMode: ColorMode;
  showCriticalPath: boolean;
  columns: ColumnConfig[];

  setSelectedTask: (taskId: string | null) => void;
  toggleDetailPanel: () => void;
  toggleHistoryPanel: () => void;
  setColorMode: (mode: ColorMode) => void;
  toggleCriticalPath: () => void;
  toggleColumn: (columnId: string) => void;
  setColumnWidth: (columnId: string, width: number) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedTaskId: null,
  detailPanelOpen: false,
  historyPanelOpen: false,
  colorMode: 'workstream',
  showCriticalPath: false,
  columns: DEFAULT_COLUMNS,

  setSelectedTask: (taskId) => set({ selectedTaskId: taskId }),

  toggleDetailPanel: () =>
    set((state) => ({ detailPanelOpen: !state.detailPanelOpen })),

  toggleHistoryPanel: () =>
    set((state) => ({ historyPanelOpen: !state.historyPanelOpen })),

  setColorMode: (mode) => set({ colorMode: mode }),

  toggleCriticalPath: () =>
    set((state) => ({ showCriticalPath: !state.showCriticalPath })),

  toggleColumn: (columnId) =>
    set((state) => ({
      columns: state.columns.map((col) =>
        col.id === columnId ? { ...col, visible: !col.visible } : col
      ),
    })),

  setColumnWidth: (columnId, width) =>
    set((state) => ({
      columns: state.columns.map((col) =>
        col.id === columnId ? { ...col, width } : col
      ),
    })),
}));
