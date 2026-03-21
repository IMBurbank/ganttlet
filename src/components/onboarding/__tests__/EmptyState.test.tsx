import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '../EmptyState';
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
}));

vi.mock('../../../sheets/sheetsSync', () => ({
  initSync: vi.fn(),
  loadFromSheet: vi.fn().mockResolvedValue([]),
  scheduleSave: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getSpreadsheetId: () => null,
}));

describe('EmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state with timeline scaffolding', () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('empty-state-timeline')).toBeTruthy();
    expect(screen.getByTestId('today-marker')).toBeTruthy();
  });

  it('renders add task input', () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    const input = screen.getByTestId('empty-state-task-input');
    expect(input).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBe('Enter task name...');
  });

  it('renders CTA text', () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    expect(screen.getByTestId('empty-state-cta').textContent).toBe('Add your first task');
  });

  it('accepts onSelectTemplate prop', () => {
    const mockTemplate = vi.fn();
    // Should render without error
    render(
      <GanttProvider>
        <EmptyState onSelectTemplate={mockTemplate} />
      </GanttProvider>
    );

    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });
});
