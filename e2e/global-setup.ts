/**
 * global-setup.ts — Playwright global setup that creates an ephemeral Google Sheet
 * for E2E test isolation. Each run gets a fresh sheet with known seed data.
 *
 * Skipped when:
 * - TEST_SHEET_ID_DEV is set (explicit override for local dev)
 * - GCP_SA_KEY_WRITER1_DEV is not set (no cloud auth available)
 */
import type { FullConfig } from '@playwright/test';
import { getAccessToken, getServiceAccountEmail } from './helpers/cloud-auth';
import { createTestSheet, seedTestData, shareSheet } from './helpers/sheet-lifecycle';
import * as fs from 'fs';
import * as path from 'path';

const SHEET_ID_FILE = path.join(process.cwd(), '.e2e-sheet-id');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

async function globalSetup(_config: FullConfig) {
  // Clean up sheet ID file from previous runs
  try {
    fs.unlinkSync(SHEET_ID_FILE);
  } catch {
    /* not found */
  }

  // Skip if override is set or no cloud auth
  if (process.env.TEST_SHEET_ID_DEV) {
    console.log('[E2E] Using TEST_SHEET_ID_DEV override — skipping ephemeral sheet creation');
    return;
  }
  const writerKey = process.env.GCP_SA_KEY_WRITER1_DEV;
  if (!writerKey) return;

  console.log('[E2E] Requesting token with drive.file scope...');
  const token = await getAccessToken(writerKey, [DRIVE_SCOPE]);
  console.log('[E2E] Token obtained. Creating sheet via Drive API...');
  const runId = `e2e-${Date.now()}`;
  const sheetId = await createTestSheet(token, `Ganttlet E2E ${runId}`);

  await seedTestData(token, sheetId);

  // Share with Writer2 and Reader1 SAs so collab tests work
  const writer2Key = process.env.GCP_SA_KEY_WRITER2_DEV;
  const reader1Key = process.env.GCP_SA_KEY_READER1_DEV;
  if (writer2Key) {
    const email = getServiceAccountEmail(writer2Key);
    await shareSheet(token, sheetId, email, 'writer');
  }
  if (reader1Key) {
    const email = getServiceAccountEmail(reader1Key);
    await shareSheet(token, sheetId, email, 'reader');
  }

  // Write sheet ID for test workers and global-teardown
  fs.writeFileSync(SHEET_ID_FILE, sheetId, 'utf-8');

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  console.log(`\n[E2E] Created ephemeral test sheet: ${url}\n`);
}

export default globalSetup;
