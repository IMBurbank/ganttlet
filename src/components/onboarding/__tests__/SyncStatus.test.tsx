import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const mockState = {
  isSyncing: false,
  syncComplete: false,
  syncError: null as import('../../../types').SyncError | null,
};

vi.mock('../../../state/GanttContext', () => ({
  useGanttState: () => mockState,
}));

import SyncStatus from '../SyncStatus';

describe('SyncStatus', () => {
  beforeEach(() => {
    mockState.isSyncing = false;
    mockState.syncComplete = false;
    mockState.syncError = null;
  });

  it('shows "Synced" in idle state', () => {
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toBe('Synced');
  });

  it('shows "Syncing..." when syncing', () => {
    mockState.isSyncing = true;
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toBe('Syncing...');
  });

  it('shows "Synced" when syncComplete', () => {
    mockState.syncComplete = true;
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toBe('Synced');
  });

  it('shows "Sync paused" for rate_limit error', () => {
    mockState.syncError = { type: 'rate_limit', message: 'Rate limited', since: Date.now() };
    render(<SyncStatus />);
    expect(screen.getByTestId('sync-status').textContent).toContain('Sync paused');
    expect(screen.getByTestId('sync-status').textContent).toContain('retrying automatically');
  });
});
