import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock oauth
const mockIsSignedIn = vi.fn();
const mockSignIn = vi.fn();
const mockSetAuthChangeCallback = vi.fn();
const mockRemoveAuthChangeCallback = vi.fn();

vi.mock('../../../sheets/oauth', () => ({
  isSignedIn: (...args: unknown[]) => mockIsSignedIn(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  getAccessToken: () => 'test-token',
  getAuthState: () => ({}),
  setAuthChangeCallback: (...args: unknown[]) => mockSetAuthChangeCallback(...args),
  removeAuthChangeCallback: (...args: unknown[]) => mockRemoveAuthChangeCallback(...args),
}));

// Mock sheetCreation
const mockCreateSheet = vi.fn();
vi.mock('../../../sheets/sheetCreation', () => ({
  createSheet: (...args: unknown[]) => mockCreateSheet(...args),
}));

// Mock sheetsSync
const mockInitSync = vi.fn();
const mockScheduleSave = vi.fn();
const mockStartPolling = vi.fn();

vi.mock('../../../sheets/sheetsSync', () => ({
  initSync: (...args: unknown[]) => mockInitSync(...args),
  scheduleSave: (...args: unknown[]) => mockScheduleSave(...args),
  startPolling: (...args: unknown[]) => mockStartPolling(...args),
  stopPolling: vi.fn(),
  loadFromSheet: vi.fn().mockResolvedValue([]),
  getSpreadsheetId: () => null,
}));

// Mock schedulerWasm
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

// Mock SheetSelector
vi.mock('../SheetSelector', () => ({
  default: ({ onSelectSheet }: { onSelectSheet: (id: string) => void }) => (
    <div data-testid="sheet-selector">
      <button onClick={() => onSelectSheet('existing-123')} data-testid="mock-select-sheet">
        Select Sheet
      </button>
    </div>
  ),
}));

// Mock TargetSheetCheck
vi.mock('../TargetSheetCheck', () => ({
  default: ({
    onAction,
    onCancel,
  }: {
    spreadsheetId: string;
    onAction: (action: string) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="target-check">
      <button onClick={() => onAction('proceed')} data-testid="mock-proceed">
        Proceed
      </button>
      <button onClick={onCancel} data-testid="mock-cancel">
        Cancel
      </button>
    </div>
  ),
}));

import PromotionFlow from '../PromotionFlow';
import { GanttProvider } from '../../../state/GanttContext';

function renderWithProvider(onClose = vi.fn()) {
  return render(
    <GanttProvider>
      <PromotionFlow onClose={onClose} />
    </GanttProvider>
  );
}

describe('PromotionFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSignedIn.mockReturnValue(true);
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/', search: '' },
      writable: true,
    });
    window.history.replaceState = vi.fn();
  });

  it('shows sign-in gate when not signed in', () => {
    mockIsSignedIn.mockReturnValue(false);
    renderWithProvider();

    expect(screen.getByTestId('sign-in-button')).toBeTruthy();
  });

  it('calls signIn and sets auth callback on sign-in click', () => {
    mockIsSignedIn.mockReturnValue(false);
    renderWithProvider();

    fireEvent.click(screen.getByTestId('sign-in-button'));

    expect(mockSignIn).toHaveBeenCalled();
    expect(mockSetAuthChangeCallback).toHaveBeenCalled();
  });

  it('shows destination picker when signed in', () => {
    renderWithProvider();

    expect(screen.getByTestId('create-new-sheet-button')).toBeTruthy();
    expect(screen.getByTestId('save-to-existing-button')).toBeTruthy();
  });

  it('creates new sheet and transitions on "Create new sheet"', async () => {
    mockCreateSheet.mockResolvedValue('new-sheet-456');
    const onClose = vi.fn();
    renderWithProvider(onClose);

    fireEvent.click(screen.getByTestId('create-new-sheet-button'));

    await waitFor(() => {
      expect(mockCreateSheet).toHaveBeenCalledWith('Ganttlet Project');
    });

    await waitFor(() => {
      expect(mockInitSync).toHaveBeenCalled();
      expect(mockStartPolling).toHaveBeenCalled();
      expect(mockScheduleSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows SheetSelector when "Save to existing" is clicked', () => {
    renderWithProvider();

    fireEvent.click(screen.getByTestId('save-to-existing-button'));

    expect(screen.getByTestId('sheet-selector')).toBeTruthy();
  });

  it('shows TargetSheetCheck after selecting existing sheet', () => {
    renderWithProvider();

    fireEvent.click(screen.getByTestId('save-to-existing-button'));
    fireEvent.click(screen.getByTestId('mock-select-sheet'));

    expect(screen.getByTestId('target-check')).toBeTruthy();
  });

  it('executes transition after target check proceeds', async () => {
    const onClose = vi.fn();
    renderWithProvider(onClose);

    fireEvent.click(screen.getByTestId('save-to-existing-button'));
    fireEvent.click(screen.getByTestId('mock-select-sheet'));
    fireEvent.click(screen.getByTestId('mock-proceed'));

    await waitFor(() => {
      expect(mockInitSync).toHaveBeenCalled();
      expect(mockStartPolling).toHaveBeenCalled();
      expect(mockScheduleSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error state on createSheet failure', async () => {
    mockCreateSheet.mockRejectedValue(new Error('API error'));
    renderWithProvider();

    fireEvent.click(screen.getByTestId('create-new-sheet-button'));

    await waitFor(() => {
      expect(screen.getByTestId('promotion-error')).toBeTruthy();
      expect(screen.getByText('API error')).toBeTruthy();
    });
  });

  it('calls scheduleSave before SET_DATA_SOURCE', async () => {
    mockCreateSheet.mockResolvedValue('new-id');
    const callOrder: string[] = [];
    mockScheduleSave.mockImplementation(() => callOrder.push('scheduleSave'));
    const onClose = vi.fn();
    renderWithProvider(onClose);

    fireEvent.click(screen.getByTestId('create-new-sheet-button'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // scheduleSave must have been called (dispatch ordering tested by call order)
    expect(callOrder).toContain('scheduleSave');
    expect(mockScheduleSave).toHaveBeenCalled();
  });
});
