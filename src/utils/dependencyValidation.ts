import type { Task, Dependency } from '../types';
import { getHierarchyRole, isDescendantOf, getAllDescendantIds } from './hierarchyUtils';

export interface DepValidationError {
  code: string;
  message: string;
}

/**
 * Validate whether adding a dependency from predecessorId to successorId
 * would violate hierarchy rules.
 *
 * Rules:
 * - A project cannot depend on its own descendants
 * - A workstream cannot depend on its own child tasks
 * - A task cannot depend on its own ancestor project/workstream
 *
 * Returns null if valid, { code, message } if invalid.
 */
export function validateDependencyHierarchy(
  tasks: Task[],
  successorId: string,
  predecessorId: string
): DepValidationError | null {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const successor = taskMap.get(successorId);
  const predecessor = taskMap.get(predecessorId);
  if (!successor || !predecessor) return null;

  // Check if predecessor is an ancestor of successor
  if (isDescendantOf(successorId, predecessorId, taskMap)) {
    const predRole = getHierarchyRole(predecessor, taskMap);
    return {
      code: 'ANCESTOR_DEPENDENCY',
      message: `Cannot add dependency: ${predecessor.name} is an ancestor ${predRole} of ${successor.name}`,
    };
  }

  // Check if successor is an ancestor of predecessor
  if (isDescendantOf(predecessorId, successorId, taskMap)) {
    const succRole = getHierarchyRole(successor, taskMap);
    return {
      code: 'DESCENDANT_DEPENDENCY',
      message: `Cannot add dependency: ${successor.name} is an ancestor ${succRole} of ${predecessor.name}`,
    };
  }

  return null;
}

/**
 * Check if moving taskId under newParentId would create conflicts
 * with existing dependencies.
 *
 * A conflict exists if the task (or its descendants) has a dependency
 * on the target parent entity itself (not on sibling tasks under that parent).
 *
 * Returns list of conflicting deps with human-readable reasons.
 */
export function checkMoveConflicts(
  tasks: Task[],
  taskId: string,
  newParentId: string
): { dep: Dependency; reason: string }[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const task = taskMap.get(taskId);
  const newParent = taskMap.get(newParentId);
  if (!task || !newParent) return [];

  const conflicts: { dep: Dependency; reason: string }[] = [];

  // Get the ancestor chain of the new parent (the parent itself + its ancestors)
  const ancestorIds = new Set<string>([newParentId]);
  let current = newParent.parentId ? taskMap.get(newParent.parentId) : undefined;
  while (current) {
    ancestorIds.add(current.id);
    current = current.parentId ? taskMap.get(current.parentId) : undefined;
  }

  // Get all IDs being moved (task + its descendants)
  const movingIds = new Set([taskId, ...getAllDescendantIds(taskId, taskMap)]);

  // Check all deps of moving tasks
  for (const movingId of movingIds) {
    const movingTask = taskMap.get(movingId);
    if (!movingTask) continue;

    for (const dep of movingTask.dependencies) {
      // Conflict if dep references the new parent or its ancestors directly
      if (ancestorIds.has(dep.fromId)) {
        const fromTask = taskMap.get(dep.fromId);
        conflicts.push({
          dep,
          reason: `${movingTask.name} depends on ${fromTask?.name ?? dep.fromId}, which is an ancestor of the target`,
        });
      }
    }
  }

  // Also check if any ancestor deps point TO moving tasks
  for (const ancestorId of ancestorIds) {
    const ancestor = taskMap.get(ancestorId);
    if (!ancestor) continue;
    for (const dep of ancestor.dependencies) {
      if (movingIds.has(dep.fromId)) {
        const fromTask = taskMap.get(dep.fromId);
        conflicts.push({
          dep,
          reason: `${ancestor.name} depends on ${fromTask?.name ?? dep.fromId}, which is being moved`,
        });
      }
    }
  }

  return conflicts;
}
