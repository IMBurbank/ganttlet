import React from 'react';
import type { ZoomLevel } from '../../types';
import { getTimelineDays, isWeekendDay, getColumnWidth } from '../../utils/dateUtils';

interface GridLinesProps {
  timelineStart: Date;
  timelineEnd: Date;
  zoom: ZoomLevel;
  totalHeight: number;
}

export default function GridLines({ timelineStart, timelineEnd, zoom, totalHeight }: GridLinesProps) {
  const colWidth = getColumnWidth(zoom);
  const days = getTimelineDays(timelineStart, timelineEnd);

  if (zoom === 'day') {
    return (
      <g className="grid-lines">
        {days.map((day, i) => {
          const x = i * colWidth;
          const weekend = isWeekendDay(day);
          return (
            <React.Fragment key={i}>
              {weekend && (
                <rect x={x} y={0} width={colWidth} height={totalHeight} fill="#1e293b" opacity={0.5} />
              )}
              <line x1={x} y1={0} x2={x} y2={totalHeight} stroke="#1e293b" strokeWidth={1} />
            </React.Fragment>
          );
        })}
      </g>
    );
  }

  const count = Math.ceil(days.length / (zoom === 'week' ? 7 : 30));
  return (
    <g className="grid-lines">
      {Array.from({ length: count + 1 }, (_, i) => {
        const x = i * colWidth;
        return (
          <line key={i} x1={x} y1={0} x2={x} y2={totalHeight} stroke="#1e293b" strokeWidth={1} />
        );
      })}
    </g>
  );
}
