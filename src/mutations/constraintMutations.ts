import * as Y from 'yjs';
import type { Task } from '../types';
import { yMapToTask } from '../schema/ydoc';
import { cascadeDependents } from '../utils/schedulerWasm';

/**
 * Set a constraint on a task and cascade dependents via WASM.
 * Compute first (outside transaction), write atomically.
 */
export function setConstraint(
  doc: Y.Doc,
  taskId: string,
  constraintType: Task['constraintType'],
  constraintDate?: string
): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  // Build task array with the constraint applied for WASM input
  const allTasks: Task[] = [];
  ytasks.forEach((taskYmap) => {
    const task = yMapToTask(taskYmap);
    if (task.id === taskId) {
      task.constraintType = constraintType;
      task.constraintDate = constraintDate;
    }
    allTasks.push(task);
  });

  // Compute cascade outside transaction
  let cascaded: Task[];
  try {
    cascaded = cascadeDependents(allTasks, taskId, 0);
  } catch {
    // WASM error — still write the constraint, skip cascade
    doc.transact(() => {
      if (constraintType != null) {
        ymap.set('constraintType', constraintType);
      } else {
        ymap.delete('constraintType');
      }
      if (constraintDate != null) {
        ymap.set('constraintDate', constraintDate);
      } else {
        ymap.delete('constraintDate');
      }
    }, 'local');
    return;
  }

  // Build change map
  const changes = new Map<string, { startDate: string; endDate: string }>();
  for (const task of cascaded) {
    const original = allTasks.find((t) => t.id === task.id);
    if (original && (original.startDate !== task.startDate || original.endDate !== task.endDate)) {
      changes.set(task.id, { startDate: task.startDate, endDate: task.endDate });
    }
  }

  doc.transact(() => {
    // Set constraint fields
    if (constraintType != null) {
      ymap.set('constraintType', constraintType);
    } else {
      ymap.delete('constraintType');
    }
    if (constraintDate != null) {
      ymap.set('constraintDate', constraintDate);
    } else {
      ymap.delete('constraintDate');
    }

    // Write cascaded date changes
    for (const [id, dates] of changes) {
      const cascYmap = ytasks.get(id);
      if (cascYmap) {
        cascYmap.set('startDate', dates.startDate);
        cascYmap.set('endDate', dates.endDate);
      }
    }
  }, 'local');
}
