import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useState,
  useCallback,
  type Dispatch,
} from 'react';
import type { GanttState } from '../types';
import { ganttReducer } from './ganttReducer';
import { TASK_MODIFYING_ACTIONS, type GanttAction } from './actions';
import { initialState } from './initialState';
import {
  initSync,
  loadFromSheet,
  scheduleSave,
  startPolling,
  stopPolling,
  getSpreadsheetId,
} from '../sheets/sheetsSync';
import { classifySyncError } from '../sheets/syncErrors';
import { addRecentSheet } from '../utils/recentSheets';
import {
  isSignedIn,
  getAccessToken,
  getAuthState,
  setAuthChangeCallback,
  removeAuthChangeCallback,
  type AuthState,
} from '../sheets/oauth';
import { connectCollab, disconnectCollab } from '../collab/yjsProvider';
import {
  bindYjsToDispatch,
  applyTasksToYjs,
  applyActionToYjs,
  hydrateYjsFromTasks,
} from '../collab/yjsBinding';
import { setLocalAwareness, updateViewingTask, getCollabUsers } from '../collab/awareness';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

const GanttStateContext = createContext<GanttState>(initialState);
const GanttDispatchContext = createContext<Dispatch<GanttAction>>(() => {});
const LocalDispatchContext = createContext<Dispatch<GanttAction>>(() => {});
const activeDragDefault: React.RefObject<string | null> = { current: null };
const ActiveDragContext = createContext<React.RefObject<string | null>>(activeDragDefault);
const AwarenessContext = createContext<Awareness | null>(null);

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(ganttReducer, initialState);
  const yjsDocRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const pendingFullSyncRef = useRef(false);
  const loadedSheetTasksRef = useRef<import('../types').Task[]>([]);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(getAccessToken());

  /** Track which task is currently being dragged (for SET_TASKS guard) */
  const activeDragRef = useRef<string | null>(null);
  /** State ref for SET_TASKS guard to access current tasks */
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track auth state changes so collab can reconnect after sign-in
  useEffect(() => {
    const handleAuthChange = (authState: AuthState) => {
      setAccessToken(authState.accessToken);
    };
    setAuthChangeCallback(handleAuthChange);
    return () => removeAuthChangeCallback(handleAuthChange);
  }, []);

  // Guarded dispatch: preserves dragged task's dates when SET_TASKS arrives during drag (R3)
  const guardedDispatch = useCallback<Dispatch<GanttAction>>(
    (action: GanttAction) => {
      if (action.type === 'SET_TASKS' && activeDragRef.current) {
        const dragId = activeDragRef.current;
        const currentTask = stateRef.current.tasks.find((t) => t.id === dragId);
        if (currentTask) {
          const preserved = action.tasks.map((t) =>
            t.id === dragId
              ? {
                  ...t,
                  startDate: currentTask.startDate,
                  endDate: currentTask.endDate,
                  duration: currentTask.duration,
                }
              : t
          );
          dispatch({ type: 'SET_TASKS', tasks: preserved });
          return;
        }
      }
      dispatch(action);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [dispatch]
  );

  // Wrap dispatch to also apply task-modifying actions to Yjs
  const collabDispatch = useCallback<Dispatch<GanttAction>>((action: GanttAction) => {
    dispatch(action);

    // Only sync to Yjs when connected to a sheet
    if (stateRef.current.dataSource !== 'sheet') return;

    if (
      action.type === 'UNDO' ||
      action.type === 'REDO' ||
      action.type === 'REPARENT_TASK' ||
      action.type === 'ADD_TASK' ||
      action.type === 'DELETE_TASK'
    ) {
      // These actions change the task array structure — flag for full sync in useEffect
      pendingFullSyncRef.current = true;
    } else if (yjsDocRef.current && TASK_MODIFYING_ACTIONS.has(action.type)) {
      applyActionToYjs(yjsDocRef.current, action);
    }
  }, []);

  // Sheets sync integration
  useEffect(() => {
    const spreadsheetId = new URLSearchParams(window.location.search).get('sheet');
    if (!spreadsheetId || !isSignedIn()) return;

    // Skip re-initialization if already connected (e.g. silent token refresh)
    const current = stateRef.current.dataSource;
    if (current === 'sheet' || current === 'empty') return;

    dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'loading' });
    initSync(spreadsheetId, dispatch);

    loadFromSheet()
      .then((tasks) => {
        if (tasks.length > 0) {
          dispatch({ type: 'SET_TASKS', tasks });
          dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
          loadedSheetTasksRef.current = tasks;
        } else {
          dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'empty' });
        }
        addRecentSheet({ sheetId: spreadsheetId, title: spreadsheetId, lastOpened: Date.now() });
      })
      .catch((err) => {
        dispatch({ type: 'RESET_SYNC' });
        const classified = classifySyncError(err);
        dispatch({ type: 'SET_SYNC_ERROR', error: classified });
        // Hard-stop polling for unrecoverable errors
        if (classified.type === 'not_found' || classified.type === 'forbidden') {
          stopPolling();
        }
      });

    startPolling();

    return () => stopPolling();
  }, [dispatch, accessToken]);

  // Auto-save on task changes
  useEffect(() => {
    if (state.dataSource !== 'sheet') return;
    const spreadsheetId = getSpreadsheetId();
    if (spreadsheetId && isSignedIn()) {
      scheduleSave(state.tasks);
    }
  }, [state.tasks, state.dataSource]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      dispatch({ type: 'SET_SYNC_ERROR', error: null });
      // Trigger immediate sync on reconnect — use stateRef for current tasks
      if (getSpreadsheetId() && isSignedIn()) {
        scheduleSave(stateRef.current.tasks);
      }
    };
    const handleOffline = () => {
      dispatch({
        type: 'SET_SYNC_ERROR',
        error: { type: 'network', message: 'You are offline', since: Date.now() },
      });
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [dispatch]);

  // Yjs collaboration connection — reconnects when access token changes (e.g. after sign-in)
  useEffect(() => {
    if (state.dataSource !== 'sheet') return;
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    // Use React state first, fall back to module state (handles timing where
    // initOAuth/restoreSession runs after this effect fires on initial mount)
    const token = accessToken || getAccessToken();
    if (!roomId || !token) return;

    let cleanup: (() => void) | null = null;

    try {
      const { doc, provider, awareness: aw } = connectCollab(roomId, token);
      yjsDocRef.current = doc;
      awarenessRef.current = aw;
      setAwareness(aw);

      cleanup = bindYjsToDispatch(doc, guardedDispatch);

      const auth = getAuthState();
      setLocalAwareness(aw, {
        name: auth.userName || auth.userEmail || 'Anonymous User',
        email: auth.userEmail || '',
      });

      provider.on('status', (event: { status: string }) => {
        const connected = event.status === 'connected';
        dispatch({ type: 'SET_COLLAB_CONNECTED', connected });

        if (connected) {
          // If Yjs is empty, hydrate from Sheets data
          if (loadedSheetTasksRef.current.length > 0) {
            hydrateYjsFromTasks(doc, loadedSheetTasksRef.current);
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
  }, [accessToken, state.dataSource]);

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

  // Warn before leaving with unsaved sandbox changes
  useEffect(() => {
    if (state.dataSource !== 'sandbox' || !state.sandboxDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.dataSource, state.sandboxDirty]);

  return (
    <GanttStateContext.Provider value={state}>
      <GanttDispatchContext.Provider value={collabDispatch}>
        <LocalDispatchContext.Provider value={dispatch}>
          <ActiveDragContext.Provider value={activeDragRef}>
            <AwarenessContext.Provider value={awareness}>{children}</AwarenessContext.Provider>
          </ActiveDragContext.Provider>
        </LocalDispatchContext.Provider>
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

/** Local-only dispatch (React state update, no Yjs sync). Use for drag previews. */
export function useLocalDispatch() {
  return useContext(LocalDispatchContext);
}

/** Ref to set/clear the active drag task ID (for SET_TASKS guard). */
export function useActiveDrag() {
  return useContext(ActiveDragContext);
}

/** Access the Yjs awareness instance for presence features. */
export function useAwareness() {
  return useContext(AwarenessContext);
}

/**
 * Update which task/cell the local user is viewing.
 * Call with (null, null) to clear.
 */
export function useSetViewingTask() {
  const aw = useContext(AwarenessContext);
  return useCallback(
    (taskId: string | null, cellColumn: string | null) => {
      if (aw) {
        updateViewingTask(aw, taskId, cellColumn);
      }
    },
    [aw]
  );
}
