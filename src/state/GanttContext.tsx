import React, { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback, type Dispatch } from 'react';
import type { GanttState, CriticalPathScope } from '../types';
import { ganttReducer } from './ganttReducer';
import type { GanttAction } from './actions';
import { fakeTasks, fakeChangeHistory, defaultColumns } from '../data/fakeData';
import { initSync, loadFromSheet, scheduleSave, startPolling, stopPolling, getSpreadsheetId } from '../sheets/sheetsSync';
import { isSignedIn, getAccessToken, getAuthState, setAuthChangeCallback, removeAuthChangeCallback, type AuthState } from '../sheets/oauth';
import { connectCollab, disconnectCollab } from '../collab/yjsProvider';
import { bindYjsToDispatch, applyTasksToYjs, applyActionToYjs } from '../collab/yjsBinding';
import { setLocalAwareness, updateViewingTask, getCollabUsers } from '../collab/awareness';
import type { Awareness } from 'y-protocols/awareness';
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
};

const GanttStateContext = createContext<GanttState>(initialState);
const GanttDispatchContext = createContext<Dispatch<GanttAction>>(() => {});
const AwarenessContext = createContext<Awareness | null>(null);

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
  const awarenessRef = useRef<Awareness | null>(null);
  const pendingFullSyncRef = useRef(false);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(getAccessToken());

  // Track auth state changes so collab can reconnect after sign-in
  useEffect(() => {
    const handleAuthChange = (authState: AuthState) => {
      setAccessToken(authState.accessToken);
    };
    setAuthChangeCallback(handleAuthChange);
    return () => removeAuthChangeCallback(handleAuthChange);
  }, []);

  // Wrap dispatch to also apply task-modifying actions to Yjs
  const collabDispatch = useCallback<Dispatch<GanttAction>>((action: GanttAction) => {
    dispatch(action);

    if (action.type === 'UNDO' || action.type === 'REDO' || action.type === 'REPARENT_TASK') {
      // UNDO/REDO/REPARENT replace the entire task array — flag for full sync in useEffect
      pendingFullSyncRef.current = true;
    } else if (yjsDocRef.current && TASK_MODIFYING_ACTIONS.has(action.type)) {
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

    startPolling();

    return () => stopPolling();
  }, [dispatch]);

  // Auto-save on task changes
  useEffect(() => {
    const spreadsheetId = getSpreadsheetId();
    if (spreadsheetId && isSignedIn()) {
      scheduleSave(state.tasks);
    }
  }, [state.tasks]);

  // Yjs collaboration connection — reconnects when access token changes (e.g. after sign-in)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (!roomId || !accessToken) return;

    let cleanup: (() => void) | null = null;

    try {
      const { doc, provider, awareness: aw } = connectCollab(roomId, accessToken);
      yjsDocRef.current = doc;
      awarenessRef.current = aw;
      setAwareness(aw);

      cleanup = bindYjsToDispatch(doc, dispatch);

      const auth = getAuthState();
      setLocalAwareness(aw, {
        name: auth.userName || auth.userEmail || 'Anonymous User',
        email: auth.userEmail || '',
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

      aw.on('change', () => {
        const users = getCollabUsers(aw);
        dispatch({ type: 'SET_COLLAB_USERS', users });
      });
    } catch (err) {
      console.warn('Failed to connect to collaboration server:', err);
    }

    return () => {
      if (cleanup) cleanup();
      yjsDocRef.current = null;
      awarenessRef.current = null;
      setAwareness(null);
      disconnectCollab();
      dispatch({ type: 'SET_COLLAB_CONNECTED', connected: false });
      dispatch({ type: 'SET_COLLAB_USERS', users: [] });
    };
  }, [accessToken]);

  // Full Yjs sync after undo/redo (replaces entire task array)
  useEffect(() => {
    if (pendingFullSyncRef.current && yjsDocRef.current) {
      applyTasksToYjs(yjsDocRef.current, state.tasks);
      pendingFullSyncRef.current = false;
    }
  }, [state.tasks]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          collabDispatch({ type: 'REDO' });
        } else {
          collabDispatch({ type: 'UNDO' });
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        collabDispatch({ type: 'TOGGLE_LEFT_PANE' });
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [collabDispatch]);

  return (
    <GanttStateContext.Provider value={state}>
      <GanttDispatchContext.Provider value={collabDispatch}>
        <AwarenessContext.Provider value={awareness}>
          {children}
        </AwarenessContext.Provider>
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

/**
 * Update which task/cell the local user is viewing.
 * Call with (null, null) to clear.
 */
export function useSetViewingTask() {
  const aw = useContext(AwarenessContext);
  return useCallback((taskId: string | null, cellColumn: string | null) => {
    if (aw) {
      updateViewingTask(aw, taskId, cellColumn);
    }
  }, [aw]);
}
