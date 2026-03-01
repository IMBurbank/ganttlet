import React from 'react';
import type { Task, ZoomLevel, Dependency } from '../../types';
import DependencyArrow from './DependencyArrow';
import { getColumnWidth } from '../../utils/dateUtils';

interface DependencyLayerProps {
  tasks: Task[];
  allTasks: Task[];
  taskYPositions: Map<string, number>;
  timelineStart: Date;
  zoom: ZoomLevel;
  rowHeight: number;
  onArrowClick?: (dep: Dependency, successorId: string) => void;
  criticalPathIds?: Set<string>;
  collapseWeekends?: boolean;
}

export default function DependencyLayer({
  tasks, allTasks, taskYPositions, timelineStart, zoom, rowHeight, onArrowClick, criticalPathIds, collapseWeekends,
}: DependencyLayerProps) {
  const taskMap = new Map(allTasks.map(t => [t.id, t]));
  const colWidth = getColumnWidth(zoom);
  const visibleIds = new Set(tasks.map(t => t.id));

  const arrows: React.ReactNode[] = [];

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      const fromTask = taskMap.get(dep.fromId);
      if (!fromTask || !visibleIds.has(dep.fromId) || !visibleIds.has(dep.toId)) continue;

      const isCritical = criticalPathIds ? criticalPathIds.has(dep.fromId) && criticalPathIds.has(task.id) : false;
      arrows.push(
        <DependencyArrow
          key={`${dep.fromId}-${dep.toId}-${dep.type}`}
          dep={dep}
          fromTask={fromTask}
          toTask={task}
          taskYPositions={taskYPositions}
          timelineStart={timelineStart}
          colWidth={colWidth}
          zoom={zoom}
          rowHeight={rowHeight}
          onClick={onArrowClick ? (d) => onArrowClick(d, task.id) : undefined}
          isCritical={isCritical}
          collapseWeekends={collapseWeekends}
        />
      );
    }
  }

  return <g>{arrows}</g>;
}
