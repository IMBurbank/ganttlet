import React, { useMemo } from 'react';
import type { Task, ZoomLevel, Dependency } from '../../types';
import DependencyArrow from './DependencyArrow';
import { getColumnWidth, dateToX } from '../../utils/dateUtils';

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
  /** When virtualized, only render arrows where at least one endpoint is in this set */
  virtualVisibleIds?: Set<string>;
}

export default function DependencyLayer({
  tasks,
  allTasks,
  taskYPositions,
  timelineStart,
  zoom,
  rowHeight,
  onArrowClick,
  criticalPathIds,
  criticalEdges,
  collapseWeekends,
  virtualVisibleIds,
}: DependencyLayerProps) {
  const taskMap = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);
  const colWidth = getColumnWidth(zoom);
  const visibleIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);

  // Build a set of critical edge keys for O(1) lookup
  const criticalEdgeSet = useMemo(
    () => new Set((criticalEdges ?? []).map((e) => `${e.fromId}->${e.toId}`)),
    [criticalEdges]
  );

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

        // Virtualization: skip arrows where BOTH endpoints are off-screen
        if (
          virtualVisibleIds &&
          !virtualVisibleIds.has(dep.fromId) &&
          !virtualVisibleIds.has(dep.toId)
        )
          continue;

        const isCritical =
          criticalEdgeSet.size > 0
            ? criticalEdgeSet.has(`${dep.fromId}->${dep.toId}`)
            : criticalPathIds
              ? criticalPathIds.has(dep.fromId) && criticalPathIds.has(task.id)
              : false;

        // Determine if one endpoint is off-screen (for truncation indicator)
        const fromOffScreen = virtualVisibleIds ? !virtualVisibleIds.has(dep.fromId) : false;
        const toOffScreen = virtualVisibleIds ? !virtualVisibleIds.has(dep.toId) : false;
        const hasOffScreenEndpoint = fromOffScreen || toOffScreen;

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

        // Add truncation indicator triangle for arrows with one off-screen endpoint
        if (hasOffScreenEndpoint) {
          const offScreenId = fromOffScreen ? dep.fromId : dep.toId;
          const offY = taskYPositions.get(offScreenId);
          const onScreenId = fromOffScreen ? dep.toId : dep.fromId;
          const onScreenTask = taskMap.get(onScreenId);
          if (offY !== undefined && onScreenTask) {
            // Place indicator at the off-screen task's Y, clamped to make it visible near edge
            const indicatorY = offY + rowHeight / 2;
            const indicatorX = dateToX(
              fromOffScreen ? fromTask.endDate : task.startDate,
              timelineStart,
              colWidth,
              zoom,
              collapseWeekends
            );
            const strokeColor = isCritical ? '#ef4444' : 'var(--raw-dep-arrow)';
            result.push(
              <polygon
                key={`trunc-${dep.fromId}-${dep.toId}`}
                points={`${indicatorX - 4},${indicatorY - 4} ${indicatorX + 4},${indicatorY} ${indicatorX - 4},${indicatorY + 4}`}
                fill={strokeColor}
                opacity={0.6}
              />
            );
          }
        }
      }
    }
    return result;
  }, [
    tasks,
    taskMap,
    taskYPositions,
    visibleIds,
    criticalEdgeSet,
    criticalPathIds,
    timelineStart,
    colWidth,
    zoom,
    rowHeight,
    onArrowClick,
    collapseWeekends,
    virtualVisibleIds,
  ]);

  return <g>{arrows}</g>;
}
