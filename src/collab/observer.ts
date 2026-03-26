import * as Y from 'yjs';
import type { Task, CriticalPathScope } from '../types';
import { classifyOrigin } from './origins';
import { yMapToTask } from '../schema/ydoc';
import { recalcSummaryDates } from '../utils/summaryUtils';
import { computeCriticalPathScoped, detectConflicts } from '../utils/schedulerWasm';
import type { TaskStore } from '../store/TaskStore';

interface ObserverOptions {
  criticalPathScope: CriticalPathScope;
}

/**
 * Walk UP from changed task IDs to find all affected summary ancestors.
 * Returns set of summary IDs that need recalculation.
 */
function findAffectedSummaries(changedIds: Set<string>, allTasks: Map<string, Task>): Set<string> {
  const affected = new Set<string>();
  const visited = new Set<string>();

  function walkUp(taskId: string): void {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    const task = allTasks.get(taskId);
    if (!task?.parentId) return;
    const parent = allTasks.get(task.parentId);
    if (parent?.isSummary) {
      affected.add(parent.id);
      walkUp(parent.id);
    }
  }

  for (const id of changedIds) {
    walkUp(id);
  }
  return affected;
}

/**
 * Incrementally recalculate only the summary tasks affected by changed tasks.
 * Falls back to full recalcSummaryDates on error.
 */
function recalcAffectedSummaries(
  changedIds: Set<string>,
  allTasks: Map<string, Task>
): Map<string, Task> {
  try {
    const affectedSummaryIds = findAffectedSummaries(changedIds, allTasks);
    if (affectedSummaryIds.size === 0) return allTasks;

    // recalcSummaryDates needs ALL tasks to compute correct dates for summaries
    // (it needs to see all children). Pass the full set but only update affected ones.
    const tasksArray = Array.from(allTasks.values());
    const recalced = recalcSummaryDates(tasksArray);
    const result = new Map(allTasks);
    for (const t of recalced) {
      if (affectedSummaryIds.has(t.id)) {
        result.set(t.id, t);
      }
    }
    return result;
  } catch (e) {
    console.warn('Incremental summary recalc failed, falling back to full recalc:', e);
    try {
      const tasksArray = Array.from(allTasks.values());
      const recalced = recalcSummaryDates(tasksArray);
      const result = new Map<string, Task>();
      for (const t of recalced) {
        result.set(t.id, t);
      }
      return result;
    } catch (e2) {
      console.error('Full summary recalc also failed:', e2);
      return allTasks;
    }
  }
}

/**
 * Schedule cold derivations (critical path + conflict detection) via requestIdleCallback.
 * Falls back to setTimeout(16) for browsers without requestIdleCallback (Safari).
 */
function scheduleColdDerivations(taskStore: TaskStore, scope: CriticalPathScope): void {
  const run = () => {
    try {
      const tasks = taskStore.getAllTasksArray();
      const cpResult = computeCriticalPathScoped(tasks, scope);
      const conflictResults = detectConflicts(tasks);
      const conflictMap = new Map<string, string>();
      for (const c of conflictResults) {
        conflictMap.set(c.taskId, c.message);
      }
      taskStore.setDerived(cpResult.taskIds, conflictMap);
    } catch (e) {
      console.error('Cold derivation failed (degraded mode):', e);
    }
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run);
  } else {
    setTimeout(run, 16);
  }
}

interface ChangeSet {
  changed: Set<string>;
  deleted: Set<string>;
}

/**
 * Extract changed and deleted task IDs from Y.Doc observeDeep events.
 * Uses event.target (not event.path) per spec.
 */
function extractChanges(
  events: Y.YEvent<Y.AbstractType<unknown>>[],
  ytasks: Y.Map<Y.Map<unknown>>
): ChangeSet {
  const changed = new Set<string>();
  const deleted = new Set<string>();

  for (const event of events) {
    if (event.target === ytasks) {
      // Root map: task added or deleted
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          changed.add(key);
        } else if (change.action === 'delete') {
          deleted.add(key);
        }
      }
    } else if (event.target instanceof Y.Map && event.target.parent === ytasks) {
      // Inner Y.Map: field changed on a task
      const taskId = event.target.get('id') as string | undefined;
      if (taskId) {
        changed.add(taskId);
      }
    }
  }

  return { changed, deleted };
}

/**
 * Process a batch of changes: read from Y.Doc, merge, recalc summaries, update store.
 */
function processBatch(
  changes: ChangeSet,
  ytasks: Y.Map<Y.Map<unknown>>,
  taskStore: TaskStore,
  options: { scheduleCold: boolean; scope: CriticalPathScope }
): void {
  const { changed, deleted } = changes;
  if (changed.size === 0 && deleted.size === 0) return;

  // 1. Read ONLY changed tasks from Y.Doc via yMapToTask (O(changed))
  const changedTasks = new Map<string, Task>();
  for (const taskId of changed) {
    if (deleted.has(taskId)) continue; // deleted tasks don't need reading
    const ymap = ytasks.get(taskId);
    if (!ymap) continue;
    try {
      changedTasks.set(taskId, yMapToTask(ymap));
    } catch (e) {
      console.warn(`Failed to read task ${taskId} from Y.Doc, skipping:`, e);
    }
  }

  // 2. Merge into current store state so summary recalc sees new values
  const allTasks = new Map(taskStore.getAllTasks());
  for (const [id, task] of changedTasks) {
    allTasks.set(id, task);
  }
  for (const id of deleted) {
    allTasks.delete(id);
  }

  // 3. Incremental summary recalc — walk UP from changed tasks
  const mergedTasks = recalcAffectedSummaries(changed, allTasks);

  // 4. Build the final changed map (includes summary updates)
  const finalChanged = new Map<string, Task>();
  for (const taskId of changed) {
    if (deleted.has(taskId)) continue;
    const task = mergedTasks.get(taskId);
    if (task) finalChanged.set(taskId, task);
  }
  // Include any summary tasks that were recalculated
  for (const [id, task] of mergedTasks) {
    if (!finalChanged.has(id) && taskStore.getTask(id)) {
      const existing = taskStore.getTask(id)!;
      if (
        existing.startDate !== task.startDate ||
        existing.endDate !== task.endDate ||
        existing.done !== task.done
      ) {
        finalChanged.set(id, task);
      }
    }
  }

  // 5. Batch update store
  taskStore.batchUpdate(finalChanged, deleted);

  // 6. Schedule cold derivations if needed
  if (options.scheduleCold) {
    scheduleColdDerivations(taskStore, options.scope);
  }
}

/**
 * Set up the observation handler on a Y.Doc.
 * Subscribes to ytasks.observeDeep() and taskOrder.observe().
 * Returns a cleanup function.
 */
export function setupObserver(
  doc: Y.Doc,
  taskStore: TaskStore,
  uiState: ObserverOptions,
  getDraggedTaskId?: () => string | null
): () => void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const taskOrder = doc.getArray<string>('taskOrder');

  // Batching state for remote changes
  let pendingRemote: ChangeSet = { changed: new Set(), deleted: new Set() };
  let rafScheduled = false;
  let rafId = 0;

  const deepHandler = (events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => {
    try {
      const changes = extractChanges(events, ytasks);
      const kind = classifyOrigin(txn.origin);

      if (kind === 'sheets') {
        // Process synchronously, skip cold derivations
        processBatch(changes, ytasks, taskStore, {
          scheduleCold: false,
          scope: uiState.criticalPathScope,
        });
      } else if (kind !== 'remote') {
        // Local mutations, undo/redo, initialization, unknown: process synchronously
        processBatch(changes, ytasks, taskStore, {
          scheduleCold:
            kind === 'local' || kind === 'undo' || kind === 'init' || kind === 'unknown',
          scope: uiState.criticalPathScope,
        });
      } else {
        // Remote (WebSocket provider): batch via requestAnimationFrame
        // Filter out the locally-dragged task to prevent remote updates from
        // fighting the user's in-progress drag operation.
        if (getDraggedTaskId) {
          const draggedId = getDraggedTaskId();
          if (draggedId) {
            changes.changed.delete(draggedId);
          }
        }
        for (const id of changes.changed) pendingRemote.changed.add(id);
        for (const id of changes.deleted) pendingRemote.deleted.add(id);

        if (!rafScheduled) {
          rafScheduled = true;
          rafId = requestAnimationFrame(() => {
            rafScheduled = false;
            const batch = pendingRemote;
            pendingRemote = { changed: new Set(), deleted: new Set() };
            processBatch(batch, ytasks, taskStore, {
              scheduleCold: true,
              scope: uiState.criticalPathScope,
            });
          });
        }
      }
    } catch (e) {
      // Full handler fallback: re-read entire Y.Doc
      console.error('Observer handler failed, performing full re-read:', e);
      try {
        const allTasks = new Map<string, Task>();
        ytasks.forEach((ymap, id) => {
          try {
            allTasks.set(id, yMapToTask(ymap));
          } catch {
            /* skip malformed */
          }
        });
        const recalced = recalcSummaryDates(Array.from(allTasks.values()));
        const recalcedMap = new Map<string, Task>();
        for (const t of recalced) recalcedMap.set(t.id, t);
        taskStore.batchUpdate(recalcedMap, new Set());
      } catch (e2) {
        console.error('Full re-read fallback also failed:', e2);
      }
    }
  };

  ytasks.observeDeep(deepHandler);

  // Also observe taskOrder
  const orderHandler = () => {
    taskStore.setTaskOrder(Array.from(taskOrder));
  };
  taskOrder.observe(orderHandler);

  // Cleanup function
  return () => {
    ytasks.unobserveDeep(deepHandler);
    taskOrder.unobserve(orderHandler);
    // Cancel pending RAF and clear batch to prevent stale scope processing
    if (rafScheduled) {
      cancelAnimationFrame(rafId);
      rafScheduled = false;
    }
    pendingRemote = { changed: new Set(), deleted: new Set() };
  };
}

// Export for testing
export { extractChanges, processBatch, recalcAffectedSummaries, scheduleColdDerivations };
export type { ChangeSet, ObserverOptions };
