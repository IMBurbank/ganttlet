import React from 'react';
import type { Task, ColumnConfig, ColorByField, FakeUser } from '../../types';
import ColumnHeader from './ColumnHeader';
import TaskRow from './TaskRow';

interface TaskTableProps {
  tasks: Task[];
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  users: FakeUser[];
}

export default function TaskTable({ tasks, columns, colorBy, taskMap, users }: TaskTableProps) {
  const viewingMap = new Map<string, FakeUser>();
  users.forEach(u => {
    if (u.viewingTaskId && u.isOnline) {
      viewingMap.set(u.viewingTaskId, u);
    }
  });

  const totalWidth = columns.filter(c => c.visible).reduce((sum, c) => sum + c.width, 0);

  return (
    <div className="min-w-0" style={{ width: totalWidth }}>
      <div className="sticky top-0 z-10">
        <ColumnHeader columns={columns} />
      </div>
      <div>
        {tasks.map(task => {
          const viewer = viewingMap.get(task.id);
          return (
            <TaskRow
              key={task.id}
              task={task}
              columns={columns}
              colorBy={colorBy}
              taskMap={taskMap}
              viewer={viewer ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}
