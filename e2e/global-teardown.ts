/**
 * global-teardown.ts — Playwright global teardown that deletes the ephemeral
 * test sheet. Keeps the sheet on test failure for debugging.
 */
import type { FullConfig } from '@playwright/test';
import { getAccessToken } from './helpers/cloud-auth';
import { deleteSheet } from './helpers/sheet-lifecycle';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHEET_ID_FILE = path.join(__dirname, '..', '.e2e-sheet-id');
const FAILED_FILE = path.join(__dirname, '..', '.e2e-failed');
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function globalTeardown(_config: FullConfig) {
  if (!fs.existsSync(SHEET_ID_FILE)) return;

  const sheetId = fs.readFileSync(SHEET_ID_FILE, 'utf-8').trim();
  fs.unlinkSync(SHEET_ID_FILE);

  if (!sheetId) return;

  // If any test failed, keep the sheet for debugging
  if (fs.existsSync(FAILED_FILE)) {
    fs.unlinkSync(FAILED_FILE);
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}`;
    console.log(`\n[E2E] Tests failed — keeping sheet for debugging: ${url}\n`);
    return;
  }

  const writerKey = process.env.GCP_SA_KEY_WRITER1_DEV;
  if (!writerKey) return;

  try {
    const token = await getAccessToken(writerKey, [DRIVE_FILE_SCOPE]);
    await deleteSheet(token, sheetId);
    console.log(`\n[E2E] Deleted ephemeral test sheet: ${sheetId}\n`);
  } catch (err) {
    console.warn(`[E2E] Failed to delete sheet ${sheetId}:`, err);
  }
}

export default globalTeardown;
