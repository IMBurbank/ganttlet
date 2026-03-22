import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock state hooks
const mockState = {
  syncError: null as import('../../../types').SyncError | null,
  dataSource: 'sheet' as string | undefined,
  tasks: [],
};
const mockDispatch = vi.fn();

vi.mock('../../../state/GanttContext', () => ({
  useGanttState: () => mockState,
  useGanttDispatch: () => mockDispatch,
}));

const mockSignIn = vi.fn();
vi.mock('../../../sheets/oauth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
}));

vi.mock('../../../sheets/sheetsSync', () => ({
  loadFromSheet: vi.fn().mockResolvedValue([]),
  scheduleSave: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getSpreadsheetId: () => 'test-sheet-id',
}));

vi.mock('../../../sheets/syncErrors', () => ({
  classifySyncError: vi.fn(),
}));

import ErrorBanner from '../ErrorBanner';

describe('ErrorBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.syncError = null;
    mockState.dataSource = 'sheet';
    mockState.tasks = [];
  });

  it('renders nothing when no syncError', () => {
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for rate_limit', () => {
    mockState.syncError = { type: 'rate_limit', message: 'Rate limited', since: Date.now() };
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for header_mismatch', () => {
    mockState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders auth error with re-authorize link', () => {
    mockState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/Session expired/)).toBeTruthy();
    expect(screen.getByTestId('reauth-btn')).toBeTruthy();
  });

  it('auth re-authorize triggers signIn', () => {
    mockState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    render(<ErrorBanner />);
    fireEvent.click(screen.getByTestId('reauth-btn'));
    expect(mockSignIn).toHaveBeenCalled();
  });

  it('renders not_found error with Open another sheet', () => {
    mockState.syncError = { type: 'not_found', message: 'Not found', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/may have been deleted/)).toBeTruthy();
    expect(screen.getByTestId('open-another-btn')).toBeTruthy();
  });

  it('renders forbidden error with Open another sheet', () => {
    mockState.syncError = { type: 'forbidden', message: 'Forbidden', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/may have been deleted/)).toBeTruthy();
    expect(screen.getByTestId('open-another-btn')).toBeTruthy();
  });

  it('renders network error message', () => {
    mockState.syncError = { type: 'network', message: 'Offline', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it('shows Retry button when dataSource is loading + auth error', () => {
    mockState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    mockState.dataSource = 'loading';
    render(<ErrorBanner />);
    expect(screen.getByTestId('retry-btn')).toBeTruthy();
  });

  it('shows Retry button when dataSource is loading + not_found error', () => {
    mockState.syncError = { type: 'not_found', message: 'Not found', since: Date.now() };
    mockState.dataSource = 'loading';
    render(<ErrorBanner />);
    expect(screen.getByTestId('retry-btn')).toBeTruthy();
  });

  it('does NOT show Retry when dataSource is sheet (not loading)', () => {
    mockState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    mockState.dataSource = 'sheet';
    render(<ErrorBanner />);
    expect(screen.queryByTestId('retry-btn')).toBeNull();
  });

  it('does NOT show Retry for network errors', () => {
    mockState.syncError = { type: 'network', message: 'Offline', since: Date.now() };
    mockState.dataSource = 'loading';
    render(<ErrorBanner />);
    expect(screen.queryByTestId('retry-btn')).toBeNull();
  });

  it('calls startPolling after successful retry', async () => {
    const { startPolling } = await import('../../../sheets/sheetsSync');
    mockState.syncError = { type: 'not_found', message: 'Not found', since: Date.now() };
    mockState.dataSource = 'loading';
    render(<ErrorBanner />);

    fireEvent.click(screen.getByTestId('retry-btn'));

    // Wait for the async loadFromSheet promise to resolve
    await vi.waitFor(() => {
      expect(startPolling).toHaveBeenCalledTimes(1);
    });
  });
});
