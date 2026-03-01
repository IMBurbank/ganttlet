import React, { useCallback } from 'react';
import type { Task } from '../types';

interface SummaryBarProps {
  task: Task;
  x: number;
  width: number;
  y: number;
  rowHeight: number;
  color: string;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
}

export const SummaryBar: React.FC<SummaryBarProps> = ({
  task,
  x,
  width,
  y,
  rowHeight,
  color,
  isSelected,
  onSelect,
}) => {
  const barY = y + rowHeight / 2 - 3; // Center the 6px bar in the row
  const triangleSize = 5;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(task.id);
    },
    [task.id, onSelect]
  );

  if (width <= 0) return null;

  // Bracket-style path: horizontal bar with downward triangles at each end
  // Left triangle: points down from left edge
  // Right triangle: points down from right edge
  const bracketPath = [
    // Left downward triangle
    `M ${x},${barY + 3}`,
    `L ${x - triangleSize},${barY}`,
    `L ${x},${barY}`,
    // Horizontal bar across the top
    `L ${x + width},${barY}`,
    // Right downward triangle
    `L ${x + width + triangleSize},${barY}`,
    `L ${x + width},${barY + 3}`,
    // Bar bottom (going back)
    `L ${x + width},${barY + 6}`,
    `L ${x},${barY + 6}`,
    `Z`,
  ].join(' ');

  return (
    <g className="summary-bar" onClick={handleClick} cursor="pointer">
      {/* Main bracket shape */}
      <path
        d={bracketPath}
        fill={color}
        opacity={0.8}
      />

      {/* Selection ring */}
      {isSelected && (
        <rect
          x={x - triangleSize - 1}
          y={barY - 1}
          width={width + triangleSize * 2 + 2}
          height={8}
          rx={2}
          ry={2}
          fill="none"
          stroke="white"
          strokeWidth={2}
          opacity={0.5}
          pointerEvents="none"
        />
      )}

      {/* Task name to the right */}
      <text
        x={x + width + triangleSize + 6}
        y={barY + 3}
        dominantBaseline="central"
        fill="#a1a1aa"
        fontSize={11}
        pointerEvents="none"
      >
        {task.name}
      </text>
    </g>
  );
};
