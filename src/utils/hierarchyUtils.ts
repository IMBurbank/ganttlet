import type { Task } from '../types';

export type HierarchyRole = 'project' | 'workstream' | 'task';

/**
 * Determine a task's role in the hierarchy.
 * - project: isSummary && no parentId (top-level summary)
 * - workstream: isSummary && parent is a project
 * - task: everything else (leaf tasks, milestones)
 */
export function getHierarchyRole(task: Task, taskMap: Map<string, Task>): HierarchyRole {
  if (task.isSummary && !task.parentId) return 'project';
  if (task.isSummary && task.parentId) {
    const parent = taskMap.get(task.parentId);
    if (parent && parent.isSummary && !parent.parentId) return 'workstream';
  }
  return 'task';
}

/**
 * Walk up the parentId chain to find the project ancestor (top-level summary).
 * Returns null if the task itself is a project or has no project ancestor.
 */
export function findProjectAncestor(task: Task, taskMap: Map<string, Task>): Task | null {
  let current = task.parentId ? taskMap.get(task.parentId) : undefined;
  while (current) {
    if (current.isSummary && !current.parentId) return current;
    current = current.parentId ? taskMap.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * Walk up the parentId chain to find the workstream ancestor.
 * Returns null if not found.
 */
export function findWorkstreamAncestor(task: Task, taskMap: Map<string, Task>): Task | null {
  let current = task.parentId ? taskMap.get(task.parentId) : undefined;
  while (current) {
    if (getHierarchyRole(current, taskMap) === 'workstream') return current;
    current = current.parentId ? taskMap.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * BFS down childIds to collect all descendant IDs.
 */
export function getAllDescendantIds(taskId: string, taskMap: Map<string, Task>): Set<string> {
  const descendants = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    const task = taskMap.get(id);
    if (task) {
      for (const childId of task.childIds) {
        if (!descendants.has(childId)) {
          descendants.add(childId);
          queue.push(childId);
        }
      }
    }
  }
  return descendants;
}

/**
 * Check if taskId is a descendant of ancestorId.
 */
export function isDescendantOf(taskId: string, ancestorId: string, taskMap: Map<string, Task>): boolean {
  return getAllDescendantIds(ancestorId, taskMap).has(taskId);
}

/**
 * Generate a prefixed ID for a new task under the given parent.
 * Pattern: {parentId}-{N+1} where N is the max existing number.
 * Example: parent "pe" with existing "pe-1", "pe-3" -> returns "pe-4"
 */
export function generatePrefixedId(parent: Task, existingTasks: Task[]): string {
  const prefix = `${parent.id}-`;
  let maxN = 0;
  for (const t of existingTasks) {
    if (t.id.startsWith(prefix)) {
      const suffix = t.id.slice(prefix.length);
      const n = parseInt(suffix, 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  return `${prefix}${maxN + 1}`;
}

/**
 * Compute inherited fields based on parent's role.
 * - If parent is project: { project: parent.name, workStream: '', okrs: [...parent.okrs] }
 * - If parent is workstream: { project: parent.project, workStream: parent.name, okrs: [...parent.okrs] }
 * - If no parent: { project: '', workStream: '', okrs: [] }
 */
export function computeInheritedFields(
  parentId: string | null,
  taskMap: Map<string, Task>
): { project: string; workStream: string; okrs: string[] } {
  if (!parentId) return { project: '', workStream: '', okrs: [] };
  const parent = taskMap.get(parentId);
  if (!parent) return { project: '', workStream: '', okrs: [] };

  const role = getHierarchyRole(parent, taskMap);
  if (role === 'project') {
    return { project: parent.name, workStream: '', okrs: [...parent.okrs] };
  }
  if (role === 'workstream') {
    return { project: parent.project, workStream: parent.name, okrs: [...parent.okrs] };
  }
  // Parent is a regular task — inherit its fields
  return { project: parent.project, workStream: parent.workStream, okrs: [...parent.okrs] };
}
