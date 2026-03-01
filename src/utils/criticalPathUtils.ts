import type { Task } from '../types';

/**
 * Compute the critical path using the Critical Path Method (CPM).
 * Forward pass: compute earliest start/finish for each task.
 * Backward pass: compute latest start/finish for each task.
 * Critical tasks: those with zero total float (ES === LS).
 *
 * Handles FS, SS, and FF dependency types correctly.
 */
export function computeCriticalPath(tasks: Task[]): Set<string> {
  const nonSummary = tasks.filter(t => !t.isSummary);
  if (nonSummary.length === 0) return new Set();

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // Convert dates to day offsets from the earliest date
  const allDates = nonSummary.map(t => new Date(t.startDate).getTime());
  const projectStart = Math.min(...allDates);
  const toDays = (dateStr: string) => Math.round((new Date(dateStr).getTime() - projectStart) / 86400000);

  // ES/EF for each task
  const ES = new Map<string, number>();
  const EF = new Map<string, number>();

  // Build adjacency with dependency type
  const inDegree = new Map<string, number>();
  const successors = new Map<string, { taskId: string; lag: number; type: 'FS' | 'FF' | 'SS' }[]>();

  for (const t of nonSummary) {
    inDegree.set(t.id, 0);
    if (!successors.has(t.id)) successors.set(t.id, []);
  }

  for (const t of nonSummary) {
    for (const dep of t.dependencies) {
      if (!taskMap.has(dep.fromId) || taskMap.get(dep.fromId)!.isSummary) continue;
      const depType = dep.type === 'FS' || dep.type === 'SS' || dep.type === 'FF' ? dep.type : 'FS';
      inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
      if (!successors.has(dep.fromId)) successors.set(dep.fromId, []);
      successors.get(dep.fromId)!.push({ taskId: t.id, lag: dep.lag, type: depType });
    }
  }

  // Initialize ES/EF from task dates
  for (const t of nonSummary) {
    ES.set(t.id, toDays(t.startDate));
    const dur = t.isMilestone ? 0 : t.duration;
    EF.set(t.id, toDays(t.startDate) + dur);
  }

  // Forward pass - BFS in topological order
  const queue: string[] = [];
  for (const t of nonSummary) {
    if ((inDegree.get(t.id) || 0) === 0) {
      queue.push(t.id);
    }
  }

  const processed = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (processed.has(current)) continue;
    processed.add(current);
    const curES = ES.get(current) || 0;
    const curEF = EF.get(current) || 0;

    for (const succ of (successors.get(current) || [])) {
      const successorTask = taskMap.get(succ.taskId);
      if (!successorTask) continue;
      const succDur = successorTask.isMilestone ? 0 : successorTask.duration;
      const currentSuccES = ES.get(succ.taskId) || 0;

      let newES: number;
      switch (succ.type) {
        case 'FS':
          // ES(succ) >= EF(pred) + lag
          newES = curEF + succ.lag;
          break;
        case 'SS':
          // ES(succ) >= ES(pred) + lag
          newES = curES + succ.lag;
          break;
        case 'FF':
          // EF(succ) >= EF(pred) + lag → ES(succ) >= EF(pred) + lag - dur(succ)
          newES = curEF + succ.lag - succDur;
          break;
      }

      if (newES > currentSuccES) {
        ES.set(succ.taskId, newES);
        EF.set(succ.taskId, newES + succDur);
      }

      const deg = (inDegree.get(succ.taskId) || 1) - 1;
      inDegree.set(succ.taskId, deg);
      if (deg <= 0) {
        queue.push(succ.taskId);
      }
    }
  }

  // Find the project end (max EF)
  let projectEnd = 0;
  for (const ef of EF.values()) {
    if (ef > projectEnd) projectEnd = ef;
  }

  // Backward pass
  const LS = new Map<string, number>();
  const LF = new Map<string, number>();

  for (const t of nonSummary) {
    const dur = t.isMilestone ? 0 : t.duration;
    LF.set(t.id, projectEnd);
    LS.set(t.id, projectEnd - dur);
  }

  // Process in reverse topological order
  const reverseOrder = [...processed].reverse();
  for (const taskId of reverseOrder) {
    const task = taskMap.get(taskId);
    if (!task) continue;
    const curLS = LS.get(taskId) || projectEnd;
    const curLF = LF.get(taskId) || projectEnd;

    // Update predecessors based on dependency type
    for (const dep of task.dependencies) {
      if (!taskMap.has(dep.fromId) || taskMap.get(dep.fromId)!.isSummary) continue;
      const depType = dep.type === 'FS' || dep.type === 'SS' || dep.type === 'FF' ? dep.type : 'FS';
      const predTask = taskMap.get(dep.fromId)!;
      const predDur = predTask.isMilestone ? 0 : predTask.duration;

      let newLF: number;
      let newLS: number;

      switch (depType) {
        case 'FS':
          // LF(pred) <= LS(succ) - lag
          newLF = curLS - dep.lag;
          newLS = newLF - predDur;
          break;
        case 'SS':
          // LS(pred) <= LS(succ) - lag
          newLS = curLS - dep.lag;
          newLF = newLS + predDur;
          break;
        case 'FF':
          // LF(pred) <= LF(succ) - lag
          newLF = curLF - dep.lag;
          newLS = newLF - predDur;
          break;
      }

      const predLF = LF.get(dep.fromId) || projectEnd;
      const predLS = LS.get(dep.fromId) || projectEnd;

      // We need to constrain the predecessor, so take the minimum
      if (newLF < predLF) {
        LF.set(dep.fromId, newLF);
      }
      if (newLS < predLS) {
        LS.set(dep.fromId, newLS);
      }
    }
  }

  // Critical tasks have zero float (ES === LS)
  const criticalIds = new Set<string>();
  for (const t of nonSummary) {
    const es = ES.get(t.id) || 0;
    const ls = LS.get(t.id) || 0;
    const float = ls - es;
    if (Math.abs(float) < 1) {
      criticalIds.add(t.id);
    }
  }

  return criticalIds;
}
