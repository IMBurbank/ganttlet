// sheetsSync disabled — SheetsAdapter replaces this in Stage 4 (Group F)
//
// This file is a compilation stub. All sync logic moves to SheetsAdapter.
// Exported functions are no-ops that satisfy callers until Group F deletes this file.

import type { Task } from '../types';

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

let currentSpreadsheetId: string | null = null;

export function initSync(spreadsheetId: string, _dispatchFn: unknown): void {
  console.warn('sheetsSync disabled — SheetsAdapter replaces this in Stage 4');
  currentSpreadsheetId = spreadsheetId;
}

export async function loadFromSheet(): Promise<Task[]> {
  console.warn('sheetsSync disabled — SheetsAdapter replaces this in Stage 4');
  return [];
}

export function scheduleSave(_tasks: Task[]): void {
  console.warn('sheetsSync disabled — SheetsAdapter replaces this in Stage 4');
}

export function cancelPendingSave(): void {
  // no-op
}

export function isSavePending(): boolean {
  return false;
}

export function startPolling(): void {
  console.warn('sheetsSync disabled — SheetsAdapter replaces this in Stage 4');
}

export function stopPolling(): void {
  // no-op
}

export function getSpreadsheetId(): string | null {
  return currentSpreadsheetId;
}

export function setSpreadsheetId(id: string | null): void {
  currentSpreadsheetId = id;
}
