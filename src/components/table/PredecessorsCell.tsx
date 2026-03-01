import React from 'react';
import type { Task, Dependency } from '../../types';
import { useGanttDispatch } from '../../state/GanttContext';

interface PredecessorsCellProps {
  task: Task;
  taskMap: Map<string, Task>;
}

function formatDep(dep: Dependency, _taskMap: Map<string, Task>): string {
  let text = dep.fromId;
  // FS is the default — only show the type for non-FS dependencies
  if (dep.type !== 'FS') {
    text += ` ${dep.type}`;
  }
  if (dep.lag !== 0) {
    text += dep.lag > 0 ? `+${dep.lag}` : `${dep.lag}`;
  }
  return text;
}

export default function PredecessorsCell({ task, taskMap }: PredecessorsCellProps) {
  const dispatch = useGanttDispatch();

  if (task.isSummary) {
    return <span className="text-text-muted text-xs">--</span>;
  }

  const handleClick = () => {
    dispatch({ type: 'SET_DEPENDENCY_EDITOR', editor: { taskId: task.id } });
  };

  if (task.dependencies.length === 0) {
    return (
      <button
        onClick={handleClick}
        className="text-text-muted text-xs hover:text-blue-400 transition-colors cursor-pointer"
      >
        + Add
      </button>
    );
  }

  const text = task.dependencies.map(d => formatDep(d, taskMap)).join(', ');

  return (
    <button
      onClick={handleClick}
      className="text-xs text-text-secondary hover:text-blue-400 transition-colors cursor-pointer truncate text-left w-full"
      title={text}
    >
      {text}
    </button>
  );
}
