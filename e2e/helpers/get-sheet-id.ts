/**
 * get-sheet-id.ts — Read the ephemeral test sheet ID created by global-setup,
 * or fall back to the TEST_SHEET_ID_DEV override for local development.
 */
import * as fs from 'fs';
import * as path from 'path';

const SHEET_ID_FILE = path.join(process.cwd(), '.e2e-sheet-id');

export function getTestSheetId(): string | undefined {
  // Explicit override takes precedence (local dev workflow)
  if (process.env.TEST_SHEET_ID_DEV) return process.env.TEST_SHEET_ID_DEV;
  try {
    const id = fs.readFileSync(SHEET_ID_FILE, 'utf-8').trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}
