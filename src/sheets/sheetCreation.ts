import { getAccessToken } from './oauth';
import { updateSheet } from './sheetsClient';
import { HEADER_ROW, SHEET_COLUMNS, taskToRow, columnLetter } from './sheetsMapper';
import { addRecentSheet } from '../utils/recentSheets';
import { getTemplate } from '../data/templates';
import type { MutateAction } from '../types';

export async function createSheet(title: string): Promise<string> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
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
  if (!res.ok) throw res;
  const data = await res.json();
  return data.spreadsheetId;
}

/**
 * Create a new sheet from a template: creates the spreadsheet, writes tasks,
 * and tracks in recent sheets. Returns the spreadsheet ID.
 * The caller is responsible for state transitions (UIStore, URL updates).
 */
export async function createProjectFromTemplate(
  name: string,
  templateId: string,
  mutate: (action: MutateAction) => void
): Promise<string> {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  const { tasks } = await template.load();

  // Create the sheet
  const spreadsheetId = await createSheet(name);

  // Write header row + task data rows
  const rows: string[][] = [HEADER_ROW];
  for (const task of tasks) {
    rows.push(taskToRow(task));
  }

  const endCol = columnLetter(SHEET_COLUMNS.length);
  const range = `Sheet1!A1:${endCol}${rows.length}`;
  await updateSheet(spreadsheetId, range, rows);

  // Track in recent sheets
  addRecentSheet({ sheetId: spreadsheetId, title: name, lastOpened: Date.now() });

  // Add tasks to Y.Doc — SheetsAdapter will reconcile on first poll
  for (const task of tasks) {
    mutate({ type: 'ADD_TASK', task });
  }

  return spreadsheetId;
}
