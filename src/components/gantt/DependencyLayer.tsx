import React, { useMemo } from 'react';
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
  criticalEdges?: Array<{ fromId: string; toId: string }>;
  collapseWeekends?: boolean;
}

export default function DependencyLayer({
  tasks, allTasks, taskYPositions, timelineStart, zoom, rowHeight, onArrowClick, criticalPathIds, criticalEdges, collapseWeekends,
}: DependencyLayerProps) {
  const taskMap = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);
  const colWidth = getColumnWidth(zoom);
  const visibleIds = useMemo(() => new Set(tasks.map(t => t.id)), [tasks]);

  // Build a set of critical edge keys for O(1) lookup
  const criticalEdgeSet = useMemo(() => new Set(
    (criticalEdges ?? []).map(e => `${e.fromId}->${e.toId}`)
  ), [criticalEdges]);

  const arrows = useMemo(() => {
    const result: React.ReactNode[] = [];
    for (const task of tasks) {
      // Guard: skip tasks without a Y position entry
      if (!taskYPositions.has(task.id)) continue;

      for (const dep of task.dependencies) {
        const fromTask = taskMap.get(dep.fromId);
        // Guard: skip if from-task missing, not visible, or no Y position
        if (!fromTask || !visibleIds.has(dep.fromId) || !visibleIds.has(dep.toId)) continue;
        if (!taskYPositions.has(dep.fromId) || !taskYPositions.has(dep.toId)) continue;

        const isCritical = criticalEdgeSet.size > 0
          ? criticalEdgeSet.has(`${dep.fromId}->${dep.toId}`)
          : (criticalPathIds ? criticalPathIds.has(dep.fromId) && criticalPathIds.has(task.id) : false);
        result.push(
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
    return result;
  }, [tasks, taskMap, taskYPositions, visibleIds, criticalEdgeSet, criticalPathIds, timelineStart, colWidth, zoom, rowHeight, onArrowClick, collapseWeekends]);

  return <g>{arrows}</g>;
}
