import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../Header';

const { mockDispatch, mockStopPolling } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockStopPolling: vi.fn(),
}));

vi.mock('../../../state/GanttContext', () => ({
  useGanttState: () => ({
    isHistoryPanelOpen: false,
    theme: 'dark',
    dataSource: 'sheet',
  }),
  useGanttDispatch: () => mockDispatch,
}));

vi.mock('../../../utils/schedulerWasm', () => ({
  cascadeDependents: (tasks: unknown[]) => tasks,
  recalculateEarliest: () => [],
  initScheduler: () => Promise.resolve(),
}));

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

vi.mock('../../../sheets/sheetsSync', () => ({
  initSync: vi.fn(),
  loadFromSheet: vi.fn().mockResolvedValue([]),
  scheduleSave: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: mockStopPolling,
  getSpreadsheetId: () => null,
}));

vi.mock('../../../sheets/oauth', () => ({
  initOAuth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  isSignedIn: () => true,
  getAccessToken: () => 'mock-token',
  getAuthState: () => ({
    accessToken: 'mock-token',
    userName: 'Test User',
    userEmail: 'test@test.com',
    userPicture: null,
  }),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
}));

function setupSheetUrl() {
  const url = new URL('http://localhost?sheet=abc123&room=abc123');
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      href: url.toString(),
      search: url.search,
      origin: url.origin,
    },
    writable: true,
    configurable: true,
  });

  // Mock fetch for sheet title
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ properties: { title: 'My Project' } }),
  }) as unknown as typeof fetch;
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSheetUrl();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  it('renders share button with toast on click', async () => {
    render(<Header />);

    const shareBtn = screen.getByTestId('share-button');
    expect(shareBtn).toBeTruthy();

    fireEvent.click(shareBtn);
    await waitFor(() => {
      expect(screen.getByTestId('share-toast')).toBeTruthy();
    });
    expect(screen.getByTestId('share-toast').textContent).toContain(
      'Anyone with access to the Google Sheet can collaborate'
    );
  });

  it('shows sheet dropdown menu when connected', () => {
    render(<Header />);

    const trigger = screen.getByTestId('sheet-dropdown-trigger');
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.getByTestId('sheet-dropdown-menu')).toBeTruthy();
    expect(screen.getByTestId('menu-open-sheets')).toBeTruthy();
    expect(screen.getByTestId('menu-switch-sheet')).toBeTruthy();
    expect(screen.getByTestId('menu-create-new')).toBeTruthy();
    expect(screen.getByTestId('menu-disconnect')).toBeTruthy();
  });

  it('shows disconnect confirmation dialog', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('sheet-dropdown-trigger'));
    fireEvent.click(screen.getByTestId('menu-disconnect'));

    expect(screen.getByTestId('disconnect-confirm')).toBeTruthy();
    expect(screen.getByTestId('disconnect-cancel')).toBeTruthy();
    expect(screen.getByTestId('disconnect-confirm-btn')).toBeTruthy();
  });

  it('disconnect dispatches RESET_STATE', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('sheet-dropdown-trigger'));
    fireEvent.click(screen.getByTestId('menu-disconnect'));
    fireEvent.click(screen.getByTestId('disconnect-confirm-btn'));

    expect(mockStopPolling).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'RESET_STATE' });
  });

  it('switch sheet tears down current connection', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('sheet-dropdown-trigger'));
    fireEvent.click(screen.getByTestId('menu-switch-sheet'));

    expect(mockStopPolling).toHaveBeenCalled();
  });

  it('fetches and displays sheet title', async () => {
    render(<Header />);

    await waitFor(() => {
      expect(screen.getByTestId('sheet-title')).toBeTruthy();
    });
    expect(screen.getByTestId('sheet-title').textContent).toBe('My Project');
  });
});
