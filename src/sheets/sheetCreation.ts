import { getAccessToken } from './oauth';
import { updateSheet } from './sheetsClient';
import { HEADER_ROW, SHEET_COLUMNS, taskToRow } from './sheetsMapper';
import { initSync, startPolling, scheduleSave, columnLetter } from './sheetsSync';
import { addRecentSheet } from '../utils/recentSheets';
import { getTemplate } from '../data/templates';
import type { GanttAction } from '../state/actions';

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

export async function createProjectFromTemplate(
  name: string,
  templateId: string,
  dispatch: (action: GanttAction) => void
): Promise<void> {
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

  if (rows.length > 1) {
    const endCol = columnLetter(SHEET_COLUMNS.length);
    const range = `Sheet1!A1:${endCol}${rows.length}`;
    await updateSheet(spreadsheetId, range, rows);
  } else {
    // Blank template — write just headers
    const endCol = columnLetter(SHEET_COLUMNS.length);
    const range = `Sheet1!A1:${endCol}1`;
    await updateSheet(spreadsheetId, range, rows);
  }

  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.set('sheet', spreadsheetId);
  url.searchParams.set('room', spreadsheetId);
  window.history.replaceState({}, '', url.toString());

  // Track in recent sheets
  addRecentSheet({ sheetId: spreadsheetId, title: name, lastOpened: Date.now() });

  // Init sync for ALL templates (including Blank — auto-save needs a target)
  initSync(spreadsheetId, dispatch);
  startPolling();

  if (tasks.length > 0) {
    // Non-blank: set tasks and mark as sheet-connected
    dispatch({ type: 'SET_TASKS', tasks });
    scheduleSave(tasks);
    dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
  } else {
    // Blank: show empty state (initSync/startPolling already called)
    dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'empty' });
  }
}
