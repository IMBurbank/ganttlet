import React, { useEffect, useContext, useMemo } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { Task, ColumnConfig, ColorByField, CollabUser } from '../../types';
import { useUIStore } from '../../hooks';
import { UIStoreContext } from '../../store/UIStore';
import ColumnHeader from './ColumnHeader';
import TaskRow from './TaskRow';

interface TaskTableProps {
  tasks: Task[];
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  collabUsers?: CollabUser[];
  isCollabConnected?: boolean;
  awareness?: Awareness | null;
}

export interface ViewerInfo {
  name: string;
  color: string;
  viewingCellColumn: string | null;
}

export default function TaskTable({
  tasks,
  columns,
  colorBy,
  taskMap,
  collabUsers,
  isCollabConnected,
  awareness,
}: TaskTableProps) {
  const focusNewTaskId = useUIStore((s) => s.focusNewTaskId);
  const uiStore = useContext(UIStoreContext)!;

  useEffect(() => {
    if (focusNewTaskId) {
      const timer = setTimeout(() => {
        uiStore.setState({ focusNewTaskId: null });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [focusNewTaskId, uiStore]);

  const viewingMap = useMemo(() => {
    const map = new Map<string, ViewerInfo>();
    if (isCollabConnected && collabUsers && collabUsers.length > 0) {
      collabUsers.forEach((u) => {
        if (u.viewingTaskId) {
          map.set(u.viewingTaskId, {
            name: u.name,
            color: u.color,
            viewingCellColumn: u.viewingCellColumn,
          });
        }
      });
    }
    return map;
  }, [collabUsers, isCollabConnected]);

  const totalWidth = columns.filter((c) => c.visible).reduce((sum, c) => sum + c.width, 0);

  return (
    <div className="min-w-0" style={{ width: totalWidth }}>
      <div className="sticky top-0 z-10">
        <ColumnHeader columns={columns} />
      </div>
      <div>
        {tasks.map((task) => {
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
              awareness={awareness ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}
