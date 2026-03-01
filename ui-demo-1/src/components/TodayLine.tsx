import React from 'react';
import { differenceInCalendarDays, startOfDay } from 'date-fns';

interface TodayLineProps {
  projectStart: Date;
  dayWidth: number;
  scrollX: number;
  height: number;
}

export const TodayLine: React.FC<TodayLineProps> = ({
  projectStart,
  dayWidth,
  scrollX,
  height,
}) => {
  const today = startOfDay(new Date());
  const x = differenceInCalendarDays(today, projectStart) * dayWidth - scrollX;

  // Don't render if off-screen
  if (x < -50 || x > 5000) return null;

  return (
    <g className="today-line">
      {/* "Today" label */}
      <text
        x={x}
        y={-4}
        textAnchor="middle"
        fill="#ef4444"
        fontSize={10}
        fontWeight={600}
      >
        Today
      </text>

      {/* Vertical dashed line */}
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke="#ef4444"
        strokeWidth={2}
        strokeDasharray="4,4"
      />
    </g>
  );
};
