import * as Y from 'yjs';
import type { Task } from '../types';
import { taskToYMap, yMapToTask } from '../schema/ydoc';
import { cascadeDependents, recalculateEarliest } from '../utils/schedulerWasm';
import { daysBetween, formatDate, taskEndDate } from '../utils/dateUtils';
import { ORIGIN } from '../collab/origins';

/**
 * Read all tasks from the Y.Doc tasks map as a Task[].
 * Used to build the array that WASM expects.
 */
function readAllTasks(ytasks: Y.Map<Y.Map<unknown>>): Task[] {
  const tasks: Task[] = [];
  ytasks.forEach((ymap) => {
    tasks.push(yMapToTask(ymap));
  });
  return tasks;
}

/**
 * Move a task to new dates and cascade all dependents via WASM.
 * Compute first (outside transaction), write atomically.
 */
export function moveTask(doc: Y.Doc, taskId: string, newStart: string, newEnd: string): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  const oldStart = ymap.get('startDate') as string;
  const daysDelta = daysBetween(oldStart, newStart);

  // Read all tasks with the moved task's new dates applied (for WASM input)
  const allTasks = readAllTasks(ytasks).map((t) =>
    t.id === taskId ? { ...t, startDate: newStart, endDate: newEnd } : t
  );

  // Compute cascade outside transaction — if WASM fails, nothing is written
  let cascaded: Task[];
  try {
    cascaded = cascadeDependents(allTasks, taskId, daysDelta);
  } catch {
    return; // WASM error — abort
  }

  // Build a map of tasks that actually changed dates
  const changes = new Map<string, { startDate: string; endDate: string }>();
  for (const task of cascaded) {
    const original = allTasks.find((t) => t.id === task.id);
    if (original && (original.startDate !== task.startDate || original.endDate !== task.endDate)) {
      changes.set(task.id, { startDate: task.startDate, endDate: task.endDate });
    }
  }

  doc.transact(() => {
    // Write moved task
    ymap.set('startDate', newStart);
    ymap.set('endDate', newEnd);

    // Write cascaded tasks
    for (const [id, dates] of changes) {
      if (id === taskId) continue; // already written above
      const cascYmap = ytasks.get(id);
      if (cascYmap) {
        cascYmap.set('startDate', dates.startDate);
        cascYmap.set('endDate', dates.endDate);
      }
    }
  }, ORIGIN.LOCAL);
}

/**
 * Resize a task (change endDate only) and cascade dependents.
 */
export function resizeTask(doc: Y.Doc, taskId: string, newEnd: string): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  const oldEnd = ymap.get('endDate') as string;
  const daysDelta = daysBetween(oldEnd, newEnd);

  const allTasks = readAllTasks(ytasks).map((t) =>
    t.id === taskId ? { ...t, endDate: newEnd } : t
  );

  let cascaded: Task[];
  try {
    cascaded = cascadeDependents(allTasks, taskId, daysDelta);
  } catch {
    return;
  }

  const changes = new Map<string, { startDate: string; endDate: string }>();
  for (const task of cascaded) {
    const original = allTasks.find((t) => t.id === task.id);
    if (original && (original.startDate !== task.startDate || original.endDate !== task.endDate)) {
      changes.set(task.id, { startDate: task.startDate, endDate: task.endDate });
    }
  }

  doc.transact(() => {
    ymap.set('endDate', newEnd);

    for (const [id, dates] of changes) {
      if (id === taskId) continue;
      const cascYmap = ytasks.get(id);
      if (cascYmap) {
        cascYmap.set('startDate', dates.startDate);
        cascYmap.set('endDate', dates.endDate);
      }
    }
  }, ORIGIN.LOCAL);
}

/**
 * Add a new task to the Y.Doc.
 * Generates a UUID, creates Y.Map via taskToYMap, inserts into tasks map and taskOrder.
 * If the task has a parent, appends the new ID to the parent's childIds.
 */
export function addTask(doc: Y.Doc, task: Partial<Task>, afterTaskId?: string): string {
  const id = crypto.randomUUID();
  // Default to today + 5 business days when no dates provided
  const defaultStart = task.startDate || formatDate(new Date());
  const defaultEnd = task.endDate || taskEndDate(defaultStart, 5);
  const fullTask: Task = {
    id,
    name: task.name ?? 'New Task',
    startDate: defaultStart,
    endDate: defaultEnd,
    duration: 0, // computed, not stored in Y.Doc
    owner: task.owner ?? '',
    workStream: task.workStream ?? '',
    project: task.project ?? '',
    functionalArea: task.functionalArea ?? '',
    done: task.done ?? false,
    description: task.description ?? '',
    isMilestone: task.isMilestone ?? false,
    isSummary: task.isSummary ?? false,
    parentId: task.parentId ?? null,
    childIds: task.childIds ?? [],
    dependencies: task.dependencies ?? [],
    notes: task.notes ?? '',
    okrs: task.okrs ?? [],
    constraintType: task.constraintType,
    constraintDate: task.constraintDate,
  };

  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const taskOrder = doc.getArray<string>('taskOrder');
  const ymap = taskToYMap(fullTask);

  doc.transact(() => {
    ytasks.set(id, ymap);

    // Insert into taskOrder
    if (afterTaskId) {
      let insertIdx = -1;
      for (let i = 0; i < taskOrder.length; i++) {
        if (taskOrder.get(i) === afterTaskId) {
          insertIdx = i + 1;
          break;
        }
      }
      if (insertIdx >= 0) {
        taskOrder.insert(insertIdx, [id]);
      } else {
        taskOrder.push([id]);
      }
    } else {
      taskOrder.push([id]);
    }

    // Update parent's childIds if task has a parent
    if (fullTask.parentId) {
      const parentYmap = ytasks.get(fullTask.parentId);
      if (parentYmap) {
        let parentChildIds: string[] = [];
        try {
          const raw = parentYmap.get('childIds') as string;
          if (raw) parentChildIds = JSON.parse(raw);
        } catch {
          /* default empty */
        }
        parentChildIds.push(id);
        parentYmap.set('childIds', JSON.stringify(parentChildIds));
      }
    }
  }, ORIGIN.LOCAL);

  return id;
}

/**
 * Delete a task and all its descendants. Cleans up:
 * - All descendant tasks (BFS via childIds)
 * - taskOrder entries
 * - Parent's childIds reference
 * - Dependency references in all remaining tasks
 */
export function deleteTask(doc: Y.Doc, taskId: string): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const taskOrder = doc.getArray<string>('taskOrder');
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  // BFS to collect all descendants
  const toDelete = new Set<string>([taskId]);
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentYmap = ytasks.get(current);
    if (!currentYmap) continue;
    let childIds: string[] = [];
    try {
      const raw = currentYmap.get('childIds') as string;
      if (raw) childIds = JSON.parse(raw);
    } catch {
      /* empty */
    }
    for (const childId of childIds) {
      if (!toDelete.has(childId)) {
        toDelete.add(childId);
        queue.push(childId);
      }
    }
  }

  // Find parent to clean up childIds
  const parentId = ymap.get('parentId') as string | null;

  doc.transact(() => {
    // Delete all from ytasks
    for (const id of toDelete) {
      ytasks.delete(id);
    }

    // Remove from taskOrder (iterate backwards to preserve indices)
    for (let i = taskOrder.length - 1; i >= 0; i--) {
      if (toDelete.has(taskOrder.get(i))) {
        taskOrder.delete(i, 1);
      }
    }

    // Remove from parent's childIds
    if (parentId) {
      const parentYmap = ytasks.get(parentId);
      if (parentYmap) {
        let parentChildIds: string[] = [];
        try {
          const raw = parentYmap.get('childIds') as string;
          if (raw) parentChildIds = JSON.parse(raw);
        } catch {
          /* empty */
        }
        parentChildIds = parentChildIds.filter((id) => !toDelete.has(id));
        parentYmap.set('childIds', JSON.stringify(parentChildIds));
      }
    }

    // Clean dependency references in ALL remaining tasks
    ytasks.forEach((taskYmap) => {
      let deps: Array<{ fromId: string; toId: string; type: string; lag: number }> = [];
      try {
        const raw = taskYmap.get('dependencies') as string;
        if (raw) deps = JSON.parse(raw);
      } catch {
        return;
      }
      const filtered = deps.filter((d) => !toDelete.has(d.fromId) && !toDelete.has(d.toId));
      if (filtered.length !== deps.length) {
        taskYmap.set('dependencies', JSON.stringify(filtered));
      }
    });
  }, ORIGIN.LOCAL);
}

/**
 * Reparent a task under a new parent. Updates:
 * - Task's parentId
 * - Old parent's childIds (remove)
 * - New parent's childIds (append)
 * - taskOrder position (move after new parent's last child)
 */
export function reparentTask(doc: Y.Doc, taskId: string, newParentId: string): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const taskOrder = doc.getArray<string>('taskOrder');
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  const oldParentId = ymap.get('parentId') as string | null;

  doc.transact(() => {
    // Update task's parentId
    ymap.set('parentId', newParentId);

    // Remove from old parent's childIds
    if (oldParentId) {
      const oldParentYmap = ytasks.get(oldParentId);
      if (oldParentYmap) {
        let oldChildIds: string[] = [];
        try {
          const raw = oldParentYmap.get('childIds') as string;
          if (raw) oldChildIds = JSON.parse(raw);
        } catch {
          /* empty */
        }
        oldChildIds = oldChildIds.filter((id) => id !== taskId);
        oldParentYmap.set('childIds', JSON.stringify(oldChildIds));
      }
    }

    // Add to new parent's childIds
    const newParentYmap = ytasks.get(newParentId);
    if (newParentYmap) {
      let newChildIds: string[] = [];
      try {
        const raw = newParentYmap.get('childIds') as string;
        if (raw) newChildIds = JSON.parse(raw);
      } catch {
        /* empty */
      }
      newChildIds.push(taskId);
      newParentYmap.set('childIds', JSON.stringify(newChildIds));

      // Move in taskOrder: after new parent's last child
      // First remove current position
      let currentIdx = -1;
      for (let i = 0; i < taskOrder.length; i++) {
        if (taskOrder.get(i) === taskId) {
          currentIdx = i;
          break;
        }
      }
      if (currentIdx >= 0) {
        taskOrder.delete(currentIdx, 1);
      }

      // Find insert position: after the last child of new parent in taskOrder
      let insertIdx = -1;
      for (let i = 0; i < taskOrder.length; i++) {
        if (taskOrder.get(i) === newParentId || newChildIds.includes(taskOrder.get(i))) {
          insertIdx = i + 1;
        }
      }
      if (insertIdx >= 0) {
        taskOrder.insert(insertIdx, [taskId]);
      } else {
        taskOrder.push([taskId]);
      }
    }
  }, ORIGIN.LOCAL);
}

/**
 * Update a single field on a task.
 */
export function updateTaskField(doc: Y.Doc, taskId: string, field: string, value: unknown): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  doc.transact(() => {
    // JSON-stringify array fields
    if (field === 'childIds' || field === 'dependencies' || field === 'okrs') {
      ymap.set(field, JSON.stringify(value));
    } else {
      ymap.set(field, value);
    }
  }, ORIGIN.LOCAL);
}

/**
 * Recalculate the given tasks to their earliest possible dates via WASM.
 * Supports per-task, workstream, project, or all-task scopes depending on
 * how taskIds are gathered by the caller.
 */
export function recalculateEarliestMutation(doc: Y.Doc, taskIds: string[]): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const allTasks = readAllTasks(ytasks);

  // Determine scope: if a single task, pass scopeTaskId; otherwise recalculate all and filter
  const scopeTaskId = taskIds.length === 1 ? taskIds[0] : undefined;

  let results;
  try {
    results = recalculateEarliest(
      allTasks,
      undefined, // scopeProject
      undefined, // scopeWorkstream
      scopeTaskId
    );
  } catch {
    return; // WASM error — abort
  }

  // Build a set for quick lookup when scoped to multiple tasks
  const scopeSet = scopeTaskId ? null : new Set(taskIds);

  doc.transact(() => {
    for (const result of results) {
      // If scoped to multiple (but not all) tasks, only apply to those in scope
      if (scopeSet && !scopeSet.has(result.id)) continue;

      const ymap = ytasks.get(result.id);
      if (ymap) {
        ymap.set('startDate', result.newStart);
        ymap.set('endDate', result.newEnd);
      }
    }
  }, ORIGIN.LOCAL);
}
