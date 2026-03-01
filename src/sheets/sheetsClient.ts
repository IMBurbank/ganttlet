import { getAccessToken } from './oauth';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function readSheet(spreadsheetId: string, range: string): Promise<string[][]> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${error}`);
  }

  const data = await res.json();
  return data.values || [];
}

export async function writeSheet(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${error}`);
  }
}

export async function clearSheet(spreadsheetId: string, range: string): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${error}`);
  }
}
