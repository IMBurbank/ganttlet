import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../oauth', () => ({
  getAccessToken: vi.fn(),
}));

import { createSheet } from '../sheetCreation';
import { getAccessToken } from '../oauth';

const mockGetAccessToken = vi.mocked(getAccessToken);

describe('createSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetAccessToken.mockReturnValue('test-token');
  });

  it('creates a spreadsheet and returns the ID', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ spreadsheetId: 'new-sheet-123' }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const id = await createSheet('My Project');

    expect(id).toBe('new-sheet-123');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: 'My Project' },
        sheets: [{ properties: { title: 'Sheet1' } }],
      }),
    });
  });

  it('throws when not authenticated', async () => {
    mockGetAccessToken.mockReturnValue(null);
    await expect(createSheet('Test')).rejects.toThrow('Not authenticated');
  });

  it('throws the response when API returns error', async () => {
    const mockResponse = { ok: false, status: 403 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    await expect(createSheet('Test')).rejects.toBe(mockResponse);
  });
});
