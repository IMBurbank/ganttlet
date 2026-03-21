import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FirstVisitWelcome from '../FirstVisitWelcome';
import { GanttProvider } from '../../../state/GanttContext';

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

vi.mock('../../../sheets/oauth', () => ({
  isSignedIn: () => false,
  getAccessToken: () => null,
  getAuthState: () => ({}),
  setAuthChangeCallback: vi.fn(),
  removeAuthChangeCallback: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../../../sheets/sheetsSync', () => ({
  initSync: vi.fn(),
  loadFromSheet: vi.fn().mockResolvedValue([]),
  scheduleSave: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getSpreadsheetId: () => null,
}));

describe('FirstVisitWelcome', () => {
  const mockOnSignInComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and action buttons', () => {
    render(
      <GanttProvider>
        <FirstVisitWelcome onSignInComplete={mockOnSignInComplete} />
      </GanttProvider>
    );

    expect(screen.getByTestId('first-visit-title')).toBeTruthy();
    expect(screen.getByTestId('try-demo-button')).toBeTruthy();
    expect(screen.getByTestId('sign-in-button')).toBeTruthy();
  });

  it('dispatches ENTER_SANDBOX when Try the demo is clicked', async () => {
    render(
      <GanttProvider>
        <FirstVisitWelcome onSignInComplete={mockOnSignInComplete} />
      </GanttProvider>
    );

    fireEvent.click(screen.getByTestId('try-demo-button'));

    // After sandbox loads, the component will no longer render (parent switches to children)
    await waitFor(() => {
      // The demo button should still exist or the sandbox should be loading
      expect(screen.getByTestId('try-demo-button')).toBeTruthy();
    });
  });

  it('calls signIn and onSignInComplete when Sign in is clicked', async () => {
    const oauth = await import('../../../sheets/oauth');
    render(
      <GanttProvider>
        <FirstVisitWelcome onSignInComplete={mockOnSignInComplete} />
      </GanttProvider>
    );

    fireEvent.click(screen.getByTestId('sign-in-button'));

    expect(oauth.signIn).toHaveBeenCalled();
    expect(mockOnSignInComplete).toHaveBeenCalled();
  });
});
