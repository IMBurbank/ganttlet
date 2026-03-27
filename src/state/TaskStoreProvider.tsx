import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { TaskStore, TaskStoreContext } from '../store/TaskStore';
import { initializeYDoc } from '../collab/initialization';
import { MutateContext } from '../hooks/useMutate';
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
  recalculateEarliestMutation,
} from '../mutations';
import { UIStoreContext } from '../store/UIStore';
import type { MutateAction, Task, CriticalPathScope, CollabUser } from '../types';
import {
  useYDocObserver,
  useUndoManager,
  useYDocPersistence,
  useDocMigration,
  useSandboxInit,
  useCollabConnection,
  useSheetsSync,
} from './hooks';

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
export const DragContext = createContext<RefObject<string | null>>({ current: null });

export const SheetsAdapterContext = createContext<{ restart: () => Promise<void> } | null>(null);

export const CollabContext = createContext<{
  awareness: Awareness | null;
  collabUsers: CollabUser[];
  isCollabConnected: boolean;
}>({
  awareness: null,
  collabUsers: [],
  isCollabConnected: false,
});

const DEFAULT_CRITICAL_PATH_SCOPE: CriticalPathScope = { type: 'project', name: '' };

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
  /** User display name for collab awareness */
  userName?: string;
  /** User email for collab awareness */
  userEmail?: string;
}

/**
 * Outer component: handles Y.Doc creation, persistence sync, and schema migration.
 *
 * The inner component (TaskStoreProviderInner) only mounts after migration succeeds.
 * This is the Rust ownership pattern: you can't use an unmigrated doc because
 * the inner component doesn't exist in the React tree until migration is done.
 */
export function TaskStoreProvider({
  children,
  doc: externalDoc,
  dataSource,
  demoTasks,
  roomId,
  accessToken,
  criticalPathScope = DEFAULT_CRITICAL_PATH_SCOPE,
  spreadsheetId,
  userName,
  userEmail,
}: TaskStoreProviderProps) {
  const docRef = useRef<Y.Doc>(externalDoc ?? new Y.Doc());
  const doc = docRef.current;

  // Gate 1: wait for IndexedDB persistence sync
  const { isSynced } = useYDocPersistence(doc, roomId);

  // Gate 2: run schema migration after persistence sync
  const migrationResult = useDocMigration(doc, isSynced);

  // Pending: show nothing (or loading state — handled by WelcomeGate's dataSource check)
  if (!migrationResult) {
    return <>{children}</>;
  }

  // Incompatible: doc is from a future schema version
  if (migrationResult.status === 'incompatible') {
    return (
      <SchemaIncompatibleError
        docVersion={migrationResult.docVersion}
        codeVersion={migrationResult.codeVersion}
      />
    );
  }

  // Migration complete — mount the inner component with all hooks
  return (
    <TaskStoreProviderInner
      doc={doc}
      dataSource={dataSource}
      demoTasks={demoTasks}
      roomId={roomId}
      accessToken={accessToken}
      criticalPathScope={criticalPathScope}
      spreadsheetId={spreadsheetId}
      userName={userName}
      userEmail={userEmail}
    >
      {children}
    </TaskStoreProviderInner>
  );
}

/**
 * Schema incompatibility error.
 * Rendered when the Y.Doc has a higher schema version than the code supports.
 */
function SchemaIncompatibleError({
  docVersion,
  codeVersion,
}: {
  docVersion: number;
  codeVersion: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '2rem',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2 style={{ marginBottom: '1rem' }}>Update Required</h2>
      <p style={{ maxWidth: '32rem', lineHeight: 1.6 }}>
        This document uses schema version {docVersion}, but your app supports up to version{' '}
        {codeVersion}. Please refresh the page to get the latest version of Ganttlet.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: '1.5rem',
          padding: '0.75rem 2rem',
          borderRadius: '0.5rem',
          border: 'none',
          background: '#3b82f6',
          color: 'white',
          fontSize: '1rem',
          cursor: 'pointer',
        }}
      >
        Refresh
      </button>
    </div>
  );
}

/**
 * Inner component: only exists after schema migration succeeds.
 * Mounts all hooks that depend on a migrated Y.Doc.
 */
function TaskStoreProviderInner({
  children,
  doc,
  dataSource,
  demoTasks,
  roomId,
  accessToken,
  criticalPathScope = DEFAULT_CRITICAL_PATH_SCOPE,
  spreadsheetId,
  userName,
  userEmail,
}: Omit<TaskStoreProviderProps, 'doc'> & { doc: Y.Doc }) {
  const taskStore = useMemo(() => new TaskStore(), []);
  const uiStore = useContext(UIStoreContext);

  const draggedTaskIdRef = useRef<string | null>(null);

  const getDraggedTaskId = useCallback(() => draggedTaskIdRef.current, []);

  useYDocObserver(doc, taskStore, criticalPathScope, getDraggedTaskId);
  const { undoManagerRef, canUndo, canRedo } = useUndoManager(doc);
  useSandboxInit(doc, dataSource, demoTasks);
  const { awareness, collabUsers, isCollabConnected } = useCollabConnection(
    doc,
    roomId,
    accessToken,
    userName,
    userEmail
  );
  const sheetsAdapterRef = useSheetsSync(doc, spreadsheetId, uiStore, undoManagerRef, accessToken);

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
        case 'RECALCULATE_EARLIEST':
          recalculateEarliestMutation(doc, action.taskIds);
          break;
        case 'INITIALIZE_TASKS':
          initializeYDoc(doc, action.tasks);
          break;
      }
    },
    [doc]
  );

  const undoManagerState = useMemo<UndoManagerState>(
    () => ({
      undoManager: undoManagerRef.current,
      canUndo,
      canRedo,
    }),
    [canUndo, canRedo, undoManagerRef]
  );

  const collabState = useMemo(
    () => ({
      awareness,
      collabUsers,
      isCollabConnected,
    }),
    [awareness, collabUsers, isCollabConnected]
  );

  const sheetsAdapterValue = useMemo(
    () =>
      sheetsAdapterRef.current ? { restart: () => sheetsAdapterRef.current!.restart() } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref stable, re-evaluated on spreadsheetId change
    [spreadsheetId]
  );

  return (
    <TaskStoreContext.Provider value={taskStore}>
      <UndoManagerContext.Provider value={undoManagerState}>
        <DragContext.Provider value={draggedTaskIdRef}>
          <CollabContext.Provider value={collabState}>
            <SheetsAdapterContext.Provider value={sheetsAdapterValue}>
              <MutateContext.Provider value={mutate}>{children}</MutateContext.Provider>
            </SheetsAdapterContext.Provider>
          </CollabContext.Provider>
        </DragContext.Provider>
      </UndoManagerContext.Provider>
    </TaskStoreContext.Provider>
  );
}
