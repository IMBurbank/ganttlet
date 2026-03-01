import type { Task } from '../types';

/**
 * Compute the critical path using the Critical Path Method (CPM).
 * Forward pass: compute earliest start/finish for each task.
 * Backward pass: compute latest start/finish for each task.
 * Critical tasks: those with zero total float (ES === LS).
 *
 * Only considers non-summary, non-milestone leaf tasks for durations,
 * but milestones are included if they sit on the critical path.
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

  // Topological sort based on dependencies
  const inDegree = new Map<string, number>();
  const successors = new Map<string, { taskId: string; lag: number }[]>();

  for (const t of nonSummary) {
    inDegree.set(t.id, 0);
    if (!successors.has(t.id)) successors.set(t.id, []);
  }

  for (const t of nonSummary) {
    for (const dep of t.dependencies) {
      if (!taskMap.has(dep.fromId) || taskMap.get(dep.fromId)!.isSummary) continue;
      // Only handle FS dependencies for CPM (most common)
      // For other types, approximate: SS/FF/SF all constrain timing
      inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
      if (!successors.has(dep.fromId)) successors.set(dep.fromId, []);
      successors.get(dep.fromId)!.push({ taskId: t.id, lag: dep.lag });
    }
  }

  // Forward pass
  const queue: string[] = [];
  for (const t of nonSummary) {
    ES.set(t.id, toDays(t.startDate));
    const dur = t.isMilestone ? 0 : t.duration;
    EF.set(t.id, toDays(t.startDate) + dur);
    if ((inDegree.get(t.id) || 0) === 0) {
      queue.push(t.id);
    }
  }

  // BFS forward pass
  const processed = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (processed.has(current)) continue;
    processed.add(current);
    const curEF = EF.get(current) || 0;

    for (const succ of (successors.get(current) || [])) {
      const successorES = ES.get(succ.taskId) || 0;
      const newES = curEF + succ.lag;
      if (newES > successorES) {
        ES.set(succ.taskId, newES);
        const dur = taskMap.get(succ.taskId)?.isMilestone ? 0 : (taskMap.get(succ.taskId)?.duration || 0);
        EF.set(succ.taskId, newES + dur);
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
    const curLS = LS.get(taskId) || projectEnd;

    const task = taskMap.get(taskId);
    if (!task) continue;

    // Update predecessors
    for (const dep of task.dependencies) {
      if (!taskMap.has(dep.fromId) || taskMap.get(dep.fromId)!.isSummary) continue;
      const predLF = LF.get(dep.fromId) || projectEnd;
      const newLF = curLS - dep.lag;
      if (newLF < predLF) {
        LF.set(dep.fromId, newLF);
        const predDur = taskMap.get(dep.fromId)?.isMilestone ? 0 : (taskMap.get(dep.fromId)?.duration || 0);
        LS.set(dep.fromId, newLF - predDur);
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
