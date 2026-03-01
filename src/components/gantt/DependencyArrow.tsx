import React from 'react';
import type { Dependency, Task, ZoomLevel } from '../../types';
import { getDependencyPoints, createBezierPath, createArrowHead } from '../../utils/dependencyUtils';

interface DependencyArrowProps {
  dep: Dependency;
  fromTask: Task;
  toTask: Task;
  taskYPositions: Map<string, number>;
  timelineStart: Date;
  colWidth: number;
  zoom: ZoomLevel;
  rowHeight: number;
}

export default function DependencyArrow({
  dep, fromTask, toTask, taskYPositions, timelineStart, colWidth, zoom, rowHeight,
}: DependencyArrowProps) {
  const points = getDependencyPoints(dep, fromTask, toTask, taskYPositions, timelineStart, colWidth, zoom, rowHeight);
  if (!points) return null;

  const path = createBezierPath(points.start, points.end);
  const arrowHead = createArrowHead(points.end);

  return (
    <g className="dependency-arrow" opacity={0.5}>
      <path d={path} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
      <path d={arrowHead} fill="#94a3b8" />
    </g>
  );
}
