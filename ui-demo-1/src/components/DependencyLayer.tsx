import React, { useMemo } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import type { Task, Dependency } from '../types';

interface DependencyLayerProps {
  visibleTasks: Task[];
  dependencies: Dependency[];
  projectStart: Date;
  dayWidth: number;
  scrollX: number;
  rowHeight: number;
}

const ARROW_MARKER_ID = 'dependency-arrowhead';
const ARROW_MARKER_CRITICAL_ID = 'dependency-arrowhead-critical';
const BEND_RADIUS = 5;

function getTaskX(
  task: Task,
  edge: 'left' | 'right',
  projectStart: Date,
  dayWidth: number,
  scrollX: number
): number {
  const startX =
    differenceInCalendarDays(task.startDate, projectStart) * dayWidth - scrollX;
  const endX =
    differenceInCalendarDays(task.endDate, projectStart) * dayWidth - scrollX;
  return edge === 'left' ? startX : endX;
}

function getTaskY(
  taskIndex: number,
  rowHeight: number
): number {
  return taskIndex * rowHeight + rowHeight / 2;
}

/**
 * Build an elbow-routed SVG path between two points with rounded corners.
 */
function buildElbowPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fromEdge: 'left' | 'right',
  toEdge: 'left' | 'right'
): string {
  const offset = 12; // horizontal offset from bar edges
  const r = BEND_RADIUS;

  // Calculate intermediate x positions
  const exitX = fromEdge === 'right' ? fromX + offset : fromX - offset;
  const entryX = toEdge === 'left' ? toX - offset : toX + offset;

  const midX = (exitX + entryX) / 2;
  const dy = toY - fromY;

  if (Math.abs(dy) < 1) {
    // Same row - straight horizontal line
    return `M ${fromX},${fromY} L ${toX},${toY}`;
  }

  // Elbow path with rounded corners
  // From source -> horizontal offset -> vertical -> horizontal to target
  const dirY = dy > 0 ? 1 : -1;
  const absR = Math.min(r, Math.abs(dy) / 2);

  return [
    `M ${fromX},${fromY}`,
    // Horizontal to mid point
    `L ${midX - absR},${fromY}`,
    // Rounded corner down/up
    `Q ${midX},${fromY} ${midX},${fromY + dirY * absR}`,
    // Vertical segment
    `L ${midX},${toY - dirY * absR}`,
    // Rounded corner to horizontal
    `Q ${midX},${toY} ${midX + absR},${toY}`,
    // Horizontal to target
    `L ${toX},${toY}`,
  ].join(' ');
}

export const DependencyLayer: React.FC<DependencyLayerProps> = ({
  visibleTasks,
  dependencies,
  projectStart,
  dayWidth,
  scrollX,
  rowHeight,
}) => {
  const taskIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleTasks.forEach((task, index) => {
      map.set(task.id, index);
    });
    return map;
  }, [visibleTasks]);

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    visibleTasks.forEach((task) => {
      map.set(task.id, task);
    });
    return map;
  }, [visibleTasks]);

  const paths = useMemo(() => {
    return dependencies
      .map((dep) => {
        const pred = taskMap.get(dep.predecessorId);
        const succ = taskMap.get(dep.successorId);
        const predIndex = taskIndexMap.get(dep.predecessorId);
        const succIndex = taskIndexMap.get(dep.successorId);

        if (!pred || !succ || predIndex === undefined || succIndex === undefined) {
          return null;
        }

        // Determine edges based on dependency type
        let fromEdge: 'left' | 'right';
        let toEdge: 'left' | 'right';

        switch (dep.type) {
          case 'FS':
            fromEdge = 'right';
            toEdge = 'left';
            break;
          case 'SS':
            fromEdge = 'left';
            toEdge = 'left';
            break;
          case 'FF':
            fromEdge = 'right';
            toEdge = 'right';
            break;
          case 'SF':
            fromEdge = 'left';
            toEdge = 'right';
            break;
        }

        const fromX = getTaskX(pred, fromEdge, projectStart, dayWidth, scrollX);
        const fromY = getTaskY(predIndex, rowHeight);
        const toX = getTaskX(succ, toEdge, projectStart, dayWidth, scrollX);
        const toY = getTaskY(succIndex, rowHeight);

        const isCritical = pred.isCritical && succ.isCritical;
        const pathD = buildElbowPath(fromX, fromY, toX, toY, fromEdge, toEdge);

        return {
          key: dep.id,
          d: pathD,
          isCritical,
        };
      })
      .filter(Boolean) as { key: string; d: string; isCritical: boolean }[];
  }, [dependencies, taskMap, taskIndexMap, projectStart, dayWidth, scrollX, rowHeight]);

  return (
    <g className="dependency-layer">
      {/* Arrow marker definitions */}
      <defs>
        <marker
          id={ARROW_MARKER_ID}
          viewBox="0 0 10 10"
          refX={10}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0,0 L 10,5 L 0,10 Z" fill="#52525b" />
        </marker>
        <marker
          id={ARROW_MARKER_CRITICAL_ID}
          viewBox="0 0 10 10"
          refX={10}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0,0 L 10,5 L 0,10 Z" fill="#ef4444" />
        </marker>
      </defs>

      {/* Dependency paths */}
      {paths.map(({ key, d, isCritical }) => (
        <path
          key={key}
          d={d}
          fill="none"
          stroke={isCritical ? '#ef4444' : '#52525b'}
          strokeWidth={1.5}
          markerEnd={`url(#${isCritical ? ARROW_MARKER_CRITICAL_ID : ARROW_MARKER_ID})`}
          pointerEvents="none"
        />
      ))}
    </g>
  );
};
