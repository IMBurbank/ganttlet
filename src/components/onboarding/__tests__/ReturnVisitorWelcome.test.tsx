import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ReturnVisitorWelcome from '../ReturnVisitorWelcome';
import { UIStore, UIStoreContext } from '../../../store/UIStore';
import { TaskStore, TaskStoreContext } from '../../../store/TaskStore';
import { MutateContext } from '../../../hooks/useMutate';

vi.mock('../../../sheets/oauth', () => ({
  isSignedIn: () => true,
  getAccessToken: () => 'test-token',
  getAuthState: () => ({ userName: 'Test User', userEmail: 'test@example.com' }),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../../../utils/recentSheets', () => ({
  getRecentSheets: () => [
    { sheetId: 'sheet-1', title: 'Project Alpha', lastOpened: Date.now() - 3600000 },
    { sheetId: 'sheet-2', title: 'Project Beta', lastOpened: Date.now() - 86400000 },
  ],
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

describe('ReturnVisitorWelcome', () => {
  const mockOnSelectSheet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders welcome back message with user name', () => {
    render(
      <TestWrapper>
        <ReturnVisitorWelcome onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    expect(screen.getByTestId('return-visitor-title').textContent).toContain(
      'Welcome back, Test User'
    );
  });

  it('lists recent projects', () => {
    render(
      <TestWrapper>
        <ReturnVisitorWelcome onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    expect(screen.getByTestId('recent-projects')).toBeTruthy();
    expect(screen.getByTestId('recent-sheet-sheet-1')).toBeTruthy();
    expect(screen.getByTestId('recent-sheet-sheet-2')).toBeTruthy();
  });

  it('calls onSelectSheet when clicking a recent project', () => {
    render(
      <TestWrapper>
        <ReturnVisitorWelcome onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('recent-sheet-sheet-1'));
    expect(mockOnSelectSheet).toHaveBeenCalledWith('sheet-1');
  });

  it('opens SheetSelector modal when Connect Existing Sheet is clicked', () => {
    render(
      <TestWrapper>
        <ReturnVisitorWelcome onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('connect-existing-button'));
    expect(screen.getByTestId('sheet-selector-modal')).toBeTruthy();
  });

  it('shows action buttons', () => {
    render(
      <TestWrapper>
        <ReturnVisitorWelcome onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    expect(screen.getByTestId('new-project-button')).toBeTruthy();
    expect(screen.getByTestId('connect-existing-button')).toBeTruthy();
    expect(screen.getByTestId('demo-button')).toBeTruthy();
  });
});
