import type { Task } from '../types';

// Lazily loaded WASM module
let wasmModule: typeof import('../wasm/scheduler/ganttlet_scheduler') | null = null;

/**
 * Initialize the WASM scheduler module. Must be called once at startup.
 */
export async function initScheduler(): Promise<void> {
  if (wasmModule) return;
  wasmModule = await import('../wasm/scheduler/ganttlet_scheduler');
}

/**
 * Compute the critical path using the WASM CPM engine.
 * Returns a Set of critical task IDs.
 */
export function computeCriticalPath(tasks: Task[]): Set<string> {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  // Only pass scheduling-relevant fields to WASM
  const wasmTasks = tasks.map(t => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
    duration: t.duration,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    dependencies: t.dependencies.map(d => ({
      fromId: d.fromId,
      toId: d.toId,
      type: d.type,
      lag: d.lag,
    })),
  }));
  const result: string[] = wasmModule.compute_critical_path(wasmTasks);
  return new Set(result);
}

/**
 * Check if adding a dependency would create a cycle.
 */
export function wouldCreateCycle(
  tasks: Task[],
  successorId: string,
  predecessorId: string,
): boolean {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = tasks.map(t => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
    duration: t.duration,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    dependencies: t.dependencies.map(d => ({
      fromId: d.fromId,
      toId: d.toId,
      type: d.type,
      lag: d.lag,
    })),
  }));
  return wasmModule.would_create_cycle(wasmTasks, successorId, predecessorId);
}

interface CascadeResult {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * Cascade dependents after a task moves.
 * Returns a new Task[] with updated dates merged in.
 */
export function cascadeDependents(
  tasks: Task[],
  movedTaskId: string,
  daysDelta: number,
): Task[] {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = tasks.map(t => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
    duration: t.duration,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    dependencies: t.dependencies.map(d => ({
      fromId: d.fromId,
      toId: d.toId,
      type: d.type,
      lag: d.lag,
    })),
  }));

  const results: CascadeResult[] = wasmModule.cascade_dependents(
    wasmTasks,
    movedTaskId,
    daysDelta,
  );

  // Build a map of changed tasks
  const changedMap = new Map(results.map(r => [r.id, r]));

  // Merge changes back into full Task array
  return tasks.map(t => {
    const changed = changedMap.get(t.id);
    if (changed) {
      return { ...t, startDate: changed.startDate, endDate: changed.endDate };
    }
    return t;
  });
}
