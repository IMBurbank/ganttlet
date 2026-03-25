import * as Y from 'yjs';
import type { Task } from '../types';
import { initSchema, taskToYMap } from '../schema/ydoc';

/**
 * Initialize a Y.Doc and populate it from a task array.
 * Used for sandbox mode or initial sheet load.
 * Writes all tasks in a single transaction.
 */
export function initializeYDoc(doc: Y.Doc, tasks: Task[]): void {
  const { tasks: ytasks, taskOrder } = initSchema(doc);

  doc.transact(() => {
    // Clear existing data
    ytasks.forEach((_val, key) => ytasks.delete(key));
    if (taskOrder.length > 0) {
      taskOrder.delete(0, taskOrder.length);
    }

    // Write all tasks
    for (const task of tasks) {
      ytasks.set(task.id, taskToYMap(task));
    }

    // Write task order (preserve input order)
    taskOrder.push(tasks.map((t) => t.id));
  }, 'local');
}

/**
 * Hydrate an empty Y.Doc from Google Sheets data.
 * Uses 'sheets' origin so the observer skips cold derivations.
 */
export function hydrateFromSheets(doc: Y.Doc, sheetTasks: Task[]): void {
  const { tasks: ytasks, taskOrder } = initSchema(doc);

  doc.transact(() => {
    for (const task of sheetTasks) {
      ytasks.set(task.id, taskToYMap(task));
    }

    taskOrder.push(sheetTasks.map((t) => t.id));
  }, 'sheets');
}
