import React, { useCallback } from 'react';
import type { Task } from '../types';

interface MilestoneMarkerProps {
  task: Task;
  x: number;
  y: number;
  rowHeight: number;
  color: string;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
}

export const MilestoneMarker: React.FC<MilestoneMarkerProps> = ({
  task,
  x,
  y,
  rowHeight,
  color,
  isSelected,
  onSelect,
}) => {
  const centerY = y + rowHeight / 2;
  const size = 6; // half of 12px

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(task.id);
    },
    [task.id, onSelect]
  );

  // Diamond points: top, right, bottom, left
  const points = [
    `${x},${centerY - size}`,
    `${x + size},${centerY}`,
    `${x},${centerY + size}`,
    `${x - size},${centerY}`,
  ].join(' ');

  return (
    <g className="milestone-marker" onClick={handleClick} cursor="pointer">
      {/* Diamond shape */}
      <polygon
        points={points}
        fill={color}
      />

      {/* Selection ring */}
      {isSelected && (
        <polygon
          points={[
            `${x},${centerY - size - 2}`,
            `${x + size + 2},${centerY}`,
            `${x},${centerY + size + 2}`,
            `${x - size - 2},${centerY}`,
          ].join(' ')}
          fill="none"
          stroke="white"
          strokeWidth={2}
          opacity={0.5}
          pointerEvents="none"
        />
      )}

      {/* Task name to the right */}
      <text
        x={x + size + 6}
        y={centerY}
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
