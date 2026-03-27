import * as Y from 'yjs';
import type { Task, ConflictRecord, SyncError } from '../types';
import { ORIGIN, triggersWriteback } from '../collab/origins';
import { readSheet, writeSheet, clearSheet } from './sheetsClient';
import {
  SHEET_COLUMNS,
  HEADER_ROW,
  taskToRow,
  rowToTask,
  validateHeaders,
  columnLetter,
} from './sheetsMapper';
import { yMapToTask, writeTaskToDoc } from '../schema/ydoc';
import { getAuthState } from './oauth';

const DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 30000;
const IDB_PREFIX = 'ganttlet-sync-base-';

// ---------------------------------------------------------------------------
// IndexedDB helpers for base-value storage
// ---------------------------------------------------------------------------

function openBaseDB(sheetId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

function idbGet(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const txn = db.transaction('base', 'readonly');
    const req = txn.objectStore('base').get(key);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const txn = db.transaction('base', 'readwrite');
    const req = txn.objectStore('base').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const txn = db.transaction('base', 'readwrite');
    const req = txn.objectStore('base').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const txn = db.transaction('base', 'readwrite');
    const req = txn.objectStore('base').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Hash a row to a stable string for comparison
function hashRow(row: string[]): string {
  // Use first 20 columns (task data) for comparison — exclude attribution columns
  return row.slice(0, 20).join('\x00');
}

export interface SheetsAdapterCallbacks {
  onConflict: (conflicts: ConflictRecord[]) => void;
  onSyncError: (error: SyncError | null) => void;
  onSyncing: (isSyncing: boolean) => void;
  onSyncComplete: () => void;
}

export class SheetsAdapter {
  private doc: Y.Doc;
  private spreadsheetId: string;
  private callbacks: SheetsAdapterCallbacks;
  private getToken: () => string | null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private saveDirty = false;
  private syncLock: Promise<void> = Promise.resolve();
  private db: IDBDatabase | null = null;
  private observer:
    | ((events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => void)
    | null = null;
  private stopped = false;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private initialLoadDone = false;
  private notifiedConflicts = new Set<string>();

  constructor(
    doc: Y.Doc,
    spreadsheetId: string,
    callbacks: SheetsAdapterCallbacks,
    getToken: () => string | null
  ) {
    this.doc = doc;
    this.spreadsheetId = spreadsheetId;
    this.callbacks = callbacks;
    this.getToken = getToken;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const prev = this.syncLock;
    this.syncLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  async start(): Promise<void> {
    if (!this.stopped && this.pollTimer) {
      console.warn('SheetsAdapter.start() called while already running');
      return;
    }
    this.stopped = false;

    // Open IndexedDB for base values
    try {
      this.db = await openBaseDB(this.spreadsheetId);
    } catch (e) {
      console.warn(
        'Failed to open base value DB, three-way merge will treat all as first-sync:',
        e
      );
    }

    // Initial load from Sheet
    await this.loadFromSheet();

    // Observe Y.Doc for local changes (including undo/redo)
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    this.observer = (_events, txn) => {
      // Mark dirty for local mutations and undo/redo operations.
      // Y.UndoManager uses itself as txn.origin (not 'local'),
      // so we check both. 'sheets' origin is excluded to prevent
      // write-back of data we just read from the Sheet.
      if (triggersWriteback(txn.origin)) {
        this.markDirty();
      }
    };
    ytasks.observeDeep(this.observer);

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);

    // Online/offline detection
    this.offlineHandler = () => {
      this.callbacks.onSyncError({
        type: 'network',
        message: 'You are offline. Changes will sync when connection is restored.',
        since: Date.now(),
      });
    };
    this.onlineHandler = () => {
      this.callbacks.onSyncError(null);
      // Trigger immediate save if dirty
      if (this.saveDirty) {
        this.flushWrite();
      }
    };
    window.addEventListener('offline', this.offlineHandler);
    window.addEventListener('online', this.onlineHandler);
  }

  stop(): void {
    this.stopped = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Remove Y.Doc observer
    if (this.observer) {
      const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
      ytasks.unobserveDeep(this.observer);
      this.observer = null;
    }

    // Remove online/offline listeners
    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler);
      this.offlineHandler = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }

    // Close IndexedDB
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  isSavePending(): boolean {
    return this.saveDirty;
  }

  // ------------------------------------------------------------------
  // Write path: Y.Doc → Sheets
  // ------------------------------------------------------------------

  private markDirty(): void {
    this.saveDirty = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushWrite(), DEBOUNCE_MS);
  }

  /**
   * Pre-write validation: log warnings for orphaned references and invalid dates.
   * Does NOT block writes — blocking risks data loss.
   */
  private validateBeforeWrite(): void {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskIds = new Set<string>();
    ytasks.forEach((_, id) => taskIds.add(id));

    ytasks.forEach((ymap, taskId) => {
      // Check orphaned dependencies (fromId references deleted task)
      try {
        const depsRaw = ymap.get('dependencies');
        if (typeof depsRaw === 'string') {
          const deps = JSON.parse(depsRaw) as Array<{ fromId?: string }>;
          for (const dep of deps) {
            if (dep.fromId && !taskIds.has(dep.fromId)) {
              console.warn(
                `SheetsAdapter validation: task ${taskId} has orphaned dependency fromId="${dep.fromId}"`
              );
            }
          }
        }
      } catch {
        /* skip malformed */
      }

      // Check orphaned parentId
      const parentId = ymap.get('parentId') as string | null;
      if (parentId && !taskIds.has(parentId)) {
        console.warn(
          `SheetsAdapter validation: task ${taskId} has orphaned parentId="${parentId}"`
        );
      }

      // Check orphaned childIds
      try {
        const childIdsRaw = ymap.get('childIds');
        if (typeof childIdsRaw === 'string') {
          const childIds = JSON.parse(childIdsRaw) as string[];
          for (const childId of childIds) {
            if (!taskIds.has(childId)) {
              console.warn(
                `SheetsAdapter validation: task ${taskId} has orphaned childId="${childId}"`
              );
            }
          }
        }
      } catch {
        /* skip malformed */
      }

      // Check invalid dates (end < start for non-milestones)
      const startDate = ymap.get('startDate') as string | undefined;
      const endDate = ymap.get('endDate') as string | undefined;
      const isMilestone = ymap.get('isMilestone') as boolean | undefined;
      if (startDate && endDate && !isMilestone && endDate < startDate) {
        console.warn(
          `SheetsAdapter validation: task ${taskId} has endDate (${endDate}) before startDate (${startDate})`
        );
      }
    });
  }

  private async flushWrite(): Promise<void> {
    if (this.stopped || !this.saveDirty) return;

    const token = this.getToken();
    if (!token) {
      this.callbacks.onSyncError({
        type: 'auth',
        message: 'Authentication required. Please sign in again.',
        since: Date.now(),
      });
      return;
    }

    await this.withLock(async () => {
      if (this.stopped || !this.saveDirty) return;

      this.callbacks.onSyncing(true);

      try {
        this.validateBeforeWrite();
        const rows = this.buildRowsFromYDoc();
        const endCol = columnLetter(SHEET_COLUMNS.length);
        const range = `Sheet1!A1:${endCol}${rows.length}`;
        await writeSheet(this.spreadsheetId, range, rows);

        // Clear orphaned rows below the data range
        const clearRange = `Sheet1!A${rows.length + 1}:${endCol}`;
        await clearSheet(this.spreadsheetId, clearRange);

        // Only clear dirty on SUCCESS
        this.saveDirty = false;

        // Update base values in IndexedDB
        await this.updateBaseValues(rows);

        this.callbacks.onSyncError(null);
        this.callbacks.onSyncComplete();
      } catch (e) {
        const syncError = this.classifySyncError(e);
        this.callbacks.onSyncError(syncError);
        // saveDirty NOT cleared — will retry
      } finally {
        this.callbacks.onSyncing(false);
      }
    });
  }

  private buildRowsFromYDoc(): string[][] {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskOrder = this.doc.getArray<string>('taskOrder');
    const userEmail = getAuthState().userEmail || 'unknown';
    const now = new Date().toISOString();

    const rows: string[][] = [HEADER_ROW];
    const orderedIds = Array.from(taskOrder);

    // Also include tasks not in taskOrder (defensive)
    const allIds = new Set<string>();
    ytasks.forEach((_, id) => allIds.add(id));
    for (const id of orderedIds) allIds.delete(id);
    const finalOrder = [...orderedIds, ...allIds];

    for (const taskId of finalOrder) {
      const ymap = ytasks.get(taskId);
      if (!ymap) continue;
      try {
        const task = yMapToTask(ymap);
        if (task.isSummary && task.childIds.length === 0) continue;
        const row = taskToRow(task);
        // Set attribution columns (indices 20, 21)
        row[20] = userEmail;
        row[21] = now;
        rows.push(row);
      } catch (e) {
        console.warn(`SheetsAdapter: failed to serialize task ${taskId}:`, e);
      }
    }

    return rows;
  }

  private async updateBaseValues(rows: string[][]): Promise<void> {
    if (!this.db) return;
    try {
      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const taskId = rows[i][0];
        if (taskId) {
          await idbPut(this.db, taskId, hashRow(rows[i]));
        }
      }
    } catch (e) {
      console.warn('Failed to update base values:', e);
    }
  }

  // ------------------------------------------------------------------
  // Read path: Sheets → Y.Doc (polling)
  // ------------------------------------------------------------------

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.loadFromSheet();
    } catch (e) {
      // Poll errors are non-fatal, just log
      console.warn('SheetsAdapter poll error:', e);
    }
  }

  private async loadFromSheet(): Promise<void> {
    const token = this.getToken();
    if (!token) return;

    await this.withLock(async () => {
      if (this.stopped) return;

      this.callbacks.onSyncing(true);

      try {
        const endCol = columnLetter(SHEET_COLUMNS.length);
        const range = `Sheet1!A1:${endCol}`;
        const rawRows = await readSheet(this.spreadsheetId, range);

        if (rawRows.length === 0) {
          // Empty sheet — write current Y.Doc
          if (this.getYDocTaskCount() > 0) {
            this.markDirty();
          }
          this.callbacks.onSyncing(false);
          if (!this.initialLoadDone) {
            this.initialLoadDone = true;
            this.callbacks.onSyncComplete();
          }
          return;
        }

        // Validate headers
        if (!validateHeaders(rawRows[0])) {
          this.callbacks.onSyncError({
            type: 'header_mismatch',
            message: 'Sheet columns do not match expected format.',
            since: Date.now(),
          });
          this.callbacks.onSyncing(false);
          return;
        }

        // Parse sheet rows into tasks
        const sheetTasks = new Map<string, { task: Task; row: string[] }>();
        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          const task = rowToTask(row);
          if (task) {
            // Fix dependency toId references
            task.dependencies = task.dependencies.map((d) => ({ ...d, toId: task.id }));
            sheetTasks.set(task.id, { task, row });
          }
        }

        // Three-way merge
        await this.threeWayMerge(sheetTasks);

        this.callbacks.onSyncError(null);
        if (!this.initialLoadDone) {
          this.initialLoadDone = true;
          this.callbacks.onSyncComplete();
        }
      } catch (e) {
        const syncError = this.classifySyncError(e);
        this.callbacks.onSyncError(syncError);
      } finally {
        this.callbacks.onSyncing(false);
      }
    });
  }

  private async threeWayMerge(
    sheetTasks: Map<string, { task: Task; row: string[] }>
  ): Promise<void> {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const conflicts: ConflictRecord[] = [];
    let needsWrite = false;

    // Get all current Y.Doc task IDs
    const ydocTaskIds = new Set<string>();
    ytasks.forEach((_, id) => ydocTaskIds.add(id));

    for (const [taskId, { task: sheetTask, row: sheetRow }] of sheetTasks) {
      const ymap = ytasks.get(taskId);

      if (!ymap) {
        // Task exists in Sheet but not in Y.Doc — inject it
        this.injectTaskIntoYDoc(sheetTask);
        // Record as base
        if (this.db) {
          await idbPut(this.db, taskId, hashRow(sheetRow));
        }
        continue;
      }

      // Task exists in both — three-way merge
      const ydocTask = yMapToTask(ymap);
      const ydocRow = taskToRow(ydocTask);
      const sheetHash = hashRow(sheetRow);
      const ydocHash = hashRow(ydocRow);

      let baseHash: string | undefined;
      if (this.db) {
        baseHash = await idbGet(this.db, taskId);
      }

      if (!baseHash) {
        // First sync — treat as no external edit, write Y.Doc to Sheet
        needsWrite = true;
        if (this.db) {
          await idbPut(this.db, taskId, ydocHash);
        }
        continue;
      }

      if (sheetHash === baseHash && ydocHash !== baseHash) {
        // No external edit, local edit → write Y.Doc to Sheet
        needsWrite = true;
      } else if (ydocHash === baseHash && sheetHash !== baseHash) {
        // No local edit, external edit → inject Sheet into Y.Doc
        this.injectTaskIntoYDoc(sheetTask);
        if (this.db) {
          await idbPut(this.db, taskId, sheetHash);
        }
      } else if (sheetHash !== baseHash && ydocHash !== baseHash && sheetHash !== ydocHash) {
        // Both changed differently → CONFLICT
        // Generate per-field conflicts
        const fieldConflicts = this.detectFieldConflicts(taskId, ydocRow, sheetRow, baseHash);
        conflicts.push(...fieldConflicts);
      }
      // If sheetHash === ydocHash, no action needed
    }

    // Check for tasks in Y.Doc but not in Sheet (deleted externally)
    for (const ydocId of ydocTaskIds) {
      if (!sheetTasks.has(ydocId)) {
        // Task was deleted externally — remove from Y.Doc and base value store.
        // Use 'sheets' origin so observers don't cascade and UndoManager ignores it.
        this.doc.transact(() => {
          ytasks.delete(ydocId);
          const taskOrder = this.doc.getArray<string>('taskOrder');
          for (let i = taskOrder.length - 1; i >= 0; i--) {
            if (taskOrder.get(i) === ydocId) {
              taskOrder.delete(i, 1);
              break;
            }
          }
        }, ORIGIN.SHEETS);

        if (this.db) {
          try {
            await idbDelete(this.db, ydocId);
          } catch (e) {
            console.warn(`Failed to delete base value for externally-deleted task ${ydocId}:`, e);
          }
        }
      }
    }

    // Dedup conflicts — only notify for new ones
    const newConflicts = conflicts.filter((c) => {
      const key = `${c.taskId}:${c.field}`;
      return !this.notifiedConflicts.has(key);
    });
    for (const c of newConflicts) {
      this.notifiedConflicts.add(`${c.taskId}:${c.field}`);
    }
    if (newConflicts.length > 0) {
      this.callbacks.onConflict(newConflicts);
    }

    if (needsWrite) {
      this.markDirty();
    }
  }

  private detectFieldConflicts(
    taskId: string,
    ydocRow: string[],
    sheetRow: string[],
    baseHashStr: string
  ): ConflictRecord[] {
    const baseFields = baseHashStr.split('\x00');
    const conflicts: ConflictRecord[] = [];
    const fieldNames = SHEET_COLUMNS.slice(0, 20);

    for (let i = 0; i < fieldNames.length; i++) {
      const local = ydocRow[i] ?? '';
      const remote = sheetRow[i] ?? '';
      const base = baseFields[i] ?? '';

      if (local !== remote && local !== base && remote !== base) {
        conflicts.push({
          taskId,
          field: fieldNames[i],
          localValue: local,
          remoteValue: remote,
          baseValue: base,
        });
      }
    }

    return conflicts;
  }

  private injectTaskIntoYDoc(task: Task): void {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskOrder = this.doc.getArray<string>('taskOrder');
    const isNew = !ytasks.has(task.id);

    this.doc.transact(() => {
      // writeTaskToDoc handles create vs update:
      // - Existing tasks: field-level update (preserves unknown fields from future versions)
      // - New tasks: creates fresh Y.Map
      writeTaskToDoc(ytasks, task.id, task);

      if (isNew) {
        taskOrder.push([task.id]);
      }
    }, ORIGIN.SHEETS); // 'sheets' origin — not undoable, no cascade
  }

  private getYDocTaskCount(): number {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    return ytasks.size;
  }

  // ------------------------------------------------------------------
  // Error classification
  // ------------------------------------------------------------------

  private classifySyncError(e: unknown): SyncError {
    if (e instanceof Response) {
      switch (e.status) {
        case 401:
          return {
            type: 'auth',
            message: 'Authentication expired. Please sign in again.',
            since: Date.now(),
          };
        case 403:
          return {
            type: 'forbidden',
            message: 'You do not have permission to access this spreadsheet.',
            since: Date.now(),
          };
        case 404:
          return {
            type: 'not_found',
            message: 'Spreadsheet not found. It may have been deleted.',
            since: Date.now(),
          };
        case 429:
          return {
            type: 'rate_limit',
            message: 'Too many requests. Retrying shortly...',
            since: Date.now(),
          };
        default:
          return { type: 'network', message: `Sheets API error: ${e.status}`, since: Date.now() };
      }
    }
    if (e instanceof Error && e.message === 'Not authenticated') {
      return {
        type: 'auth',
        message: 'Authentication required. Please sign in.',
        since: Date.now(),
      };
    }
    return {
      type: 'network',
      message: e instanceof Error ? e.message : 'Unknown sync error',
      since: Date.now(),
    };
  }

  // ------------------------------------------------------------------
  // Public: clear base values (on disconnect/sheet switch)
  // ------------------------------------------------------------------

  clearConflict(taskId: string, field: string): void {
    this.notifiedConflicts.delete(`${taskId}:${field}`);
  }

  async clearBaseValues(): Promise<void> {
    if (this.db) {
      try {
        await idbClear(this.db);
      } catch (e) {
        console.warn('Failed to clear base values:', e);
      }
    }
  }
}
