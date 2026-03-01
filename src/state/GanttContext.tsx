import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { GanttState } from '../types';
import { ganttReducer } from './ganttReducer';
import type { GanttAction } from './actions';
import { fakeTasks, fakeUsers, fakeChangeHistory, defaultColumns } from '../data/fakeData';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('ganttlet-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  }
  return 'dark';
}

const initialState: GanttState = {
  tasks: fakeTasks,
  columns: defaultColumns,
  colorBy: 'owner',
  zoomLevel: 'day',
  searchQuery: '',
  changeHistory: fakeChangeHistory,
  users: fakeUsers,
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
};

const GanttStateContext = createContext<GanttState>(initialState);
const GanttDispatchContext = createContext<Dispatch<GanttAction>>(() => {});

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(ganttReducer, initialState);

  return (
    <GanttStateContext.Provider value={state}>
      <GanttDispatchContext.Provider value={dispatch}>
        {children}
      </GanttDispatchContext.Provider>
    </GanttStateContext.Provider>
  );
}

export function useGanttState() {
  return useContext(GanttStateContext);
}

export function useGanttDispatch() {
  return useContext(GanttDispatchContext);
}
