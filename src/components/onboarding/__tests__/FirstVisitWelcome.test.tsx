import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import FirstVisitWelcome from '../FirstVisitWelcome';
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

describe('FirstVisitWelcome', () => {
  const mockOnSignInComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and action buttons', () => {
    render(
      <TestWrapper>
        <FirstVisitWelcome onSignInComplete={mockOnSignInComplete} />
      </TestWrapper>
    );

    expect(screen.getByTestId('first-visit-title')).toBeTruthy();
    expect(screen.getByTestId('try-demo-button')).toBeTruthy();
    expect(screen.getByTestId('sign-in-button')).toBeTruthy();
  });

  it('calls mutate when Try the demo is clicked', async () => {
    render(
      <TestWrapper>
        <FirstVisitWelcome onSignInComplete={mockOnSignInComplete} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('try-demo-button'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  it('calls signIn and onSignInComplete when Sign in is clicked', async () => {
    const oauth = await import('../../../sheets/oauth');
    render(
      <TestWrapper>
        <FirstVisitWelcome onSignInComplete={mockOnSignInComplete} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('sign-in-button'));

    expect(oauth.signIn).toHaveBeenCalled();
    expect(mockOnSignInComplete).toHaveBeenCalled();
  });
});
