import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback, type Dispatch } from 'react';
import type { GanttState } from '../types';
import { ganttReducer } from './ganttReducer';
import type { GanttAction } from './actions';
import { fakeTasks, fakeUsers, fakeChangeHistory, defaultColumns } from '../data/fakeData';
import { initSync, loadFromSheet, scheduleSave, startPolling, stopPolling, getSpreadsheetId } from '../sheets/sheetsSync';
import { isSignedIn, getAccessToken } from '../sheets/oauth';
import { connectCollab, disconnectCollab } from '../collab/yjsProvider';
import { bindYjsToDispatch, applyTasksToYjs, applyActionToYjs } from '../collab/yjsBinding';
import { setLocalAwareness, getCollabUsers } from '../collab/awareness';
import type * as Y from 'yjs';

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
  collabUsers: [],
  isCollabConnected: false,
};

const GanttStateContext = createContext<GanttState>(initialState);
const GanttDispatchContext = createContext<Dispatch<GanttAction>>(() => {});

/** Action types that modify task data and should be synced to Yjs */
const TASK_MODIFYING_ACTIONS = new Set([
  'MOVE_TASK',
  'RESIZE_TASK',
  'UPDATE_TASK_FIELD',
  'TOGGLE_EXPAND',
  'HIDE_TASK',
  'SHOW_ALL_TASKS',
  'CASCADE_DEPENDENTS',
]);

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(ganttReducer, initialState);
  const yjsDocRef = useRef<Y.Doc | null>(null);

  // Wrap dispatch to also apply task-modifying actions to Yjs
  const collabDispatch = useCallback<Dispatch<GanttAction>>((action: GanttAction) => {
    dispatch(action);

    if (yjsDocRef.current && TASK_MODIFYING_ACTIONS.has(action.type)) {
      applyActionToYjs(yjsDocRef.current, action);
    }
  }, []);

  // Sheets sync integration
  useEffect(() => {
    const spreadsheetId = new URLSearchParams(window.location.search).get('sheet');
    if (!spreadsheetId) return;

    initSync(spreadsheetId, dispatch);

    loadFromSheet().then(tasks => {
      if (tasks.length > 0) {
        dispatch({ type: 'SET_TASKS', tasks });
      }
    });

    startPolling((tasks) => {
      dispatch({ type: 'SET_TASKS', tasks });
    });

    return () => stopPolling();
  }, [dispatch]);

  // Auto-save on task changes
  useEffect(() => {
    const spreadsheetId = getSpreadsheetId();
    if (spreadsheetId && isSignedIn()) {
      scheduleSave(state.tasks);
    }
  }, [state.tasks]);

  // Yjs collaboration connection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (!roomId) return;

    const accessToken = getAccessToken() || 'anonymous';

    let cleanup: (() => void) | null = null;

    try {
      const { doc, provider, awareness } = connectCollab(roomId, accessToken);
      yjsDocRef.current = doc;

      cleanup = bindYjsToDispatch(doc, dispatch);

      setLocalAwareness(awareness, {
        name: 'Anonymous User',
        email: '',
      });

      provider.on('status', (event: { status: string }) => {
        const connected = event.status === 'connected';
        dispatch({ type: 'SET_COLLAB_CONNECTED', connected });

        if (connected) {
          const yarray = doc.getArray('tasks');
          if (yarray.length === 0) {
            applyTasksToYjs(doc, fakeTasks);
          }
        }
      });

      awareness.on('change', () => {
        const users = getCollabUsers(awareness);
        dispatch({ type: 'SET_COLLAB_USERS', users });
      });
    } catch (err) {
      console.warn('Failed to connect to collaboration server:', err);
    }

    return () => {
      if (cleanup) cleanup();
      yjsDocRef.current = null;
      disconnectCollab();
      dispatch({ type: 'SET_COLLAB_CONNECTED', connected: false });
      dispatch({ type: 'SET_COLLAB_USERS', users: [] });
    };
  }, []);

  return (
    <GanttStateContext.Provider value={state}>
      <GanttDispatchContext.Provider value={collabDispatch}>
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
