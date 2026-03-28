import type { Task } from '../types';
import { taskToRow, TASK_DATA_COLUMN_COUNT } from './sheetsMapper';

const IDB_PREFIX = 'ganttlet-sync-base-';

/**
 * IndexedDB-backed store for three-way merge base values.
 *
 * Each task's base value is a hash of its canonical row representation
 * at the time of the last successful sync. The three-way merge compares
 * this base against the current Sheet row and current Y.Doc task to
 * determine which side changed (or both → conflict).
 *
 * Hashes use canonical field order (taskToRow), so column reordering
 * in the Sheet doesn't invalidate stored base values.
 */
export class BaseValueStore {
  private db: IDBDatabase | null = null;

  async open(sheetId: string): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(`${IDB_PREFIX}${sheetId}`, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('base')) {
          req.result.createObjectStore('base');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async get(taskId: string): Promise<string | undefined> {
    if (!this.db) return undefined;
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction('base', 'readonly');
      const req = txn.objectStore('base').get(taskId);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async put(taskId: string, hash: string): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction('base', 'readwrite');
      const req = txn.objectStore('base').put(hash, taskId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(taskId: string): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction('base', 'readwrite');
      const req = txn.objectStore('base').delete(taskId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const txn = this.db!.transaction('base', 'readwrite');
      const req = txn.objectStore('base').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

/**
 * Hash a task in canonical field order for three-way merge comparison.
 * Uses taskToRow (canonical column order) so the hash is independent of
 * the Sheet's actual column arrangement.
 */
export function hashTask(task: Task): string {
  const row = taskToRow(task);
  return row.slice(0, TASK_DATA_COLUMN_COUNT).join('\x00');
}
