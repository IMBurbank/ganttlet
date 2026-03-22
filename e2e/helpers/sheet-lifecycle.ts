/**
 * sheet-lifecycle.ts — Reset a pre-provisioned test sheet to known seed state.
 * Used by global-setup to ensure E2E tests start with clean, predictable data.
 * All raw fetch() — no Google SDK.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

const HEADER_ROW = [
  'id',
  'name',
  'startDate',
  'endDate',
  'duration',
  'owner',
  'workStream',
  'project',
  'functionalArea',
  'done',
  'description',
  'isMilestone',
  'isSummary',
  'parentId',
  'childIds',
  'dependencies',
  'notes',
  'okrs',
  'constraintType',
  'constraintDate',
];

// 3 seed tasks: FS dependency chain, business-day dates, covers collab test patterns
const SEED_TASKS: string[][] = [
  [
    'e2e-1',
    'Alpha Task',
    '2026-06-01',
    '2026-06-05',
    '5',
    'Writer1',
    '',
    '',
    '',
    'false',
    '',
    'false',
    'false',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'e2e-2',
    'Beta Task',
    '2026-06-08',
    '2026-06-12',
    '5',
    'Writer1',
    '',
    '',
    '',
    'false',
    '',
    'false',
    'false',
    '',
    '',
    'e2e-1:FS:0',
    '',
    '',
    '',
    '',
  ],
  [
    'e2e-3',
    'Gamma Task',
    '2026-06-15',
    '2026-06-19',
    '5',
    'Writer2',
    '',
    '',
    '',
    'false',
    '',
    'false',
    'false',
    '',
    '',
    'e2e-2:FS:0',
    '',
    '',
    '',
    '',
  ],
];

/**
 * Reset a test sheet to known seed state: clear all data, write header + 3 tasks.
 * Uses only the spreadsheets scope (no Drive API needed).
 */
export async function resetTestSheet(token: string, sheetId: string): Promise<void> {
  // Clear entire sheet
  const clearUrl = `${SHEETS_API}/${sheetId}/values/Sheet1:clear`;
  const clearRes = await fetch(clearUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!clearRes.ok) {
    const text = await clearRes.text();
    throw new Error(`Failed to clear sheet (${clearRes.status}): ${text}`);
  }

  // Write header + seed tasks
  const values = [HEADER_ROW, ...SEED_TASKS];
  const range = `Sheet1!A1:T${values.length}`;
  const writeUrl = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const writeRes = await fetch(writeUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!writeRes.ok) {
    const text = await writeRes.text();
    throw new Error(`Failed to seed sheet (${writeRes.status}): ${text}`);
  }
}
