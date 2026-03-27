import * as Y from 'yjs';
import type { Task } from '../types';
import { getDocMaps, writeTaskToDoc } from '../schema/ydoc';
import { ORIGIN } from './origins';

/**
 * Initialize a Y.Doc and populate it from a task array.
 * Used for sandbox mode or initial sheet load.
 * Writes all tasks in a single transaction.
 *
 * Note: migrateDoc() is called by the useDocMigration hook BEFORE this runs.
 * This function does NOT handle schema versioning.
 */
export function initializeYDoc(doc: Y.Doc, tasks: Task[]): void {
  const { tasks: ytasks, taskOrder } = getDocMaps(doc);

  // Use 'init' origin (not 'local') so UndoManager does not track this setup operation.
  // Users should not be able to undo the initial task population.
  doc.transact(() => {
    // Clear existing data
    ytasks.forEach((_val, key) => ytasks.delete(key));
    if (taskOrder.length > 0) {
      taskOrder.delete(0, taskOrder.length);
    }

    // Write all tasks via single write path (writeTaskToDoc handles create vs update)
    for (const task of tasks) {
      writeTaskToDoc(ytasks, task.id, task);
    }

    // Write task order (preserve input order)
    taskOrder.push(tasks.map((t) => t.id));
  }, ORIGIN.INIT);
}

/**
 * Hydrate a Y.Doc from Google Sheets data.
 * Uses 'sheets' origin so the observer skips cold derivations.
 *
 * Uses writeTaskToDoc which preserves unknown fields on existing tasks
 * (forward compatibility with future schema versions).
 */
export function hydrateFromSheets(doc: Y.Doc, sheetTasks: Task[]): void {
  const { tasks: ytasks, taskOrder } = getDocMaps(doc);

  doc.transact(() => {
    for (const task of sheetTasks) {
      writeTaskToDoc(ytasks, task.id, task);
    }

    taskOrder.push(sheetTasks.map((t) => t.id));
  }, ORIGIN.SHEETS);
}
