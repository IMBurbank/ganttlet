import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { CollabUser, Task, ColumnConfig, ColorByField } from '../../../types';
import TaskTable from '../TaskTable';

// Mock child components to isolate TaskTable logic
vi.mock('../TaskRow', () => ({
  default: vi.fn(
    ({ task, viewers, awareness }: { task: Task; viewers: unknown; awareness: unknown }) => (
      <div
        data-testid={`row-${task.id}`}
        data-viewers={JSON.stringify(viewers)}
        data-has-awareness={!!awareness}
      />
    )
  ),
}));

vi.mock('../ColumnHeader', () => ({
  default: () => <div data-testid="column-header" />,
}));

// Mock hooks
vi.mock('../../../hooks', () => ({
  useUIStore: () => null,
}));

vi.mock('../../../store/UIStore', () => ({
  UIStoreContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const defaultColumns: ColumnConfig[] = [{ key: 'name', label: 'Name', width: 200, visible: true }];

function makeTask(id: string, name = 'Task'): Task {
  return {
    id,
    name,
    startDate: '2026-03-02',
    endDate: '2026-03-06',
    duration: 5,
    owner: '',
    workStream: '',
    project: '',
    functionalArea: '',
    done: false,
    description: '',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: [],
    dependencies: [],
    notes: '',
    okrs: [],
  };
}

describe('TaskTable', () => {
  it('builds viewingMap with multiple viewers per task', () => {
    const tasks = [makeTask('t1')];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const collabUsers: CollabUser[] = [
      {
        clientId: 1,
        name: 'Alice',
        email: 'a@x.com',
        color: '#f00',
        viewingTaskId: 't1',
        dragging: null,
      },
      {
        clientId: 2,
        name: 'Bob',
        email: 'b@x.com',
        color: '#0f0',
        viewingTaskId: 't1',
        dragging: null,
      },
    ];

    const { getByTestId } = render(
      <TaskTable
        tasks={tasks}
        columns={defaultColumns}
        colorBy={'owner' as ColorByField}
        taskMap={taskMap}
        collabUsers={collabUsers}
        isCollabConnected={true}
        awareness={null}
      />
    );

    const row = getByTestId('row-t1');
    const viewers = JSON.parse(row.getAttribute('data-viewers') || '[]');
    expect(viewers).toHaveLength(2);
    expect(viewers[0].name).toBe('Alice');
    expect(viewers[1].name).toBe('Bob');
  });

  it('passes awareness prop to TaskRow', () => {
    const tasks = [makeTask('t1')];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const mockAwareness = {} as never; // non-null sentinel

    const { getByTestId } = render(
      <TaskTable
        tasks={tasks}
        columns={defaultColumns}
        colorBy={'owner' as ColorByField}
        taskMap={taskMap}
        awareness={mockAwareness}
      />
    );

    const row = getByTestId('row-t1');
    expect(row.getAttribute('data-has-awareness')).toBe('true');
  });

  it('viewers is null when no collab users are viewing', () => {
    const tasks = [makeTask('t1')];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const { getByTestId } = render(
      <TaskTable
        tasks={tasks}
        columns={defaultColumns}
        colorBy={'owner' as ColorByField}
        taskMap={taskMap}
        collabUsers={[]}
        isCollabConnected={true}
      />
    );

    const row = getByTestId('row-t1');
    expect(row.getAttribute('data-viewers')).toBe('null');
  });
});
