import { useContext, useCallback, useSyncExternalStore } from 'react';
import { TaskStoreContext } from '../store/TaskStore';
import type { Task } from '../types';

export function useTask(taskId: string): Task | undefined {
  const store = useContext(TaskStoreContext);
  if (!store) throw new Error('useTask must be used within TaskStoreProvider');

  const subscribe = useCallback((cb: () => void) => store.subscribe(taskId, cb), [store, taskId]);
  const getSnapshot = useCallback(() => store.getTask(taskId), [store, taskId]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useTaskOrder(): string[] {
  const store = useContext(TaskStoreContext);
  if (!store) throw new Error('useTaskOrder must be used within TaskStoreProvider');

  const subscribe = useCallback((cb: () => void) => store.subscribeGlobal(cb), [store]);
  const getSnapshot = useCallback(() => store.getTaskOrder(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useCriticalPath(): Set<string> {
  const store = useContext(TaskStoreContext);
  if (!store) throw new Error('useCriticalPath must be used within TaskStoreProvider');

  const subscribe = useCallback((cb: () => void) => store.subscribeGlobal(cb), [store]);
  const getSnapshot = useCallback(() => store.getCriticalPath(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useConflicts(): Map<string, string> {
  const store = useContext(TaskStoreContext);
  if (!store) throw new Error('useConflicts must be used within TaskStoreProvider');

  const subscribe = useCallback((cb: () => void) => store.subscribeGlobal(cb), [store]);
  const getSnapshot = useCallback(() => store.getConflicts(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
