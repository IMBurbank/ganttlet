import { readSheet, updateSheet, clearSheet } from './sheetsClient';
import { tasksToRows, rowsToTasks, validateHeaders, SHEET_COLUMNS } from './sheetsMapper';
import { isSignedIn } from './oauth';
import { classifySyncError } from './syncErrors';
import { applyTasksToYjs } from '../collab/yjsBinding';
import { getDoc } from '../collab/yjsProvider';
import type { Task } from '../types';
import type { GanttAction } from '../state/actions';

const DATA_RANGE = 'Sheet1';
const WRITE_DEBOUNCE_MS = 2000;

export function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
export const BASE_POLL_INTERVAL_MS = 30000;
const MAX_POLL_INTERVAL_MS = 300000;

type SyncCallback = (action: GanttAction) => void;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let lastWriteHash = '';
let dispatch: SyncCallback | null = null;
let currentSpreadsheetId: string | null = null;
let consecutiveErrors = 0;
let currentPollInterval = BASE_POLL_INTERVAL_MS;
let saveDirty = false;
let saveInFlight = false;

function hashTasks(tasks: Task[]): string {
  // Sort by ID for order-independence. Hash only the 20 SHEET_COLUMNS fields
  // that round-trip through the sheet. EXCLUDE isExpanded/isHidden (UI-only,
  // sheetsMapper hardcodes them on every read).
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(
    sorted.map((t) => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      duration: t.duration,
      owner: t.owner,
      workStream: t.workStream,
      project: t.project,
      functionalArea: t.functionalArea,
      done: t.done,
      description: t.description,
      isMilestone: t.isMilestone,
      isSummary: t.isSummary,
      parentId: t.parentId,
      childIds: t.childIds,
      dependencies: t.dependencies,
      notes: t.notes,
      okrs: t.okrs,
      constraintType: t.constraintType,
      constraintDate: t.constraintDate,
    }))
  );
}

export function initSync(spreadsheetId: string, dispatchFn: SyncCallback): void {
  currentSpreadsheetId = spreadsheetId;
  dispatch = dispatchFn;
}

export async function loadFromSheet(): Promise<Task[]> {
  if (!currentSpreadsheetId) return [];

  dispatch?.({ type: 'START_SYNC' });
  const rows = await readSheet(currentSpreadsheetId, DATA_RANGE);

  // Empty sheet (no rows at all, or only a blank row 1) — skip validation
  if (rows.length === 0 || (rows.length === 1 && rows[0].every((c) => !c))) {
    dispatch?.({ type: 'COMPLETE_SYNC' });
    setTimeout(() => dispatch?.({ type: 'RESET_SYNC' }), 2000);
    return [];
  }

  // Validate header row
  if (rows.length > 0 && !validateHeaders(rows[0])) {
    throw new Error('HEADER_MISMATCH');
  }

  const tasks = rowsToTasks(rows);
  dispatch?.({ type: 'COMPLETE_SYNC' });
  setTimeout(() => dispatch?.({ type: 'RESET_SYNC' }), 2000);
  lastWriteHash = hashTasks(tasks);
  return tasks;
}

export function scheduleSave(tasks: Task[]): void {
  if (!currentSpreadsheetId || !isSignedIn()) return;

  const newHash = hashTasks(tasks);
  if (newHash === lastWriteHash) return;

  saveDirty = true;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    saveInFlight = true;
    try {
      dispatch?.({ type: 'START_SYNC' });
      const rows = tasksToRows(tasks);
      const endCol = columnLetter(SHEET_COLUMNS.length);
      const range = `${DATA_RANGE}!A1:${endCol}${rows.length}`;
      await updateSheet(currentSpreadsheetId!, range, rows);

      // T1.1: Clear orphaned rows below written data
      const dataEndRow = rows.length;
      const clearRange = `Sheet1!A${dataEndRow + 1}:${endCol}`;
      await clearSheet(currentSpreadsheetId!, clearRange).catch(() => {
        console.warn('Failed to clear orphaned rows');
      });

      lastWriteHash = hashTasks(tasks);
      dispatch?.({ type: 'COMPLETE_SYNC' });
      setTimeout(() => dispatch?.({ type: 'RESET_SYNC' }), 2000);
    } catch (err) {
      console.error('Failed to save to sheet:', err);
      dispatch?.({ type: 'RESET_SYNC' });
    } finally {
      saveInFlight = false;
      saveDirty = false;
    }
  }, WRITE_DEBOUNCE_MS);
}

export function cancelPendingSave(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  saveDirty = false;
}

export function isSavePending(): boolean {
  return saveDirty || saveInFlight;
}

function schedulePoll(): void {
  pollTimer = setTimeout(pollOnce, currentPollInterval);
}

async function pollOnce(): Promise<void> {
  pollTimer = null;
  if (!currentSpreadsheetId || !isSignedIn()) {
    schedulePoll();
    return;
  }
  // T2.2: Skip poll when save is pending or in-flight
  if (saveDirty || saveInFlight) {
    schedulePoll();
    return;
  }
  try {
    const rows = await readSheet(currentSpreadsheetId, DATA_RANGE);
    const incomingTasks = rowsToTasks(rows);
    // Don't overwrite local data with an empty sheet — the sheet may not
    // have been populated yet (first deploy, API just enabled, etc.)
    if (incomingTasks.length > 0) {
      const newHash = hashTasks(incomingTasks);
      if (newHash !== lastWriteHash) {
        lastWriteHash = newHash;
        dispatch?.({
          type: 'MERGE_EXTERNAL_TASKS',
          externalTasks: incomingTasks,
        });

        // Propagate Sheets changes to Yjs so other collaborators see them
        const doc = getDoc();
        if (doc) {
          applyTasksToYjs(doc, incomingTasks);
        }
      }
    }
    // Success: reset backoff and clear any sync error
    consecutiveErrors = 0;
    currentPollInterval = BASE_POLL_INTERVAL_MS;
    dispatch?.({ type: 'SET_SYNC_ERROR', error: null });
    schedulePoll();
  } catch (err) {
    console.error('Poll error:', err);
    consecutiveErrors++;

    // Classify the error for dispatch
    const syncError = classifySyncError(err);

    // Hard stop on not_found or forbidden — do not reschedule
    if (syncError.type === 'not_found' || syncError.type === 'forbidden') {
      dispatch?.({ type: 'SET_SYNC_ERROR', error: syncError });
      return;
    }

    // Set syncError once per error sequence (on first failure)
    if (consecutiveErrors === 1) {
      dispatch?.({ type: 'SET_SYNC_ERROR', error: syncError });
    }

    // Backoff: double interval after 3+ consecutive errors
    if (consecutiveErrors >= 3) {
      currentPollInterval = Math.min(currentPollInterval * 2, MAX_POLL_INTERVAL_MS);
    }
    schedulePoll();
  }
}

export function startPolling(): void {
  stopPolling();
  consecutiveErrors = 0;
  currentPollInterval = BASE_POLL_INTERVAL_MS;
  schedulePoll();
}

export function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export function getSpreadsheetId(): string | null {
  return currentSpreadsheetId;
}

export function setSpreadsheetId(id: string | null): void {
  currentSpreadsheetId = id;
}
