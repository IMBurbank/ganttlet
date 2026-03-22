import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../sheets/sheetsClient', () => ({
  readSheet: vi.fn(),
}));

vi.mock('../../../sheets/sheetsMapper', () => ({
  validateHeaders: vi.fn(),
  rowsToTasks: vi.fn(),
  SHEET_COLUMNS: ['id', 'name', 'startDate', 'endDate'],
}));

import TargetSheetCheck from '../TargetSheetCheck';
import { readSheet } from '../../../sheets/sheetsClient';
import { validateHeaders, rowsToTasks } from '../../../sheets/sheetsMapper';

const mockReadSheet = vi.mocked(readSheet);
const mockValidateHeaders = vi.mocked(validateHeaders);
const mockRowsToTasks = vi.mocked(rowsToTasks);

describe('TargetSheetCheck', () => {
  const onAction = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockReadSheet.mockReturnValue(new Promise(() => {})); // never resolves
    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);
    expect(screen.getByTestId('target-check-loading')).toBeTruthy();
  });

  it('auto-proceeds for empty sheets', async () => {
    mockReadSheet.mockResolvedValue([]);
    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith('proceed');
    });
  });

  it('auto-proceeds for sheet with single blank row', async () => {
    mockReadSheet.mockResolvedValue([['', '', '']]);
    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith('proceed');
    });
  });

  it('shows replace/open-existing for Ganttlet-formatted sheets', async () => {
    const headers = ['id', 'name', 'startDate'];
    mockReadSheet.mockResolvedValue([headers, ['1', 'Task A', '2025-01-01']]);
    mockValidateHeaders.mockReturnValue(true);
    mockRowsToTasks.mockReturnValue([{ id: '1', name: 'Task A' }] as never);

    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('target-check-ganttlet')).toBeTruthy();
    });

    expect(screen.getByText(/1 existing task\b/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('replace-button'));
    expect(onAction).toHaveBeenCalledWith('replace');
  });

  it('offers open-existing for Ganttlet sheets', async () => {
    mockReadSheet.mockResolvedValue([['id'], ['1', 'A']]);
    mockValidateHeaders.mockReturnValue(true);
    mockRowsToTasks.mockReturnValue([{ id: '1' }, { id: '2' }] as never);

    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('open-existing-button')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('open-existing-button'));
    expect(onAction).toHaveBeenCalledWith('open-existing');
  });

  it('shows warning for non-Ganttlet sheets', async () => {
    mockReadSheet.mockResolvedValue([['Column A', 'Column B'], ['data']]);
    mockValidateHeaders.mockReturnValue(false);

    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('target-check-non-ganttlet')).toBeTruthy();
    });

    expect(screen.getByText(/isn't in Ganttlet format/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('create-new-button'));
    expect(onAction).toHaveBeenCalledWith('create-new');
  });

  it('allows overwrite for non-Ganttlet sheets', async () => {
    mockReadSheet.mockResolvedValue([['X', 'Y'], ['data']]);
    mockValidateHeaders.mockReturnValue(false);

    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('overwrite-button')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('overwrite-button'));
    expect(onAction).toHaveBeenCalledWith('replace');
  });

  it('shows error state on read failure', async () => {
    mockReadSheet.mockRejectedValue(new Error('Network error'));

    render(<TargetSheetCheck spreadsheetId="abc" onAction={onAction} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('target-check-error')).toBeTruthy();
    });

    expect(screen.getByText('Network error')).toBeTruthy();
  });
});
