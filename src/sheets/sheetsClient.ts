import { getAccessToken } from './oauth';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 5, initialDelay = 1000, maxDelay = 60000, jitterFactor = 0.2 } = opts;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxAttempts) throw error;

      // Check for Retry-After header on 429 responses
      if (error instanceof Response && error.status === 429) {
        const retryAfter = error.headers.get('Retry-After');
        if (retryAfter) {
          delay = parseInt(retryAfter, 10) * 1000;
        }
      }

      // Add jitter: +/- jitterFactor of current delay
      const jitter = delay * jitterFactor * (2 * Math.random() - 1);
      const waitTime = Math.min(delay + jitter, maxDelay);

      console.warn(`Sheets API attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(waitTime)}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      delay = Math.min(delay * 2, maxDelay);
    }
  }
  throw new Error('Unreachable');
}

export async function readSheet(spreadsheetId: string, range: string): Promise<string[][]> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  return retryWithBackoff(async () => {
    const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw res;

    const data = await res.json();
    return data.values || [];
  });
}

export async function writeSheet(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  return retryWithBackoff(async () => {
    const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
    });

    if (!res.ok) throw res;
  });
}

export async function clearSheet(spreadsheetId: string, range: string): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  return retryWithBackoff(async () => {
    const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw res;
  });
}

export async function updateSheet(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  return retryWithBackoff(async () => {
    const res = await fetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      },
    );

    if (!res.ok) throw res;
  });
}
