import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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
import { UIStore, UIStoreContext } from '../../../store/UIStore';

const uiStore = new UIStore();

function renderWithProvider(onClose = vi.fn()) {
  return render(
    <UIStoreContext.Provider value={uiStore}>
      <PromotionFlow onClose={onClose} />
    </UIStoreContext.Provider>
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
      expect(window.location.href).toContain('sheet=new-sheet-456');
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
      expect(window.location.href).toContain('sheet=existing-123');
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
});
