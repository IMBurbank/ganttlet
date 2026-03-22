import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('../../../sheets/sheetCreation', () => ({
  createSheet: vi.fn().mockResolvedValue('mock-sheet-id'),
  createProjectFromTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../sheets/sheetsClient', () => ({
  readSheet: vi.fn().mockResolvedValue([]),
  updateSheet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../sheets/sheetsMapper', () => ({
  SHEET_COLUMNS: ['id', 'name'],
  HEADER_ROW: ['id', 'name'],
  taskToRow: vi.fn(),
  tasksToRows: vi.fn(),
  rowsToTasks: vi.fn(),
  validateHeaders: vi.fn(),
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

  it('renders start from template button', () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    const templateBtn = screen.getByTestId('start-from-template');
    expect(templateBtn).toBeTruthy();
    expect(templateBtn.textContent).toBe('Or start from a template');
  });

  it('dispatches ADD_TASK with name on Enter key', () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    const input = screen.getByTestId('empty-state-task-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My First Task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Input should be cleared after adding
    expect(input.value).toBe('');
  });

  it('does not dispatch ADD_TASK on Enter with empty input', () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    const input = screen.getByTestId('empty-state-task-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    // No crash, input stays empty
    expect(input.value).toBe('');
  });

  it('opens template picker on template button click', async () => {
    render(
      <GanttProvider>
        <EmptyState />
      </GanttProvider>
    );

    fireEvent.click(screen.getByTestId('start-from-template'));
    // TemplatePicker is lazy loaded
    await waitFor(() => {
      expect(screen.getByTestId('template-picker')).toBeTruthy();
    });
  });
});
