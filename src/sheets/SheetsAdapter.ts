import * as Y from 'yjs';
import type { Task, ConflictRecord, SyncError } from '../types';
import { ORIGIN, triggersWriteback } from '../collab/origins';
import { readSheet, writeSheet, clearSheet } from './sheetsClient';
import {
  SHEET_COLUMNS,
  HEADER_ROW,
  TASK_DATA_COLUMN_COUNT,
  taskToRow,
  taskToRowWithMap,
  rowToTask,
  validateHeaders,
  columnLetter,
  type HeaderMap,
} from './sheetsMapper';
import { yMapToTask, writeTaskToDoc } from '../schema/ydoc';
import { getAuthState } from './oauth';
import { BaseValueStore, hashTask } from './BaseValueStore';

const DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 30000;

// ─── Types ───────────────────────────────────────────────────────────

export interface SheetsAdapterCallbacks {
  onConflict: (conflicts: ConflictRecord[]) => void;
  onSyncError: (error: SyncError | null) => void;
  onSyncing: (isSyncing: boolean) => void;
  onSyncComplete: () => void;
}

// ─── SheetsAdapter ───────────────────────────────────────────────────

export class SheetsAdapter {
  private doc: Y.Doc;
  private spreadsheetId: string;
  private callbacks: SheetsAdapterCallbacks;
  private getToken: () => string | null;

  private baseValues = new BaseValueStore();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private saveDirty = false;
  private syncLock: Promise<void> = Promise.resolve();
  private observer:
    | ((events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => void)
    | null = null;
  private stopped = false;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private initialLoadDone = false;
  private notifiedConflicts = new Set<string>();

  /**
   * The Sheet's actual column layout, captured on each loadFromSheet().
   * Used by the write path to write rows in the Sheet's order (not our canonical
   * order), so user column reordering in Google Sheets is preserved.
   * null = Sheet hasn't been loaded yet (first write uses canonical order).
   */
  private sheetHeaderMap: HeaderMap | null = null;
  private sheetColumnCount: number = SHEET_COLUMNS.length;

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

  // ─── Lifecycle ─────────────────────────────────────────────────────

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
      await this.baseValues.open(this.spreadsheetId);
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
      if (this.saveDirty) {
        this.flushWrite();
      }
    };
    window.addEventListener('offline', this.offlineHandler);
    window.addEventListener('online', this.onlineHandler);
  }

  /**
   * Stop the adapter. Async because it waits for in-flight operations
   * (flushWrite, loadFromSheet) to complete before closing IndexedDB.
   * Without this, restart() during an in-flight operation would close
   * the database under pending IndexedDB transactions.
   */
  async stop(): Promise<void> {
    this.stopped = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.observer) {
      const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
      ytasks.unobserveDeep(this.observer);
      this.observer = null;
    }

    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler);
      this.offlineHandler = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }

    // Wait for any in-flight withLock operations (flushWrite, loadFromSheet)
    // to complete before closing the database.
    await this.syncLock;
    this.baseValues.close();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  isSavePending(): boolean {
    return this.saveDirty;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  getSpreadsheetId(): string {
    return this.spreadsheetId;
  }

  // ─── Write Path: Y.Doc → Sheets ───────────────────────────────────

  private markDirty(): void {
    this.saveDirty = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushWrite(), DEBOUNCE_MS);
  }

  private validateBeforeWrite(): void {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskIds = new Set<string>();
    ytasks.forEach((_, id) => taskIds.add(id));

    ytasks.forEach((ymap, taskId) => {
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

      const parentId = ymap.get('parentId') as string | null;
      if (parentId && !taskIds.has(parentId)) {
        console.warn(
          `SheetsAdapter validation: task ${taskId} has orphaned parentId="${parentId}"`
        );
      }

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
        const { rows, tasks } = this.buildRowsFromYDoc();
        const endCol = columnLetter(this.sheetColumnCount);

        if (this.sheetHeaderMap) {
          // Existing Sheet: write data rows only (row 2 onward), preserve header
          const dataRows = rows;
          // +1 for the header row that's already in the Sheet
          const range = `Sheet1!A2:${endCol}${dataRows.length + 1}`;
          await writeSheet(this.spreadsheetId, range, dataRows);

          // Clear orphaned rows below the data range
          const clearRange = `Sheet1!A${dataRows.length + 2}:${endCol}`;
          await clearSheet(this.spreadsheetId, clearRange);
        } else {
          // New Sheet: write header + data in canonical order
          const allRows = [HEADER_ROW, ...rows];
          const range = `Sheet1!A1:${endCol}${allRows.length}`;
          await writeSheet(this.spreadsheetId, range, allRows);

          const clearRange = `Sheet1!A${allRows.length + 1}:${endCol}`;
          await clearSheet(this.spreadsheetId, clearRange);
        }

        this.saveDirty = false;

        await this.updateBaseValues(tasks);

        this.callbacks.onSyncError(null);
        this.callbacks.onSyncComplete();
      } catch (e) {
        const syncError = this.classifySyncError(e);
        this.callbacks.onSyncError(syncError);
      } finally {
        this.callbacks.onSyncing(false);
      }
    });
  }

  private buildRowsFromYDoc(): { rows: string[][]; tasks: Task[] } {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const taskOrder = this.doc.getArray<string>('taskOrder');
    const userEmail = getAuthState().userEmail || 'unknown';
    const now = new Date().toISOString();

    const rows: string[][] = [];
    const tasks: Task[] = [];
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

        // Write in the Sheet's column order if we know it, otherwise canonical
        let row: string[];
        if (this.sheetHeaderMap) {
          row = taskToRowWithMap(task, this.sheetHeaderMap, this.sheetColumnCount);
        } else {
          row = taskToRow(task);
        }

        // Set attribution columns
        if (this.sheetHeaderMap) {
          const modByIdx = this.sheetHeaderMap.get('lastmodifiedby');
          const modAtIdx = this.sheetHeaderMap.get('lastmodifiedat');
          if (modByIdx !== undefined) row[modByIdx] = userEmail;
          if (modAtIdx !== undefined) row[modAtIdx] = now;
        } else {
          // Canonical positions (20, 21)
          row[TASK_DATA_COLUMN_COUNT] = userEmail;
          row[TASK_DATA_COLUMN_COUNT + 1] = now;
        }

        rows.push(row);
        tasks.push(task);
      } catch (e) {
        console.warn(`SheetsAdapter: failed to serialize task ${taskId}:`, e);
      }
    }

    return { rows, tasks };
  }

  private async updateBaseValues(tasks: Task[]): Promise<void> {
    try {
      for (const task of tasks) {
        if (task.id) {
          await this.baseValues.put(task.id, hashTask(task));
        }
      }
    } catch (e) {
      console.warn('Failed to update base values:', e);
    }
  }

  // ─── Read Path: Sheets → Y.Doc (polling) ──────────────────────────

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.loadFromSheet();
    } catch (e) {
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
          // Empty sheet — write current Y.Doc.
          // Preserve sheetHeaderMap if we've loaded before (another user may have
          // cleared the data rows but the column order should be maintained).
          // Only set to null on true first load (never seen a header).
          if (!this.initialLoadDone) {
            this.sheetHeaderMap = null;
          }
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

        // Validate headers and build column map
        const headerMap = validateHeaders(rawRows[0]);
        if (!headerMap) {
          this.callbacks.onSyncError({
            type: 'header_mismatch',
            message: 'Sheet columns do not match expected format.',
            since: Date.now(),
          });
          this.callbacks.onSyncing(false);
          return;
        }

        // Store the Sheet's column layout for write-path column-order preservation
        this.sheetHeaderMap = headerMap;
        this.sheetColumnCount = rawRows[0].length;

        // Parse sheet rows into tasks using header-based column lookup
        const sheetTasks = new Map<string, { task: Task }>();
        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          const task = rowToTask(row, headerMap);
          if (task) {
            task.dependencies = task.dependencies.map((d) => ({ ...d, toId: task.id }));
            sheetTasks.set(task.id, { task });
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

  private async threeWayMerge(sheetTasks: Map<string, { task: Task }>): Promise<void> {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    const conflicts: ConflictRecord[] = [];
    let needsWrite = false;

    const ydocTaskIds = new Set<string>();
    ytasks.forEach((_, id) => ydocTaskIds.add(id));

    for (const [taskId, { task: sheetTask }] of sheetTasks) {
      const ymap = ytasks.get(taskId);

      if (!ymap) {
        this.injectTaskIntoYDoc(sheetTask);
        await this.baseValues.put(taskId, hashTask(sheetTask));
        continue;
      }

      const ydocTask = yMapToTask(ymap);
      const sheetHash = hashTask(sheetTask);
      const ydocHash = hashTask(ydocTask);

      const baseHash = await this.baseValues.get(taskId);

      if (!baseHash) {
        needsWrite = true;
        await this.baseValues.put(taskId, ydocHash);
        continue;
      }

      if (sheetHash === baseHash && ydocHash !== baseHash) {
        // No external edit, local edit → write Y.Doc to Sheet
        needsWrite = true;
      } else if (ydocHash === baseHash && sheetHash !== baseHash) {
        // No local edit, external edit → inject Sheet into Y.Doc
        this.injectTaskIntoYDoc(sheetTask);
        await this.baseValues.put(taskId, sheetHash);
      } else if (sheetHash !== baseHash && ydocHash !== baseHash && sheetHash === ydocHash) {
        // Both sides independently converged to the same value — no conflict.
        // Update base to the converged value so the next diverging edit doesn't
        // produce a spurious conflict against the stale base.
        await this.baseValues.put(taskId, sheetHash);
      } else if (sheetHash !== baseHash && ydocHash !== baseHash && sheetHash !== ydocHash) {
        // Both changed differently → CONFLICT
        const ydocRow = taskToRow(ydocTask);
        const sheetRow = taskToRow(sheetTask);
        const fieldConflicts = this.detectFieldConflicts(taskId, ydocRow, sheetRow, baseHash);
        conflicts.push(...fieldConflicts);
      }
    }

    // External deletes win unconditionally — Sheets is authoritative.
    // See architecture discussion in docs/plans/frontend-redesign.md.
    for (const ydocId of ydocTaskIds) {
      if (!sheetTasks.has(ydocId)) {
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

        try {
          await this.baseValues.delete(ydocId);
        } catch (e) {
          console.warn(`Failed to delete base value for externally-deleted task ${ydocId}:`, e);
        }
      }
    }

    // Dedup conflicts
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
    const fieldNames = SHEET_COLUMNS.slice(0, TASK_DATA_COLUMN_COUNT);

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
      writeTaskToDoc(ytasks, task.id, task);
      if (isNew) {
        taskOrder.push([task.id]);
      }
    }, ORIGIN.SHEETS);
  }

  private getYDocTaskCount(): number {
    const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    return ytasks.size;
  }

  // ─── Error Classification ─────────────────────────────────────────

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

  // ─── Public: conflict & base value management ─────────────────────

  /**
   * Clear a conflict notification and update the base value to the current
   * Y.Doc state. This prevents the same conflict from being re-reported
   * on the next poll — the base now matches the resolved Y.Doc value.
   *
   * Uses withLock to serialize with loadFromSheet/flushWrite — without the
   * lock, the poll's read-compute-write on baseValues could overwrite the
   * resolved base hash.
   */
  async clearConflict(taskId: string, field: string): Promise<void> {
    this.notifiedConflicts.delete(`${taskId}:${field}`);

    await this.withLock(async () => {
      const ytasks = this.doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
      const ymap = ytasks.get(taskId);
      if (ymap) {
        const task = yMapToTask(ymap);
        await this.baseValues.put(taskId, hashTask(task));
      }
    });
  }

  async clearBaseValues(): Promise<void> {
    try {
      await this.baseValues.clear();
    } catch (e) {
      console.warn('Failed to clear base values:', e);
    }
  }
}
