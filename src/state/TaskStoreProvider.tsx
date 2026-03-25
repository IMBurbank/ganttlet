import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
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
import type { MutateAction, Task, CriticalPathScope } from '../types';

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
}

export function TaskStoreProvider({
  children,
  doc: externalDoc,
  dataSource,
  demoTasks,
  roomId,
  accessToken,
  criticalPathScope = { type: 'project', name: '' },
}: TaskStoreProviderProps) {
  const taskStore = useMemo(() => new TaskStore(), []);
  const docRef = useRef<Y.Doc>(externalDoc ?? new Y.Doc());

  const doc = docRef.current;

  // Set up observer on mount
  useEffect(() => {
    const cleanup = setupObserver(doc, taskStore, { criticalPathScope });
    return cleanup;
  }, [doc, taskStore, criticalPathScope]);

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

  return (
    <TaskStoreContext.Provider value={taskStore}>
      <MutateContext.Provider value={mutate}>{children}</MutateContext.Provider>
    </TaskStoreContext.Provider>
  );
}
