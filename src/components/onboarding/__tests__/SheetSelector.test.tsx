import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SheetSelector from '../SheetSelector';

vi.mock('../../../sheets/oauth', () => ({
  getAccessToken: () => 'mock-token',
}));

vi.mock('../../../sheets/sheetsBrowser', () => ({
  listUserSheets: vi.fn().mockResolvedValue([
    { id: 'sheet1', name: 'Project Plan', modifiedTime: '2024-01-15T10:00:00Z', iconLink: '' },
    { id: 'sheet2', name: 'Budget', modifiedTime: '2024-01-14T09:00:00Z', iconLink: '' },
  ]),
}));

describe('SheetSelector', () => {
  const onSelectSheet = vi.fn();

  beforeEach(() => {
    onSelectSheet.mockClear();
  });

  it('renders sheet listing after loading', async () => {
    render(<SheetSelector onSelectSheet={onSelectSheet} />);

    await waitFor(() => {
      expect(screen.getByText('Project Plan')).toBeTruthy();
      expect(screen.getByText('Budget')).toBeTruthy();
    });
  });

  it('selects a sheet from the list and connects', async () => {
    render(<SheetSelector onSelectSheet={onSelectSheet} />);

    await waitFor(() => {
      expect(screen.getByTestId('sheet-item-sheet1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('sheet-item-sheet1'));
    fireEvent.click(screen.getByTestId('connect-button'));

    expect(onSelectSheet).toHaveBeenCalledWith('sheet1');
  });

  it('extracts ID from pasted valid URL and enables connect', async () => {
    render(<SheetSelector onSelectSheet={onSelectSheet} />);

    const input = screen.getByTestId('url-input');
    fireEvent.change(input, {
      target: { value: 'https://docs.google.com/spreadsheets/d/abc123/edit' },
    });

    expect(screen.queryByTestId('url-error')).toBeNull();

    fireEvent.click(screen.getByTestId('connect-button'));
    expect(onSelectSheet).toHaveBeenCalledWith('abc123');
  });

  it('shows error for invalid URL and keeps connect disabled', async () => {
    render(<SheetSelector onSelectSheet={onSelectSheet} />);

    const input = screen.getByTestId('url-input');
    fireEvent.change(input, {
      target: { value: 'https://example.com/not-a-sheet' },
    });

    expect(screen.getByTestId('url-error')).toBeTruthy();
    expect(screen.getByTestId('url-error').textContent).toBe(
      "Couldn't find a spreadsheet ID in this URL"
    );

    // Connect button should be disabled
    const connectBtn = screen.getByTestId('connect-button') as HTMLButtonElement;
    expect(connectBtn.disabled).toBe(true);
  });

  it('has Connect button disabled initially', () => {
    render(<SheetSelector onSelectSheet={onSelectSheet} />);
    const connectBtn = screen.getByTestId('connect-button') as HTMLButtonElement;
    expect(connectBtn.disabled).toBe(true);
  });

  it('has Create New Sheet button rendered as disabled stub', () => {
    render(<SheetSelector onSelectSheet={onSelectSheet} />);
    const createBtn = screen.getByTestId('create-new-button') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });
});
