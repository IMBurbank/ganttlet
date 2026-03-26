import type { Task } from '../types';

export const ROW_HEIGHT = 44;
export const HEADER_HEIGHT = 56;
export const TIMELINE_HEADER_HEIGHT = 50;

export function getVisibleTasks(
  tasks: Task[],
  searchQuery: string,
  collapsedTasks?: Set<string>
): Task[] {
  const result: Task[] = [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  function isAncestorExpanded(task: Task): boolean {
    if (!task.parentId) return true;
    const parent = taskMap.get(task.parentId);
    if (!parent) return true;
    // Check UIStore collapsed state (collapsedTasks set) rather than task.isExpanded
    // which is always true from yMapToTask defaults
    if (collapsedTasks?.has(parent.id)) return false;
    return isAncestorExpanded(parent);
  }

  for (const task of tasks) {
    if (task.isHidden) continue;
    if (!isAncestorExpanded(task)) continue;
    if (searchQuery && !task.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      // If it's a summary and has matching children, still show it
      if (task.isSummary) {
        const hasMatchingChild = tasks.some(
          (t) => t.parentId === task.id && t.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
        if (!hasMatchingChild) continue;
      } else {
        continue;
      }
    }
    result.push(task);
  }

  return result;
}

export function getTaskDepth(task: Task, taskMap: Map<string, Task>): number {
  let depth = 0;
  let current = task;
  while (current.parentId) {
    depth++;
    const parent = taskMap.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

export function buildTaskYPositions(visibleTasks: Task[]): Map<string, number> {
  const positions = new Map<string, number>();
  visibleTasks.forEach((task, index) => {
    positions.set(task.id, index * ROW_HEIGHT);
  });
  return positions;
}
