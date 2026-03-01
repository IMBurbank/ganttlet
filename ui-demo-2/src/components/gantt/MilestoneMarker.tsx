import React from 'react';

interface MilestoneMarkerProps {
  x: number;
  y: number;
  color: string;
  size?: number;
  taskName?: string;
  isCritical?: boolean;
  viewerName?: string;
  viewerColor?: string;
}

export default function MilestoneMarker({ x, y, color, size = 10, taskName, isCritical, viewerName, viewerColor }: MilestoneMarkerProps) {
  const half = size / 2;
  const displayColor = isCritical ? '#ef4444' : color;
  return (
    <g>
      {/* Viewer presence outline */}
      {viewerColor && (
        <>
          <polygon
            points={`${x},${y - half - 4} ${x + half + 4},${y} ${x},${y + half + 4} ${x - half - 4},${y}`}
            fill="none"
            stroke={viewerColor}
            strokeWidth={2}
            opacity={0.8}
            style={{ pointerEvents: 'none' }}
          />
          {viewerName && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={x - half - 4}
                y={y - half - 18}
                width={viewerName.length * 6.5 + 8}
                height={14}
                rx={3}
                fill={viewerColor}
              />
              <text
                x={x - half}
                y={y - half - 9}
                fontSize={9}
                fill="white"
                dominantBaseline="middle"
                fontWeight={600}
              >
                {viewerName}
              </text>
            </g>
          )}
        </>
      )}
      {isCritical && (
        <polygon
          points={`${x},${y - half - 3} ${x + half + 3},${y} ${x},${y + half + 3} ${x - half - 3},${y}`}
          fill="none"
          stroke="#ef4444"
          strokeWidth={1}
          opacity={0.3}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <polygon
        points={`${x},${y - half} ${x + half},${y} ${x},${y + half} ${x - half},${y}`}
        fill={displayColor}
        stroke={displayColor}
        strokeWidth={isCritical ? 2 : 1}
        className="task-bar"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
      />
      {/* Task name to the right of the diamond */}
      {taskName && (
        <text
          x={x + half + 4}
          y={y + 1}
          fontSize={10}
          fill="var(--raw-label-text)"
          dominantBaseline="middle"
          style={{ pointerEvents: 'none' }}
        >
          {taskName}
        </text>
      )}
    </g>
  );
}
