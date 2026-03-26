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
} from '../mutations';
import { UIStoreContext } from '../store/UIStore';
import type { MutateAction, Task, CriticalPathScope, CollabUser } from '../types';
import {
  useYDocObserver,
  useUndoManager,
  useYDocPersistence,
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

export const CollabContext = createContext<{
  awareness: Awareness | null;
  collabUsers: CollabUser[];
  isCollabConnected: boolean;
}>({
  awareness: null,
  collabUsers: [],
  isCollabConnected: false,
});

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

export function TaskStoreProvider({
  children,
  doc: externalDoc,
  dataSource,
  demoTasks,
  roomId,
  accessToken,
  criticalPathScope = { type: 'project', name: '' },
  spreadsheetId,
  userName,
  userEmail,
}: TaskStoreProviderProps) {
  const taskStore = useMemo(() => new TaskStore(), []);
  const docRef = useRef<Y.Doc>(externalDoc ?? new Y.Doc());
  const uiStore = useContext(UIStoreContext);
  const draggedTaskIdRef = useRef<string | null>(null);

  const doc = docRef.current;

  const getDraggedTaskId = useCallback(() => draggedTaskIdRef.current, []);

  useYDocObserver(doc, taskStore, criticalPathScope, getDraggedTaskId);
  const { undoManagerRef, canUndo, canRedo } = useUndoManager(doc);
  useYDocPersistence(doc, roomId);
  useSandboxInit(doc, dataSource, demoTasks);
  const { awareness, collabUsers, isCollabConnected } = useCollabConnection(
    doc,
    roomId,
    accessToken,
    userName,
    userEmail
  );
  useSheetsSync(doc, spreadsheetId, uiStore, roomId, accessToken, undoManagerRef);

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

  return (
    <TaskStoreContext.Provider value={taskStore}>
      <UndoManagerContext.Provider value={undoManagerState}>
        <DragContext.Provider value={draggedTaskIdRef}>
          <CollabContext.Provider value={collabState}>
            <MutateContext.Provider value={mutate}>{children}</MutateContext.Provider>
          </CollabContext.Provider>
        </DragContext.Provider>
      </UndoManagerContext.Provider>
    </TaskStoreContext.Provider>
  );
}
