import React from 'react';

interface SummaryBarProps {
  x: number;
  y: number;
  width: number;
  color: string;
  percentComplete: number;
}

export default function SummaryBar({ x, y, width, color, percentComplete }: SummaryBarProps) {
  const barHeight = 8;
  const tipSize = 4;

  return (
    <g>
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
      {/* Progress fill */}
      {percentComplete > 0 && (
        <rect
          x={x}
          y={y}
          width={Math.max((width * percentComplete) / 100, 1)}
          height={barHeight}
          fill={color}
          opacity={0.9}
          rx={1}
        />
      )}
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
