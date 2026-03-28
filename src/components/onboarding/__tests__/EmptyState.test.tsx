import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import EmptyState from '../EmptyState';
import { UIStore, UIStoreContext } from '../../../store/UIStore';
import { TaskStore, TaskStoreContext } from '../../../store/TaskStore';
import { MutateContext } from '../../../hooks/useMutate';

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

describe('EmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state with timeline scaffolding', () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('empty-state-timeline')).toBeTruthy();
    expect(screen.getByTestId('today-marker')).toBeTruthy();
  });

  it('renders add task input', () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    const input = screen.getByTestId('empty-state-task-input');
    expect(input).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBe('Enter task name...');
  });

  it('renders CTA text', () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    expect(screen.getByTestId('empty-state-cta').textContent).toBe('Add your first task');
  });

  it('accepts onSelectTemplate prop', () => {
    const mockTemplate = vi.fn();
    render(
      <TestWrapper>
        <EmptyState onSelectTemplate={mockTemplate} />
      </TestWrapper>
    );

    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('renders start from template button', () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    const templateBtn = screen.getByTestId('start-from-template');
    expect(templateBtn).toBeTruthy();
    expect(templateBtn.textContent).toBe('Or start from a template');
  });

  it('calls mutate with ADD_TASK on Enter key', () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    const input = screen.getByTestId('empty-state-task-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My First Task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockMutate).toHaveBeenCalledWith({ type: 'ADD_TASK', task: { name: 'My First Task' } });
    expect(input.value).toBe('');
  });

  it('does not call mutate on Enter with empty input', () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    const input = screen.getByTestId('empty-state-task-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('opens template picker on template button click', async () => {
    render(
      <TestWrapper>
        <EmptyState />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('start-from-template'));
    await waitFor(() => {
      expect(screen.getByTestId('template-picker')).toBeTruthy();
    });
  });
});
