/**
 * sheet-lifecycle.ts — Create, seed, share, and delete ephemeral Google Sheets
 * for E2E test isolation. All raw fetch() — no Google SDK.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

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

export async function createTestSheet(token: string, title: string): Promise<string> {
  const res = await fetch(SHEETS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Sheet1' } }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create sheet (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.spreadsheetId;
}

export async function seedTestData(token: string, sheetId: string): Promise<void> {
  const values = [HEADER_ROW, ...SEED_TASKS];
  const range = `Sheet1!A1:T${values.length}`;
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to seed sheet (${res.status}): ${text}`);
  }
}

export async function shareSheet(
  token: string,
  sheetId: string,
  email: string,
  role: 'writer' | 'reader'
): Promise<void> {
  const url = `${DRIVE_API}/${sheetId}/permissions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'user',
      role,
      emailAddress: email,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to share sheet with ${email} (${res.status}): ${text}`);
  }
}

export async function deleteSheet(token: string, sheetId: string): Promise<void> {
  const url = `${DRIVE_API}/${sheetId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Failed to delete sheet (${res.status}): ${text}`);
  }
}
