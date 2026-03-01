import { addWorkingDays } from './date-utils';
import type { Task, Dependency, DependencyType } from '../types';

/**
 * Calculate the earliest start date for a successor task based on the
 * dependency type and the predecessor's dates.
 */
export function calcSuccessorStart(
  predecessor: Pick<Task, 'startDate' | 'endDate'>,
  depType: DependencyType,
  lagDays: number
): Date {
  switch (depType) {
    case 'FS': // Finish-to-Start: successor starts after predecessor finishes + lag
      return addWorkingDays(predecessor.endDate, lagDays);
    case 'SS': // Start-to-Start: successor starts when predecessor starts + lag
      return addWorkingDays(predecessor.startDate, lagDays);
    case 'FF': // Finish-to-Finish: not directly a start calc, handled in cascade
      return addWorkingDays(predecessor.endDate, lagDays);
    case 'SF': // Start-to-Finish: predecessor start drives successor finish
      return addWorkingDays(predecessor.startDate, lagDays);
    default:
      return predecessor.endDate;
  }
}

/**
 * Build a topological order of task IDs based on dependencies.
 * Returns null if there's a cycle.
 */
export function topologicalSort(
  taskIds: string[],
  dependencies: Dependency[]
): string[] | null {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of taskIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const dep of dependencies) {
    if (!inDegree.has(dep.predecessorId) || !inDegree.has(dep.successorId)) continue;
    adjacency.get(dep.predecessorId)!.push(dep.successorId);
    inDegree.set(dep.successorId, (inDegree.get(dep.successorId) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted.length === taskIds.length ? sorted : null;
}

/**
 * Cascade date changes through the dependency graph.
 * Given a changed task, updates all successor tasks' dates.
 * Returns the map of task ID -> new start date.
 */
export function cascadeDates(
  tasks: Map<string, Task>,
  dependencies: Dependency[],
  changedTaskId: string
): Map<string, { startDate: Date; endDate: Date }> {
  const updates = new Map<string, { startDate: Date; endDate: Date }>();

  // Build successor map
  const successorDeps = new Map<string, Dependency[]>();
  for (const dep of dependencies) {
    if (!successorDeps.has(dep.predecessorId)) {
      successorDeps.set(dep.predecessorId, []);
    }
    successorDeps.get(dep.predecessorId)!.push(dep);
  }

  // BFS from the changed task
  const queue: string[] = [changedTaskId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const current = tasks.get(currentId);
    if (!current) continue;

    const deps = successorDeps.get(currentId) || [];
    for (const dep of deps) {
      const successor = tasks.get(dep.successorId);
      if (!successor) continue;

      const newStart = calcSuccessorStart(
        updates.get(currentId) || current,
        dep.type,
        dep.lagDays
      );

      const currentNewStart = updates.get(dep.successorId)?.startDate;
      // Take the latest required start date (most constraining)
      if (!currentNewStart || newStart > currentNewStart) {
        const duration = successor.duration;
        const newEnd = addWorkingDays(newStart, duration);
        updates.set(dep.successorId, { startDate: newStart, endDate: newEnd });
      }

      if (!visited.has(dep.successorId)) {
        queue.push(dep.successorId);
      }
    }
  }

  // Remove the original task from updates (it was the trigger, not a result)
  updates.delete(changedTaskId);
  return updates;
}
