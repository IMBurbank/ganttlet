import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUIState = {
  isSyncing: false,
  syncComplete: false,
  syncError: null as import('../../../types').SyncError | null,
};

vi.mock('../../../hooks', () => ({
  useUIStore: (selector: (s: typeof mockUIState) => unknown) => selector(mockUIState),
}));

import SyncStatus from '../SyncStatus';

describe('SyncStatus', () => {
  beforeEach(() => {
    mockUIState.isSyncing = false;
    mockUIState.syncComplete = false;
    mockUIState.syncError = null;
  });

  it('shows "Synced" in idle state', () => {
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toBe('Synced');
  });

  it('shows "Syncing..." when syncing', () => {
    mockUIState.isSyncing = true;
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toBe('Syncing...');
  });

  it('shows "Synced" when syncComplete', () => {
    mockUIState.syncComplete = true;
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toBe('Synced');
  });

  it('shows "Sync paused" for rate_limit error', () => {
    mockUIState.syncError = { type: 'rate_limit', message: 'Rate limited', since: Date.now() };
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toContain('Sync paused');
    expect(screen.getByTestId('sync-status').textContent).toContain('retrying automatically');
  });
});
