import React from 'react';
import type { ZoomLevel } from '../../types';
import { useUIStore } from '../../hooks';
import {
  getTimelineDays,
  getTimelineDaysFiltered,
  getTimelineWeeks,
  getTimelineMonths,
  getColumnWidth,
  formatTimelineHeader,
  formatTimelineSubHeader,
  getMonthLabel,
  isWeekendDay,
} from '../../utils/dateUtils';
import { format } from 'date-fns';

interface TimelineHeaderProps {
  timelineStart: Date;
  timelineEnd: Date;
  zoom: ZoomLevel;
  totalWidth: number;
}

export default function TimelineHeader({
  timelineStart,
  timelineEnd,
  zoom,
  totalWidth,
}: TimelineHeaderProps) {
  const colWidth = getColumnWidth(zoom);
  const collapseWeekends = useUIStore((s) => s.collapseWeekends);

  if (zoom === 'day') {
    const days = collapseWeekends
      ? getTimelineDaysFiltered(timelineStart, timelineEnd, true)
      : getTimelineDays(timelineStart, timelineEnd);
    // Group days by month for top row
    const months: { label: string; startIdx: number; count: number }[] = [];
    let currentMonth = '';
    for (let i = 0; i < days.length; i++) {
      const ml = format(days[i], 'MMMM yyyy');
      if (ml !== currentMonth) {
        months.push({ label: ml, startIdx: i, count: 1 });
        currentMonth = ml;
      } else {
        months[months.length - 1].count++;
      }
    }

    return (
      <div
        className="sticky top-0 z-10 bg-surface-raised border-b border-border-default"
        style={{ width: totalWidth }}
      >
        {/* Month row */}
        <div className="flex h-6 border-b border-border-subtle">
          {months.map((m, i) => (
            <div
              key={i}
              className="text-xs font-semibold text-text-secondary flex items-center px-2 border-r border-border-subtle truncate"
              style={{ width: m.count * colWidth }}
            >
              {m.label}
            </div>
          ))}
        </div>
        {/* Day row */}
        <div className="flex h-6">
          {days.map((day, i) => {
            const weekend = isWeekendDay(day);
            return (
              <div
                key={i}
                className={`flex flex-col items-center justify-center text-center border-r border-border-subtle shrink-0 ${
                  weekend ? 'bg-surface-overlay/30 text-text-muted' : 'text-text-muted'
                }`}
                style={{ width: colWidth }}
              >
                <span className="text-[10px] leading-none">{formatTimelineHeader(day, zoom)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (zoom === 'week') {
    const weeks = getTimelineWeeks(timelineStart, timelineEnd);
    return (
      <div
        className="sticky top-0 z-10 bg-surface-raised border-b border-border-default flex h-[50px]"
        style={{ width: totalWidth }}
      >
        {weeks.map((week, i) => (
          <div
            key={i}
            className="flex items-center justify-center text-xs text-text-muted border-r border-border-subtle shrink-0"
            style={{ width: colWidth }}
          >
            {formatTimelineHeader(week, zoom)}
          </div>
        ))}
      </div>
    );
  }

  // Month
  const months = getTimelineMonths(timelineStart, timelineEnd);
  return (
    <div
      className="sticky top-0 z-10 bg-surface-raised border-b border-border-default flex h-[50px]"
      style={{ width: totalWidth }}
    >
      {months.map((month, i) => (
        <div
          key={i}
          className="flex items-center justify-center text-xs text-text-muted border-r border-border-subtle shrink-0"
          style={{ width: colWidth }}
        >
          {formatTimelineHeader(month, zoom)}
        </div>
      ))}
    </div>
  );
}
