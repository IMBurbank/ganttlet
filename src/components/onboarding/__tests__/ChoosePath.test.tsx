import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ChoosePath from '../ChoosePath';
import { UIStore, UIStoreContext } from '../../../store/UIStore';
import { TaskStore, TaskStoreContext } from '../../../store/TaskStore';
import { MutateContext } from '../../../hooks/useMutate';

vi.mock('../../../sheets/oauth', () => ({
  isSignedIn: () => true,
  getAccessToken: () => 'test-token',
  getAuthState: () => ({ userName: 'Test User' }),
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

describe('ChoosePath', () => {
  const mockOnSelectSheet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and action buttons', () => {
    render(
      <TestWrapper>
        <ChoosePath onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    expect(screen.getByTestId('choose-path-title')).toBeTruthy();
    expect(screen.getByTestId('new-project-button')).toBeTruthy();
    expect(screen.getByTestId('existing-sheet-button')).toBeTruthy();
    expect(screen.getByTestId('demo-button')).toBeTruthy();
  });

  it('opens SheetSelector when Existing Sheet is clicked', () => {
    render(
      <TestWrapper>
        <ChoosePath onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('existing-sheet-button'));
    expect(screen.getByTestId('sheet-selector-modal')).toBeTruthy();
  });

  it('does not show recent projects when empty', () => {
    render(
      <TestWrapper>
        <ChoosePath onSelectSheet={mockOnSelectSheet} />
      </TestWrapper>
    );

    expect(screen.queryByTestId('recent-projects')).toBeNull();
  });
});
