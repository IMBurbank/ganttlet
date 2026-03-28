import type { Dependency, Task, ZoomLevel } from '../../types';
import {
  getDependencyPoints,
  createBezierPath,
  createArrowHead,
} from '../../utils/dependencyUtils';

interface DependencyArrowProps {
  dep: Dependency;
  fromTask: Task;
  toTask: Task;
  taskYPositions: Map<string, number>;
  timelineStart: Date;
  colWidth: number;
  zoom: ZoomLevel;
  rowHeight: number;
  onClick?: (dep: Dependency) => void;
  isCritical?: boolean;
  collapseWeekends?: boolean;
}

export default function DependencyArrow({
  dep,
  fromTask,
  toTask,
  taskYPositions,
  timelineStart,
  colWidth,
  zoom,
  rowHeight,
  onClick,
  isCritical,
  collapseWeekends,
}: DependencyArrowProps) {
  const points = getDependencyPoints(
    dep,
    fromTask,
    toTask,
    taskYPositions,
    timelineStart,
    colWidth,
    zoom,
    rowHeight,
    collapseWeekends
  );
  if (!points) return null;

  const path = createBezierPath(points.start, points.end, dep.type);
  const arrowHead = createArrowHead(points.end, dep.type);

  const strokeColor = isCritical ? '#ef4444' : 'var(--raw-dep-arrow)';
  const strokeW = isCritical ? 2.5 : 1.5;

  return (
    <g
      className="dependency-arrow"
      data-testid="dependency-arrow"
      opacity={isCritical ? 0.9 : 0.5}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick(dep);
            }
          : undefined
      }
    >
      {/* Invisible wider hit area for easier clicking */}
      <path className="dep-hit-area" d={path} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        className="dep-stroke"
        data-testid="dep-stroke"
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeW}
      />
      <path
        className="dep-head"
        data-testid="dep-head"
        d={arrowHead}
        fill={strokeColor}
        stroke="none"
      />
    </g>
  );
}
