import React from 'react';

interface SummaryBarProps {
  x: number;
  y: number;
  width: number;
  color: string;
  done: boolean;
  taskName?: string;
}

export default function SummaryBar({ x, y, width, color, done, taskName }: SummaryBarProps) {
  const barHeight = 8;
  const tipSize = 4;

  return (
    <g opacity={done ? 0.4 : 1}>
      {/* Task name above bar */}
      {taskName && (
        <text
          x={x}
          y={y - 4}
          fontSize={10}
          fill="#9ca3af"
          dominantBaseline="auto"
          style={{
            pointerEvents: 'none',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {taskName}
        </text>
      )}
      {/* Main bar */}
      <rect
        x={x}
        y={y}
        width={Math.max(width, 2)}
        height={barHeight}
        fill={color}
        opacity={0.6}
        rx={1}
      />
      {/* Left tip */}
      <polygon
        points={`${x},${y + barHeight} ${x},${y + barHeight + tipSize} ${x + tipSize},${y + barHeight}`}
        fill={color}
        opacity={0.6}
      />
      {/* Right tip */}
      <polygon
        points={`${x + width},${y + barHeight} ${x + width},${y + barHeight + tipSize} ${x + width - tipSize},${y + barHeight}`}
        fill={color}
        opacity={0.6}
      />
    </g>
  );
}
