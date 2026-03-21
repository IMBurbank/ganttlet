import { readSheet, updateSheet } from './sheetsClient';
import { tasksToRows, rowsToTasks, validateHeaders, SHEET_COLUMNS } from './sheetsMapper';
import { isSignedIn } from './oauth';
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
const POLL_INTERVAL_MS = 30000;

type SyncCallback = (action: GanttAction) => void;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastWriteHash = '';
let dispatch: SyncCallback | null = null;
let currentSpreadsheetId: string | null = null;

function hashTasks(tasks: Task[]): string {
  return JSON.stringify(
    tasks.map((t) => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      duration: t.duration,
      owner: t.owner,
      done: t.done,
      dependencies: t.dependencies,
      parentId: t.parentId,
      childIds: t.childIds,
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

  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    try {
      dispatch?.({ type: 'START_SYNC' });
      const rows = tasksToRows(tasks);
      const endCol = columnLetter(SHEET_COLUMNS.length);
      const range = `${DATA_RANGE}!A1:${endCol}${rows.length}`;
      await updateSheet(currentSpreadsheetId!, range, rows);
      lastWriteHash = hashTasks(tasks);
      dispatch?.({ type: 'COMPLETE_SYNC' });
      setTimeout(() => dispatch?.({ type: 'RESET_SYNC' }), 2000);
    } catch (err) {
      console.error('Failed to save to sheet:', err);
      dispatch?.({ type: 'RESET_SYNC' });
    }
  }, WRITE_DEBOUNCE_MS);
}

export function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!currentSpreadsheetId || !isSignedIn()) return;
    try {
      const rows = await readSheet(currentSpreadsheetId, DATA_RANGE);
      const incomingTasks = rowsToTasks(rows);
      // Don't overwrite local data with an empty sheet — the sheet may not
      // have been populated yet (first deploy, API just enabled, etc.)
      if (incomingTasks.length === 0) return;
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
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getSpreadsheetId(): string | null {
  return currentSpreadsheetId;
}

export function setSpreadsheetId(id: string | null): void {
  currentSpreadsheetId = id;
}
