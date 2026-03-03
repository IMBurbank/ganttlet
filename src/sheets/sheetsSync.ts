import { readSheet, updateSheet } from './sheetsClient';
import { tasksToRows, rowsToTasks } from './sheetsMapper';
import { isSignedIn } from './oauth';
import type { Task } from '../types';
import type { GanttAction } from '../state/actions';

const DATA_RANGE = 'Sheet1';
const WRITE_DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 30000;

type SyncCallback = (action: GanttAction) => void;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastWriteHash = '';
let dispatch: SyncCallback | null = null;
let currentSpreadsheetId: string | null = null;

function hashTasks(tasks: Task[]): string {
  return JSON.stringify(tasks.map(t => ({
    id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate,
    duration: t.duration, owner: t.owner, done: t.done, dependencies: t.dependencies,
    parentId: t.parentId, childIds: t.childIds,
  })));
}

export function initSync(
  spreadsheetId: string,
  dispatchFn: SyncCallback,
): void {
  currentSpreadsheetId = spreadsheetId;
  dispatch = dispatchFn;
}

export async function loadFromSheet(): Promise<Task[]> {
  if (!currentSpreadsheetId || !isSignedIn()) return [];

  dispatch?.({ type: 'START_SYNC' });
  try {
    const rows = await readSheet(currentSpreadsheetId, DATA_RANGE);
    const tasks = rowsToTasks(rows);
    dispatch?.({ type: 'COMPLETE_SYNC' });
    setTimeout(() => dispatch?.({ type: 'RESET_SYNC' }), 2000);
    lastWriteHash = hashTasks(tasks);
    return tasks;
  } catch (err) {
    console.error('Failed to load from sheet:', err);
    dispatch?.({ type: 'RESET_SYNC' });
    return [];
  }
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
      const range = `${DATA_RANGE}!A1:R${rows.length}`;
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

export function startPolling(onNewTasks: (tasks: Task[]) => void): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!currentSpreadsheetId || !isSignedIn()) return;
    try {
      const rows = await readSheet(currentSpreadsheetId, DATA_RANGE);
      const tasks = rowsToTasks(rows);
      // Don't overwrite local data with an empty sheet — the sheet may not
      // have been populated yet (first deploy, API just enabled, etc.)
      if (tasks.length === 0) return;
      const newHash = hashTasks(tasks);
      if (newHash !== lastWriteHash) {
        lastWriteHash = newHash;
        onNewTasks(tasks);
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
