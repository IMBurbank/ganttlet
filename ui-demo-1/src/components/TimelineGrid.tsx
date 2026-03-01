import React, { useMemo } from 'react';
import { addDays, getDay, getDate } from 'date-fns';

interface TimelineGridProps {
  width: number;
  height: number;
  projectStart: Date;
  dayWidth: number;
  scrollX: number;
  rowHeight: number;
  visibleTaskCount: number;
}

export const TimelineGrid: React.FC<TimelineGridProps> = ({
  width,
  height,
  projectStart,
  dayWidth,
  scrollX,
  rowHeight,
  visibleTaskCount,
}) => {
  const totalDays = Math.ceil(width / dayWidth) + 2;
  const startDayOffset = Math.floor(scrollX / dayWidth);

  const { weekendRects, verticalLines } = useMemo(() => {
    const rects: { x: number; key: string }[] = [];
    const lines: { x: number; isWeekBoundary: boolean; key: string }[] = [];

    for (let i = startDayOffset; i < startDayOffset + totalDays; i++) {
      if (i < 0) continue;
      const date = addDays(projectStart, i);
      const x = i * dayWidth - scrollX;
      const dayOfWeek = getDay(date); // 0=Sun, 1=Mon, ..., 6=Sat
      const dayOfMonth = getDate(date);

      // Weekend fill
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        rects.push({ x, key: `we-${i}` });
      }

      // Vertical lines
      const isWeekBoundary = dayOfWeek === 1; // Monday
      const isMonthBoundary = dayOfMonth === 1;

      lines.push({
        x,
        isWeekBoundary: isWeekBoundary || isMonthBoundary,
        key: `vl-${i}`,
      });
    }

    return { weekendRects: rects, verticalLines: lines };
  }, [projectStart, dayWidth, scrollX, startDayOffset, totalDays]);

  const horizontalLines = useMemo(() => {
    const lines: { y: number; key: string }[] = [];
    for (let i = 0; i <= visibleTaskCount; i++) {
      lines.push({ y: i * rowHeight, key: `hl-${i}` });
    }
    return lines;
  }, [visibleTaskCount, rowHeight]);

  return (
    <g className="timeline-grid">
      {/* Weekend fills */}
      {weekendRects.map(({ x, key }) => (
        <rect
          key={key}
          x={x}
          y={0}
          width={dayWidth}
          height={height}
          fill="#141417"
        />
      ))}

      {/* Vertical gridlines */}
      {verticalLines.map(({ x, isWeekBoundary, key }) => (
        <line
          key={key}
          x1={x}
          y1={0}
          x2={x}
          y2={height}
          stroke={isWeekBoundary ? '#27272a' : '#1e1e22'}
          strokeWidth={1}
        />
      ))}

      {/* Horizontal gridlines */}
      {horizontalLines.map(({ y, key }) => (
        <line
          key={key}
          x1={0}
          y1={y}
          x2={width}
          y2={y}
          stroke="#1e1e22"
          strokeWidth={1}
        />
      ))}
    </g>
  );
};
