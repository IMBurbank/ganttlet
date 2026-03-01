import React from 'react';

interface MilestoneMarkerProps {
  x: number;
  y: number;
  color: string;
  size?: number;
  taskName?: string;
}

export default function MilestoneMarker({ x, y, color, size = 10, taskName }: MilestoneMarkerProps) {
  const half = size / 2;
  return (
    <g>
      <polygon
        points={`${x},${y - half} ${x + half},${y} ${x},${y + half} ${x - half},${y}`}
        fill={color}
        stroke={color}
        strokeWidth={1}
        className="task-bar"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
      />
      {/* Task name to the right of the diamond */}
      {taskName && (
        <text
          x={x + half + 4}
          y={y + 1}
          fontSize={10}
          fill="#9ca3af"
          dominantBaseline="middle"
          style={{ pointerEvents: 'none' }}
        >
          {taskName}
        </text>
      )}
    </g>
  );
}
