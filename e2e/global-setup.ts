/**
 * global-setup.ts — Reset the CI test sheet to known seed state before E2E tests.
 *
 * Two-sheet strategy:
 * - CI: uses TEST_SHEET_ID_CI (pre-provisioned, shared with CI SAs)
 * - Local dev: uses TEST_SHEET_ID_DEV (set by developer, never touched by CI)
 *
 * globalSetup resets the sheet to 3 seed tasks so every run starts clean.
 * No sheet creation/deletion — avoids Drive API scope requirements.
 */
import type { FullConfig } from '@playwright/test';
import { getAccessToken } from './helpers/cloud-auth';
import { resetTestSheet } from './helpers/sheet-lifecycle';
import { getTestSheetId } from './helpers/get-sheet-id';

async function globalSetup(_config: FullConfig) {
  const sheetId = getTestSheetId();
  if (!sheetId) return; // No sheet configured — cloud tests will skip

  const writerKey = process.env.GCP_SA_KEY_WRITER1_DEV;
  if (!writerKey) return;

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  console.log(`[E2E] Resetting test sheet to seed state: ${url}`);
  const token = await getAccessToken(writerKey);
  await resetTestSheet(token, sheetId);
  console.log(`[E2E] Sheet reset complete — 3 seed tasks written to ${sheetId}`);
}

export default globalSetup;
