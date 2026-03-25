import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock UI store state
const mockUIState = {
  syncError: null as import('../../../types').SyncError | null,
  dataSource: 'sheet' as string | undefined,
};

vi.mock('../../../hooks', () => ({
  useUIStore: (selector: (s: typeof mockUIState) => unknown) => selector(mockUIState),
}));

vi.mock('../../../store/UIStore', () => {
  const mockSetState = vi.fn();
  return {
    UIStoreContext: React.createContext({ setState: mockSetState, getState: () => mockUIState }),
    __mockSetState: mockSetState,
  };
});

const mockSignIn = vi.fn();
vi.mock('../../../sheets/oauth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
}));

vi.mock('../../../utils/recentSheets', () => ({
  removeRecentSheet: vi.fn(),
}));

import ErrorBanner from '../ErrorBanner';

describe('ErrorBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUIState.syncError = null;
    mockUIState.dataSource = 'sheet';
  });

  it('renders nothing when no syncError', () => {
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for rate_limit', () => {
    mockUIState.syncError = { type: 'rate_limit', message: 'Rate limited', since: Date.now() };
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for header_mismatch', () => {
    mockUIState.syncError = { type: 'header_mismatch', message: 'Mismatch', since: Date.now() };
    const { container } = render(<ErrorBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders auth error with re-authorize link', () => {
    mockUIState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/Session expired/)).toBeTruthy();
    expect(screen.getByTestId('reauth-btn')).toBeTruthy();
  });

  it('auth re-authorize triggers signIn', () => {
    mockUIState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    render(<ErrorBanner />);
    fireEvent.click(screen.getByTestId('reauth-btn'));
    expect(mockSignIn).toHaveBeenCalled();
  });

  it('renders not_found error with Open another sheet', () => {
    mockUIState.syncError = { type: 'not_found', message: 'Not found', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/may have been deleted/)).toBeTruthy();
    expect(screen.getByTestId('open-another-btn')).toBeTruthy();
  });

  it('renders forbidden error with Open another sheet', () => {
    mockUIState.syncError = { type: 'forbidden', message: 'Forbidden', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/may have been deleted/)).toBeTruthy();
    expect(screen.getByTestId('open-another-btn')).toBeTruthy();
  });

  it('renders network error message', () => {
    mockUIState.syncError = { type: 'network', message: 'Offline', since: Date.now() };
    render(<ErrorBanner />);
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it('shows Retry button when dataSource is loading + auth error', () => {
    mockUIState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    mockUIState.dataSource = 'loading';
    render(<ErrorBanner />);
    expect(screen.getByTestId('retry-btn')).toBeTruthy();
  });

  it('shows Retry button when dataSource is loading + not_found error', () => {
    mockUIState.syncError = { type: 'not_found', message: 'Not found', since: Date.now() };
    mockUIState.dataSource = 'loading';
    render(<ErrorBanner />);
    expect(screen.getByTestId('retry-btn')).toBeTruthy();
  });

  it('does NOT show Retry when dataSource is sheet (not loading)', () => {
    mockUIState.syncError = { type: 'auth', message: 'Session expired', since: Date.now() };
    mockUIState.dataSource = 'sheet';
    render(<ErrorBanner />);
    expect(screen.queryByTestId('retry-btn')).toBeNull();
  });

  it('does NOT show Retry for network errors', () => {
    mockUIState.syncError = { type: 'network', message: 'Offline', since: Date.now() };
    mockUIState.dataSource = 'loading';
    render(<ErrorBanner />);
    expect(screen.queryByTestId('retry-btn')).toBeNull();
  });
});
