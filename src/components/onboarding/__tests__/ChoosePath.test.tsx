import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChoosePath from '../ChoosePath';
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
  isSignedIn: () => true,
  getAccessToken: () => 'test-token',
  getAuthState: () => ({ userName: 'Test User' }),
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

vi.mock('../../../utils/recentSheets', () => ({
  getRecentSheets: () => [],
}));

vi.mock('../../../sheets/sheetsBrowser', () => ({
  listUserSheets: vi.fn().mockResolvedValue([]),
}));

describe('ChoosePath', () => {
  const mockOnSelectSheet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and action buttons', () => {
    render(
      <GanttProvider>
        <ChoosePath onSelectSheet={mockOnSelectSheet} />
      </GanttProvider>
    );

    expect(screen.getByTestId('choose-path-title')).toBeTruthy();
    expect(screen.getByTestId('new-project-button')).toBeTruthy();
    expect(screen.getByTestId('existing-sheet-button')).toBeTruthy();
    expect(screen.getByTestId('demo-button')).toBeTruthy();
  });

  it('opens SheetSelector when Existing Sheet is clicked', () => {
    render(
      <GanttProvider>
        <ChoosePath onSelectSheet={mockOnSelectSheet} />
      </GanttProvider>
    );

    fireEvent.click(screen.getByTestId('existing-sheet-button'));
    expect(screen.getByTestId('sheet-selector-modal')).toBeTruthy();
  });

  it('does not show recent projects when empty', () => {
    render(
      <GanttProvider>
        <ChoosePath onSelectSheet={mockOnSelectSheet} />
      </GanttProvider>
    );

    expect(screen.queryByTestId('recent-projects')).toBeNull();
  });
});
