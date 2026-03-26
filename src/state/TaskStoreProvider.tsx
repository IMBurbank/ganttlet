import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { TaskStore, TaskStoreContext } from '../store/TaskStore';
import { MutateContext } from '../hooks/useMutate';
import { setupObserver } from '../collab/observer';
import { initializeYDoc } from '../collab/initialization';
import {
  moveTask,
  resizeTask,
  addTask,
  deleteTask,
  reparentTask,
  updateTaskField,
  addDependency,
  updateDependency,
  removeDependency,
  setConstraint,
} from '../mutations';
import { connectCollab, disconnectCollab } from '../collab/yjsProvider';
import { SheetsAdapter } from '../sheets/SheetsAdapter';
import { getAccessToken, setAuthChangeCallback, removeAuthChangeCallback } from '../sheets/oauth';
import { UIStoreContext } from '../store/UIStore';
import type { MutateAction, Task, CriticalPathScope, ConflictRecord } from '../types';

export interface UndoManagerState {
  undoManager: Y.UndoManager | null;
  canUndo: boolean;
  canRedo: boolean;
}

export const UndoManagerContext = createContext<UndoManagerState>({
  undoManager: null,
  canUndo: false,
  canRedo: false,
});

/** Ref to the task ID currently being dragged locally.
 *  TaskBar sets this during pointer capture; observer reads it to skip remote updates. */
export const DragContext = createContext<MutableRefObject<string | null>>({ current: null });

interface TaskStoreProviderProps {
  children: React.ReactNode;
  /** External Y.Doc (for testing or shared doc scenarios). If not provided, a new one is created. */
  doc?: Y.Doc;
  /** Data source mode */
  dataSource?: 'sandbox' | 'sheet' | 'loading' | 'empty';
  /** Demo tasks for sandbox mode */
  demoTasks?: Task[];
  /** Collab room ID (typically a Google Sheet ID) */
  roomId?: string;
  /** OAuth access token for collab auth */
  accessToken?: string;
  /** Critical path scope for cold derivations */
  criticalPathScope?: CriticalPathScope;
  /** Spreadsheet ID for sheet mode (enables SheetsAdapter) */
  spreadsheetId?: string;
}

export function TaskStoreProvider({
  children,
  doc: externalDoc,
  dataSource,
  demoTasks,
  roomId,
  accessToken,
  criticalPathScope = { type: 'project', name: '' },
  spreadsheetId,
}: TaskStoreProviderProps) {
  const taskStore = useMemo(() => new TaskStore(), []);
  const docRef = useRef<Y.Doc>(externalDoc ?? new Y.Doc());
  const uiStore = useContext(UIStoreContext);
  const draggedTaskIdRef = useRef<string | null>(null);
  const adapterRef = useRef<SheetsAdapter | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);
  const [undoState, setUndoState] = React.useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });

  const doc = docRef.current;

  // Set up observer on mount
  useEffect(() => {
    const cleanup = setupObserver(
      doc,
      taskStore,
      { criticalPathScope },
      () => draggedTaskIdRef.current
    );
    return cleanup;
  }, [doc, taskStore, criticalPathScope]);

  // Y.UndoManager: scoped to 'local' origin, captureTimeout 500ms
  useEffect(() => {
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const um = new Y.UndoManager(ytasks, {
      trackedOrigins: new Set(['local']),
      captureTimeout: 500,
    });
    undoManagerRef.current = um;

    const updateState = () => {
      setUndoState({ canUndo: um.canUndo(), canRedo: um.canRedo() });
    };
    um.on('stack-item-added', updateState);
    um.on('stack-item-popped', updateState);
    um.on('stack-cleared', updateState);

    return () => {
      um.destroy();
      undoManagerRef.current = null;
    };
  }, [doc]);

  // Listen for undo/redo events from UIStoreProvider keyboard handler
  useEffect(() => {
    const handleUndo = () => {
      if (undoManagerRef.current?.canUndo()) {
        undoManagerRef.current.undo();
      }
    };
    const handleRedo = () => {
      if (undoManagerRef.current?.canRedo()) {
        undoManagerRef.current.redo();
      }
    };
    window.addEventListener('ganttlet:undo', handleUndo);
    window.addEventListener('ganttlet:redo', handleRedo);
    return () => {
      window.removeEventListener('ganttlet:undo', handleUndo);
      window.removeEventListener('ganttlet:redo', handleRedo);
    };
  }, []);

  // y-indexeddb persistence for crash recovery
  useEffect(() => {
    if (!roomId) return;

    const persistence = new IndexeddbPersistence(`ganttlet-${roomId}`, doc);
    persistenceRef.current = persistence;

    persistence.on('synced', () => {
      console.log('IndexedDB persistence synced for room:', roomId);
    });

    return () => {
      persistence.destroy();
      persistenceRef.current = null;
    };
  }, [doc, roomId]);

  // Sandbox initialization
  useEffect(() => {
    if (dataSource === 'sandbox' && demoTasks && demoTasks.length > 0) {
      initializeYDoc(doc, demoTasks);
    }
  }, [doc, dataSource, demoTasks]);

  // Collab connection
  useEffect(() => {
    if (!roomId || !accessToken) return;

    connectCollab(roomId, accessToken);

    return () => {
      disconnectCollab();
    };
  }, [roomId, accessToken]);

  // SheetsAdapter: init on sheet mode, cleanup on disconnect
  useEffect(() => {
    if (!spreadsheetId || !uiStore) return;

    // Clear undo stack on sandbox→sheet promotion
    if (undoManagerRef.current) {
      undoManagerRef.current.clear();
      setUndoState({ canUndo: false, canRedo: false });
    }

    const adapter = new SheetsAdapter(
      doc,
      spreadsheetId,
      {
        onConflict: (conflicts: ConflictRecord[]) => {
          uiStore.setState({ pendingConflicts: conflicts });
        },
        onSyncError: (error) => {
          uiStore.setState({ syncError: error });
        },
        onSyncing: (syncing) => {
          uiStore.setState({ isSyncing: syncing });
        },
        onSyncComplete: () => {
          uiStore.setState({ syncComplete: true, dataSource: 'sheet' });
        },
      },
      getAccessToken
    );

    adapterRef.current = adapter;
    uiStore.setState({ dataSource: 'loading' });
    adapter.start();

    // beforeunload guard for sheet mode
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (adapter.isSavePending()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // Auth token refresh: restart adapter polling on token change
    const authChangeHandler = () => {
      // Token refreshed — adapter will pick it up on next poll/write via getAccessToken
      // Reconnect collab if needed
      if (roomId && accessToken) {
        connectCollab(roomId, accessToken);
      }
    };
    setAuthChangeCallback(authChangeHandler);

    // Conflict resolution event handler
    const conflictResolveHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { taskId: string; field: string; value: unknown };
      updateTaskField(doc, detail.taskId, detail.field, detail.value);
    };
    window.addEventListener('ganttlet:conflict-resolve', conflictResolveHandler);

    return () => {
      adapter.stop();
      adapterRef.current = null;
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      removeAuthChangeCallback(authChangeHandler);
      window.removeEventListener('ganttlet:conflict-resolve', conflictResolveHandler);
    };
  }, [spreadsheetId, doc, uiStore, roomId, accessToken]);

  // Mutate dispatcher
  const mutate = useCallback(
    (action: MutateAction) => {
      switch (action.type) {
        case 'MOVE_TASK':
          moveTask(doc, action.taskId, action.newStart, action.newEnd);
          break;
        case 'RESIZE_TASK':
          resizeTask(doc, action.taskId, action.newEnd);
          break;
        case 'UPDATE_FIELD':
          updateTaskField(doc, action.taskId, action.field, action.value);
          break;
        case 'SET_CONSTRAINT':
          setConstraint(
            doc,
            action.taskId,
            action.constraintType as Task['constraintType'],
            action.constraintDate
          );
          break;
        case 'ADD_TASK':
          addTask(doc, action.task, action.afterTaskId);
          break;
        case 'DELETE_TASK':
          deleteTask(doc, action.taskId);
          break;
        case 'REPARENT_TASK':
          reparentTask(doc, action.taskId, action.newParentId);
          break;
        case 'ADD_DEPENDENCY':
          addDependency(doc, action.taskId, action.dep);
          break;
        case 'UPDATE_DEPENDENCY':
          updateDependency(doc, action.taskId, action.fromId, action.update);
          break;
        case 'REMOVE_DEPENDENCY':
          removeDependency(doc, action.taskId, action.fromId);
          break;
      }
    },
    [doc]
  );

  const undoManagerState = useMemo<UndoManagerState>(
    () => ({
      undoManager: undoManagerRef.current,
      ...undoState,
    }),
    [undoState]
  );

  return (
    <TaskStoreContext.Provider value={taskStore}>
      <UndoManagerContext.Provider value={undoManagerState}>
        <DragContext.Provider value={draggedTaskIdRef}>
          <MutateContext.Provider value={mutate}>{children}</MutateContext.Provider>
        </DragContext.Provider>
      </UndoManagerContext.Provider>
    </TaskStoreContext.Provider>
  );
}
