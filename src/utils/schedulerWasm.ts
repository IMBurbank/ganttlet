import type { Task, CriticalPathScope, ConflictResult } from '../types';
import { taskDuration, isWeekendDate } from './dateUtils';

// Lazily loaded WASM module
let wasmModule: typeof import('../wasm/scheduler/ganttlet_scheduler') | null = null;

/**
 * Dev-mode assertion: verifies a task's dates and duration are internally consistent.
 * Tree-shaken in production builds (import.meta.env.PROD guard).
 *
 * Checks:
 * - computed duration matches stored duration
 * - startDate <= endDate
 * - startDate is not a weekend
 * - endDate is not a weekend
 *
 * Milestones and summary tasks are skipped (they may have special date semantics).
 */
function assertTaskInvariants(task: Task): void {
  if (import.meta.env.PROD) return;
  if (task.isSummary || task.isMilestone) return;

  const computed = taskDuration(task.startDate, task.endDate);
  console.assert(
    computed === task.duration,
    `Task ${task.id}: duration ${task.duration} != computed ${computed} (${task.startDate} → ${task.endDate})`
  );
  console.assert(
    task.startDate <= task.endDate,
    `Task ${task.id}: start ${task.startDate} > end ${task.endDate}`
  );
  console.assert(
    !isWeekendDate(task.startDate),
    `Task ${task.id}: starts on weekend ${task.startDate}`
  );
  console.assert(!isWeekendDate(task.endDate), `Task ${task.id}: ends on weekend ${task.endDate}`);
}

/**
 * Initialize the WASM scheduler module. Must be called once at startup.
 */
export async function initScheduler(): Promise<void> {
  if (wasmModule) return;
  wasmModule = await import('../wasm/scheduler/ganttlet_scheduler');
}

interface CascadeResult {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * Map Task[] to the minimal shape expected by the WASM module.
 */
function mapTasksToWasm(tasks: Task[]) {
  return tasks.map((t) => ({
    id: t.id,
    startDate: t.startDate,
    endDate: t.endDate,
    duration: t.duration,
    isMilestone: t.isMilestone,
    isSummary: t.isSummary,
    project: t.project,
    workStream: t.workStream,
    constraintType: t.constraintType ?? null,
    constraintDate: t.constraintDate ?? null,
    dependencies: t.dependencies.map((d) => ({
      fromId: d.fromId,
      toId: d.toId,
      type: d.type,
      lag: d.lag,
    })),
  }));
}

export interface CriticalPathResult {
  taskIds: Set<string>;
  edges: Array<{ fromId: string; toId: string }>;
}

/**
 * Parse the WASM critical path result into a CriticalPathResult.
 */
function parseCriticalPathResult(result: unknown): CriticalPathResult {
  if (Array.isArray(result)) {
    // Legacy format: string[]
    return { taskIds: new Set(result as string[]), edges: [] };
  }
  const r = result as { taskIds: string[]; edges?: [string, string][] };
  return {
    taskIds: new Set(r.taskIds),
    edges: (r.edges ?? []).map(([fromId, toId]) => ({ fromId, toId })),
  };
}

/**
 * Compute the critical path using the WASM CPM engine.
 * Returns critical task IDs and critical edges.
 */
export function computeCriticalPath(tasks: Task[]): CriticalPathResult {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);
    const result = wasmModule.compute_critical_path(wasmTasks);
    return parseCriticalPathResult(result);
  } catch (err) {
    console.error('computeCriticalPath failed:', err);
    return { taskIds: new Set<string>(), edges: [] };
  }
}

/**
 * Compute the critical path scoped to all tasks, a project, or a workstream.
 * Returns critical task IDs and critical edges.
 */
export function computeCriticalPathScoped(
  tasks: Task[],
  scope: CriticalPathScope
): CriticalPathResult {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);
    const result = wasmModule.compute_critical_path_scoped(wasmTasks, scope);
    return parseCriticalPathResult(result);
  } catch (err) {
    console.error('computeCriticalPathScoped failed:', err, 'scope:', scope);
    return { taskIds: new Set<string>(), edges: [] };
  }
}

/**
 * Compute the earliest possible start date for a task given its dependencies.
 * Returns null if the task has no dependencies (unconstrained).
 */
export function computeEarliestStart(tasks: Task[], taskId: string): string | null {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);
    return wasmModule.compute_earliest_start(wasmTasks, taskId) ?? null;
  } catch (err) {
    console.error('computeEarliestStart failed:', err, 'taskId:', taskId);
    return null;
  }
}

/**
 * Check if adding a dependency would create a cycle.
 */
export function wouldCreateCycle(
  tasks: Task[],
  successorId: string,
  predecessorId: string
): boolean {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);
    return wasmModule.would_create_cycle(wasmTasks, successorId, predecessorId);
  } catch (err) {
    console.error('wouldCreateCycle failed:', err);
    return true; // Assume cycle exists on error to be safe
  }
}

/**
 * Cascade dependents after a task moves.
 * Returns a new Task[] with updated dates merged in.
 */
export function cascadeDependents(tasks: Task[], movedTaskId: string, daysDelta: number): Task[] {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);

    if (import.meta.env.DEV) performance.mark('cascade-start');
    const results: CascadeResult[] = wasmModule.cascade_dependents(
      wasmTasks,
      movedTaskId,
      daysDelta
    );
    if (import.meta.env.DEV) {
      performance.mark('cascade-end');
      performance.measure('cascadeDependents', 'cascade-start', 'cascade-end');
      performance.clearMarks('cascade-start');
      performance.clearMarks('cascade-end');
      performance.clearMeasures('cascadeDependents');
    }

    // Build a map of changed tasks
    const changedMap = new Map(results.map((r) => [r.id, r]));

    // Merge changes back into full Task array
    return tasks.map((t) => {
      const changed = changedMap.get(t.id);
      if (changed) {
        return {
          ...t,
          startDate: changed.startDate,
          endDate: changed.endDate,
          duration: taskDuration(changed.startDate, changed.endDate),
        };
      }
      return t;
    });
  } catch (err) {
    console.error('cascadeDependents failed:', err);
    return tasks;
  }
}

/**
 * Detect constraint conflicts — tasks whose scheduled dates violate their constraints.
 * Returns a list of conflicts with details about the violation.
 */
export function detectConflicts(tasks: Task[]): ConflictResult[] {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);
    const result = wasmModule.detect_conflicts(wasmTasks);
    return result as ConflictResult[];
  } catch (err) {
    console.error('detectConflicts failed:', err);
    return [];
  }
}

interface RecalcResult {
  id: string;
  newStart: string;
  newEnd: string;
}

/**
 * Recalculate tasks to their earliest possible dates, respecting dependencies,
 * SNET constraints, and a today-date floor. Optionally scoped to a project,
 * workstream, or single task.
 */
export function recalculateEarliest(
  tasks: Task[],
  scopeProject?: string,
  scopeWorkstream?: string,
  scopeTaskId?: string
): RecalcResult[] {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  tasks.forEach(assertTaskInvariants);
  const wasmTasks = mapTasksToWasm(tasks);
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return wasmModule.recalculate_earliest(
    wasmTasks,
    scopeProject ?? null,
    scopeWorkstream ?? null,
    scopeTaskId ?? null,
    today
  );
}

/**
 * Cascade dependents after a task moves, returning both updated tasks and changed IDs.
 */
export function cascadeDependentsWithIds(
  tasks: Task[],
  movedTaskId: string,
  daysDelta: number
): { tasks: Task[]; changedIds: string[] } {
  if (!wasmModule) throw new Error('WASM scheduler not initialized');
  try {
    tasks.forEach(assertTaskInvariants);
    const wasmTasks = mapTasksToWasm(tasks);

    const results: CascadeResult[] = wasmModule.cascade_dependents(
      wasmTasks,
      movedTaskId,
      daysDelta
    );

    const changedIds = results.map((r) => r.id);
    const changedMap = new Map(results.map((r) => [r.id, r]));
    const updatedTasks = tasks.map((t) => {
      const changed = changedMap.get(t.id);
      return changed
        ? {
            ...t,
            startDate: changed.startDate,
            endDate: changed.endDate,
            duration: taskDuration(changed.startDate, changed.endDate),
          }
        : t;
    });

    return { tasks: updatedTasks, changedIds };
  } catch (err) {
    console.error('cascadeDependentsWithIds failed:', err);
    return { tasks, changedIds: [] };
  }
}
