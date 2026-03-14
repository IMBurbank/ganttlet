import type { Task } from '../types';
import { taskDuration } from './dateUtils';

export function recalcSummaryDates(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map((t) => [t.id, { ...t }]));

  function updateSummary(taskId: string): { start: string; end: string; done: boolean } | null {
    const task = taskMap.get(taskId);
    if (!task) return null;

    if (!task.isSummary || task.childIds.length === 0) {
      return { start: task.startDate, end: task.endDate, done: task.done };
    }

    let minStart = '9999-12-31';
    let maxEnd = '0000-01-01';
    let allDone = true;
    let childCount = 0;

    for (const childId of task.childIds) {
      const childResult = updateSummary(childId);
      if (!childResult) continue;
      if (childResult.start < minStart) minStart = childResult.start;
      if (childResult.end > maxEnd) maxEnd = childResult.end;
      if (!childResult.done) allDone = false;
      childCount++;
    }

    if (childCount > 0) {
      task.startDate = minStart;
      task.endDate = maxEnd;
      task.duration = taskDuration(minStart, maxEnd);
      task.done = allDone;
    }

    return { start: task.startDate, end: task.endDate, done: task.done };
  }

  // Update from root summaries
  for (const task of taskMap.values()) {
    if (task.isSummary && !task.parentId) {
      updateSummary(task.id);
    } else if (task.isSummary) {
      updateSummary(task.id);
    }
  }

  return Array.from(taskMap.values());
}
