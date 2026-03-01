import React, { useCallback } from 'react';
import { useResourceStore } from '../stores';
import type { Task } from '../types';

interface GanttBarProps {
  task: Task;
  x: number;
  width: number;
  y: number;
  rowHeight: number;
  color: string;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
  onDragStart: (task: Task, clientX: number) => void;
  onResizeStart: (task: Task, clientX: number) => void;
}

export const GanttBar: React.FC<GanttBarProps> = ({
  task,
  x,
  width,
  y,
  rowHeight,
  color,
  isSelected,
  onSelect,
  onDragStart,
  onResizeStart,
}) => {
  const resources = useResourceStore((s) => s.resources);

  const barHeight = rowHeight - 10;
  const barY = y + (rowHeight - barHeight) / 2;
  const progressWidth = (width * task.percentComplete) / 100;

  const assignedResources = resources.filter((r) =>
    task.assignedResourceIds.includes(r.id)
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(task.id);
      onDragStart(task, e.clientX);
    },
    [task, onSelect, onDragStart]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onResizeStart(task, e.clientX);
    },
    [task, onResizeStart]
  );

  // Don't render bars with zero or negative width
  if (width <= 0) return null;

  return (
    <g
      style={{ transition: 'transform 0.15s ease' }}
      className="gantt-bar"
    >
      {/* Main bar */}
      <rect
        x={x}
        y={barY}
        width={width}
        height={barHeight}
        rx={4}
        ry={4}
        fill={color}
        opacity={0.7}
        cursor="grab"
        onMouseDown={handleMouseDown}
      />

      {/* Progress fill */}
      {progressWidth > 0 && (
        <rect
          x={x}
          y={barY}
          width={Math.min(progressWidth, width)}
          height={barHeight}
          rx={4}
          ry={4}
          fill={color}
          opacity={1}
          cursor="grab"
          onMouseDown={handleMouseDown}
          // Clip right side when progress < 100%
          clipPath={progressWidth < width ? undefined : undefined}
        />
      )}

      {/* Selection ring */}
      {isSelected && (
        <rect
          x={x - 1}
          y={barY - 1}
          width={width + 2}
          height={barHeight + 2}
          rx={5}
          ry={5}
          fill="none"
          stroke="white"
          strokeWidth={2}
          opacity={0.5}
          pointerEvents="none"
        />
      )}

      {/* Resize handle (right edge) */}
      <rect
        x={x + width - 6}
        y={barY}
        width={6}
        height={barHeight}
        fill="transparent"
        cursor="ew-resize"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Task name to the right of the bar */}
      <text
        x={x + width + 6}
        y={barY + barHeight / 2}
        dominantBaseline="central"
        fill="#a1a1aa"
        fontSize={11}
        pointerEvents="none"
      >
        {task.name}
      </text>

      {/* Resource initials */}
      {assignedResources.map((resource, idx) => (
        <g key={resource.id}>
          <circle
            cx={x + width - 10 - idx * 18}
            cy={barY + barHeight / 2}
            r={7}
            fill={resource.avatarColor}
            stroke="#18181b"
            strokeWidth={1}
          />
          <text
            x={x + width - 10 - idx * 18}
            y={barY + barHeight / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={7}
            fontWeight={600}
            pointerEvents="none"
          >
            {resource.initials}
          </text>
        </g>
      ))}
    </g>
  );
};
