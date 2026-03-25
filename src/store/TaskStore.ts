import { createContext } from 'react';
import type { Task } from '../types';

export class TaskStore {
  private tasks = new Map<string, Task>();
  private taskOrder: string[] = [];
  private listeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private criticalPath = new Set<string>();
  private conflicts = new Map<string, string>();

  subscribe(taskId: string, listener: () => void): () => void {
    if (!this.listeners.has(taskId)) this.listeners.set(taskId, new Set());
    this.listeners.get(taskId)!.add(listener);
    return () => this.listeners.get(taskId)?.delete(listener);
  }

  subscribeGlobal(listener: () => void): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Map<string, Task> {
    return this.tasks;
  }

  getAllTasksArray(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTaskOrder(): string[] {
    return this.taskOrder;
  }

  setTaskOrder(order: string[]): void {
    this.taskOrder = order;
    this.globalListeners.forEach((l) => l());
  }

  batchUpdate(changed: Map<string, Task>, deleted: Set<string>): void {
    for (const [id, task] of changed) this.tasks.set(id, task);
    for (const id of deleted) this.tasks.delete(id);

    // Notify ONLY changed/deleted task listeners — O(changed), not O(N)
    const affectedIds = [...changed.keys(), ...deleted];
    for (const id of affectedIds) {
      this.listeners.get(id)?.forEach((l) => l());
    }

    this.globalListeners.forEach((l) => l());
  }

  getCriticalPath(): Set<string> {
    return this.criticalPath;
  }

  getConflicts(): Map<string, string> {
    return this.conflicts;
  }

  setDerived(criticalPath: Set<string>, conflicts: Map<string, string>): void {
    this.criticalPath = criticalPath;
    this.conflicts = conflicts;
    this.globalListeners.forEach((l) => l());
  }
}

export const TaskStoreContext = createContext<TaskStore | null>(null);
