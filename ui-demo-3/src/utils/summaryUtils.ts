import type { Task } from '../types';

export function recalcSummaryDates(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));

  function updateSummary(taskId: string): { start: string; end: string; pct: number } | null {
    const task = taskMap.get(taskId);
    if (!task) return null;

    if (!task.isSummary || task.childIds.length === 0) {
      return { start: task.startDate, end: task.endDate, pct: task.percentComplete };
    }

    let minStart = '9999-12-31';
    let maxEnd = '0000-01-01';
    let totalPct = 0;
    let childCount = 0;

    for (const childId of task.childIds) {
      const childResult = updateSummary(childId);
      if (!childResult) continue;
      if (childResult.start < minStart) minStart = childResult.start;
      if (childResult.end > maxEnd) maxEnd = childResult.end;
      totalPct += childResult.pct;
      childCount++;
    }

    if (childCount > 0) {
      task.startDate = minStart;
      task.endDate = maxEnd;
      task.percentComplete = Math.round(totalPct / childCount);
    }

    return { start: task.startDate, end: task.endDate, pct: task.percentComplete };
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
