import { addWorkingDays, workingDaysBetween } from './date-utils';
import { topologicalSort, calcSuccessorStart } from './dependency-resolver';
import type { Task, Dependency } from '../types';

export interface CpmResult {
  earlyStart: Date;
  earlyFinish: Date;
  lateStart: Date;
  lateFinish: Date;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

/**
 * Run the Critical Path Method algorithm.
 * Returns CPM data for each task.
 */
export function runCPM(
  tasks: Task[],
  dependencies: Dependency[]
): Map<string, CpmResult> {
  const results = new Map<string, CpmResult>();
  const taskMap = new Map<string, Task>();
  const nonSummaryTasks = tasks.filter(t => t.type !== 'summary');

  for (const t of nonSummaryTasks) {
    taskMap.set(t.id, t);
  }

  const taskIds = nonSummaryTasks.map(t => t.id);
  const relevantDeps = dependencies.filter(
    d => taskMap.has(d.predecessorId) && taskMap.has(d.successorId)
  );

  const sorted = topologicalSort(taskIds, relevantDeps);
  if (!sorted) return results; // cycle detected

  // Build predecessor/successor maps
  const predecessorDeps = new Map<string, Dependency[]>();
  const successorDeps = new Map<string, Dependency[]>();
  for (const dep of relevantDeps) {
    if (!predecessorDeps.has(dep.successorId)) predecessorDeps.set(dep.successorId, []);
    predecessorDeps.get(dep.successorId)!.push(dep);
    if (!successorDeps.has(dep.predecessorId)) successorDeps.set(dep.predecessorId, []);
    successorDeps.get(dep.predecessorId)!.push(dep);
  }

  // Forward pass: calculate early start/finish
  const earlyStart = new Map<string, Date>();
  const earlyFinish = new Map<string, Date>();

  for (const id of sorted) {
    const task = taskMap.get(id)!;
    const preds = predecessorDeps.get(id) || [];

    let es = task.startDate;
    for (const dep of preds) {
      const predTask = taskMap.get(dep.predecessorId)!;
      const predEF = earlyFinish.get(dep.predecessorId) || predTask.endDate;
      const predES = earlyStart.get(dep.predecessorId) || predTask.startDate;
      const candidate = calcSuccessorStart(
        { startDate: predES, endDate: predEF },
        dep.type,
        dep.lagDays
      );
      if (candidate > es) es = candidate;
    }

    earlyStart.set(id, es);
    earlyFinish.set(id, addWorkingDays(es, task.duration));
  }

  // Find project end date (latest early finish)
  let projectEnd = new Date(0);
  for (const ef of earlyFinish.values()) {
    if (ef > projectEnd) projectEnd = ef;
  }

  // Backward pass: calculate late start/finish
  const lateStart = new Map<string, Date>();
  const lateFinish = new Map<string, Date>();

  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    const task = taskMap.get(id)!;
    const succs = successorDeps.get(id) || [];

    let lf = projectEnd;
    for (const dep of succs) {
      const succLS = lateStart.get(dep.successorId);
      if (succLS) {
        const candidate = addWorkingDays(succLS, -dep.lagDays);
        if (candidate < lf) lf = candidate;
      }
    }

    lateFinish.set(id, lf);
    lateStart.set(id, addWorkingDays(lf, -task.duration));
  }

  // Calculate float and critical path
  for (const id of sorted) {
    const es = earlyStart.get(id)!;
    const ef = earlyFinish.get(id)!;
    const ls = lateStart.get(id)!;
    const lf = lateFinish.get(id)!;

    const totalFloat = workingDaysBetween(es, ls);

    // Free float: min(ES of successors) - EF of this task - lag
    let freeFloat = Infinity;
    const succs = successorDeps.get(id) || [];
    if (succs.length === 0) {
      freeFloat = workingDaysBetween(ef, projectEnd);
    } else {
      for (const dep of succs) {
        const succES = earlyStart.get(dep.successorId);
        if (succES) {
          const ff = workingDaysBetween(ef, succES) - dep.lagDays;
          if (ff < freeFloat) freeFloat = ff;
        }
      }
    }

    results.set(id, {
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat: Math.max(0, totalFloat),
      freeFloat: Math.max(0, freeFloat === Infinity ? 0 : freeFloat),
      isCritical: Math.abs(totalFloat) < 1,
    });
  }

  return results;
}
