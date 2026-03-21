import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import WelcomeGate from '../WelcomeGate';
import { GanttProvider } from '../../../state/GanttContext';

// Mock schedulerWasm to avoid WASM loading in tests
vi.mock('../../../utils/schedulerWasm', () => ({
  cascadeDependents: (tasks: unknown[]) => tasks,
  recalculateEarliest: () => [],
  initScheduler: () => Promise.resolve(),
}));

// Mock collab modules
vi.mock('../../../collab/yjsProvider', () => ({
  connectCollab: vi.fn(),
  disconnectCollab: vi.fn(),
  getDoc: () => null,
}));

vi.mock('../../../collab/yjsBinding', () => ({
  bindYjsToDispatch: vi.fn(),
  applyTasksToYjs: vi.fn(),
  applyActionToYjs: vi.fn(),
  hydrateYjsFromTasks: vi.fn(),
}));

vi.mock('../../../collab/awareness', () => ({
  setLocalAwareness: vi.fn(),
  updateViewingTask: vi.fn(),
  getCollabUsers: () => [],
}));

vi.mock('../../../sheets/oauth', () => ({
  isSignedIn: () => false,
  getAccessToken: () => null,
  getAuthState: () => ({}),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
}));

vi.mock('../../../sheets/sheetsSync', () => ({
  initSync: vi.fn(),
  loadFromSheet: vi.fn().mockResolvedValue([]),
  scheduleSave: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getSpreadsheetId: () => null,
}));

describe('WelcomeGate', () => {
  beforeEach(() => {
    // Reset URL to no params
    Object.defineProperty(window, 'location', {
      value: { search: '', href: '' },
      writable: true,
    });
  });

  it('renders welcome screen when no dataSource and no URL params', () => {
    render(
      <GanttProvider>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </GanttProvider>
    );

    expect(screen.getByText('Welcome to Ganttlet')).toBeTruthy();
    expect(screen.getByText('Try the demo')).toBeTruthy();
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('loads sandbox data when "Try the demo" is clicked', async () => {
    render(
      <GanttProvider>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </GanttProvider>
    );

    fireEvent.click(screen.getByText('Try the demo'));

    await waitFor(() => {
      expect(screen.getByTestId('app-content')).toBeTruthy();
    });
  });

  it('shows sandbox banner when dataSource is sandbox', async () => {
    render(
      <GanttProvider>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </GanttProvider>
    );

    // Enter sandbox mode
    fireEvent.click(screen.getByText('Try the demo'));

    await waitFor(() => {
      expect(screen.getByTestId('sandbox-banner')).toBeTruthy();
    });

    expect(screen.getByText(/demo project/)).toBeTruthy();
    expect(screen.getByTestId('save-to-sheet-button')).toBeTruthy();
  });

  it('opens PromotionFlow when "Save to Google Sheet" is clicked', async () => {
    render(
      <GanttProvider>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </GanttProvider>
    );

    fireEvent.click(screen.getByText('Try the demo'));

    await waitFor(() => {
      expect(screen.getByTestId('save-to-sheet-button')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('save-to-sheet-button'));

    await waitFor(() => {
      expect(screen.getByTestId('promotion-modal')).toBeTruthy();
    });
  });
});
