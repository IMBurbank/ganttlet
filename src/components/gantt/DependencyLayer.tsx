import React from 'react';
import type { Task, ZoomLevel } from '../../types';
import DependencyArrow from './DependencyArrow';
import { getColumnWidth } from '../../utils/dateUtils';

interface DependencyLayerProps {
  tasks: Task[];
  allTasks: Task[];
  taskYPositions: Map<string, number>;
  timelineStart: Date;
  zoom: ZoomLevel;
  rowHeight: number;
}

export default function DependencyLayer({
  tasks, allTasks, taskYPositions, timelineStart, zoom, rowHeight,
}: DependencyLayerProps) {
  const taskMap = new Map(allTasks.map(t => [t.id, t]));
  const colWidth = getColumnWidth(zoom);
  const visibleIds = new Set(tasks.map(t => t.id));

  const arrows: React.ReactNode[] = [];

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      const fromTask = taskMap.get(dep.fromId);
      if (!fromTask || !visibleIds.has(dep.fromId) || !visibleIds.has(dep.toId)) continue;

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
        />
      );
    }
  }

  return <g>{arrows}</g>;
}
