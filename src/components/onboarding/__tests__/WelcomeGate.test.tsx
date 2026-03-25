import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import WelcomeGate from '../WelcomeGate';
import { UIStore, UIStoreContext } from '../../../store/UIStore';
import { TaskStore, TaskStoreContext } from '../../../store/TaskStore';
import { MutateContext } from '../../../hooks/useMutate';

vi.mock('../../../sheets/oauth', () => ({
  isSignedIn: () => false,
  getAccessToken: () => null,
  getAuthState: () => ({}),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../../../utils/recentSheets', () => ({
  getRecentSheets: () => [],
}));

vi.mock('../../../sheets/sheetsBrowser', () => ({
  listUserSheets: vi.fn().mockResolvedValue([]),
}));

const mockMutate = vi.fn();
const uiStore = new UIStore();
const taskStore = new TaskStore();

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <UIStoreContext.Provider value={uiStore}>
      <TaskStoreContext.Provider value={taskStore}>
        <MutateContext.Provider value={mockMutate}>{children}</MutateContext.Provider>
      </TaskStoreContext.Provider>
    </UIStoreContext.Provider>
  );
}

describe('WelcomeGate', () => {
  beforeEach(() => {
    uiStore.setState({ dataSource: undefined, syncError: null });
    Object.defineProperty(window, 'location', {
      value: { search: '', href: 'http://localhost/' },
      writable: true,
    });
  });

  it('renders FirstVisitWelcome when no auth and no URL params', () => {
    render(
      <TestWrapper>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </TestWrapper>
    );

    expect(screen.getByTestId('first-visit-title')).toBeTruthy();
    expect(screen.getByTestId('try-demo-button')).toBeTruthy();
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('loads sandbox data when "Try the demo" is clicked', async () => {
    render(
      <TestWrapper>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('try-demo-button'));

    await waitFor(() => {
      expect(screen.getByTestId('app-content')).toBeTruthy();
    });
  });

  it('renders CollaboratorWelcome when URL has ?sheet= and not signed in', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?sheet=abc123', href: 'http://localhost/?sheet=abc123' },
      writable: true,
    });

    render(
      <TestWrapper>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </TestWrapper>
    );

    expect(screen.getByTestId('collaborator-title')).toBeTruthy();
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('shows sandbox banner when dataSource is sandbox', async () => {
    render(
      <TestWrapper>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </TestWrapper>
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
      <TestWrapper>
        <WelcomeGate>
          <div data-testid="app-content">App Content</div>
        </WelcomeGate>
      </TestWrapper>
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
