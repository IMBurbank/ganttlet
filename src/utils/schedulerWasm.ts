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

export type CriticalPathScope =
  | { type: 'all' }
  | { type: 'project'; name: string }
  | { type: 'milestone'; id: string };

interface CascadeResult {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * Map Task[] to the minimal shape expected by the WASM module.
 */
function mapTasksToWasm(tasks: Task[]) {
  return tasks.map(t => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
    duration: t.duration,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    project: t.project,
    dependencies: t.dependencies.map(d => ({
      fromId: d.fromId,
      toId: d.toId,
      type: d.type,
      lag: d.lag,
    })),
  }));
}

/**
 * Compute the critical path using the WASM CPM engine.
 * Returns a Set of critical task IDs.
 */
export function computeCriticalPath(tasks: Task[]): Set<string> {
  return computeCriticalPathScoped(tasks, { type: 'all' });
}

/**
 * Compute the critical path scoped to all tasks, a project, or a milestone's predecessors.
 */
export function computeCriticalPathScoped(tasks: Task[], scope: CriticalPathScope): Set<string> {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks);
  const result: string[] = wasmModule.compute_critical_path_scoped(wasmTasks, scope);
  return new Set(result);
}

/**
 * Compute the earliest possible start date for a task given its dependencies.
 * Returns null if the task has no dependencies (unconstrained).
 */
export function computeEarliestStart(tasks: Task[], taskId: string): string | null {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks);
  return wasmModule.compute_earliest_start(wasmTasks, taskId) ?? null;
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
  const wasmTasks = mapTasksToWasm(tasks);
  return wasmModule.would_create_cycle(wasmTasks, successorId, predecessorId);
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
  const wasmTasks = mapTasksToWasm(tasks);

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

/**
 * Cascade dependents after a task moves, returning both updated tasks and changed IDs.
 */
export function cascadeDependentsWithIds(
  tasks: Task[],
  movedTaskId: string,
  daysDelta: number,
): { tasks: Task[]; changedIds: string[] } {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  const wasmTasks = mapTasksToWasm(tasks);

  const results: CascadeResult[] = wasmModule.cascade_dependents(
    wasmTasks,
    movedTaskId,
    daysDelta,
  );

  const changedIds = results.map(r => r.id);
  const changedMap = new Map(results.map(r => [r.id, r]));
  const updatedTasks = tasks.map(t => {
    const changed = changedMap.get(t.id);
    return changed ? { ...t, startDate: changed.startDate, endDate: changed.endDate } : t;
  });

  return { tasks: updatedTasks, changedIds };
}
