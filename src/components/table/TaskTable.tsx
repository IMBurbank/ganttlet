import React, { useEffect } from 'react';
import type { Task, ColumnConfig, ColorByField, FakeUser, CollabUser } from '../../types';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import ColumnHeader from './ColumnHeader';
import TaskRow from './TaskRow';

interface TaskTableProps {
  tasks: Task[];
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  users: FakeUser[];
  collabUsers?: CollabUser[];
  isCollabConnected?: boolean;
}

export interface ViewerInfo {
  name: string;
  color: string;
  viewingCellColumn: string | null;
}

export default function TaskTable({ tasks, columns, colorBy, taskMap, users, collabUsers, isCollabConnected }: TaskTableProps) {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const focusNewTaskId = state.focusNewTaskId;

  useEffect(() => {
    if (focusNewTaskId) {
      requestAnimationFrame(() => {
        dispatch({ type: 'CLEAR_FOCUS_NEW_TASK' });
      });
    }
  }, [focusNewTaskId, dispatch]);

  const viewingMap = new Map<string, ViewerInfo>();

  if (isCollabConnected && collabUsers && collabUsers.length > 0) {
    collabUsers.forEach(u => {
      if (u.viewingTaskId) {
        viewingMap.set(u.viewingTaskId, { name: u.name, color: u.color, viewingCellColumn: u.viewingCellColumn });
      }
    });
  } else {
    users.forEach(u => {
      if (u.viewingTaskId && u.isOnline) {
        viewingMap.set(u.viewingTaskId, { name: u.name, color: u.color, viewingCellColumn: u.viewingCellColumn });
      }
    });
  }

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
              autoFocusName={task.id === focusNewTaskId}
            />
          );
        })}
      </div>
    </div>
  );
}
