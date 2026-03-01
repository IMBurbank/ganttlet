import React, { useMemo } from 'react';
import { addDays, format, getDay } from 'date-fns';
import { useTimelineStore } from '../stores';

interface TimelineHeaderProps {
  projectStart: Date;
  totalDays: number;
  dayWidth: number;
  scrollX: number;
}

export const TimelineHeader: React.FC<TimelineHeaderProps> = ({
  projectStart,
  totalDays,
  dayWidth,
  scrollX,
}) => {
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);

  const labels = useMemo(() => {
    const items: {
      key: string;
      label: string;
      x: number;
      isMonthBoundary: boolean;
      tier: 'primary' | 'secondary';
    }[] = [];

    if (zoomLevel === 'day' || dayWidth >= 30) {
      // Day zoom: show "Mon 3", "Tue 4" etc. with month/year above
      let lastMonth = -1;
      for (let i = 0; i < totalDays; i++) {
        const date = addDays(projectStart, i);
        const x = i * dayWidth;
        const dayOfMonth = date.getDate();
        const month = date.getMonth();

        // Month/year header row
        if (month !== lastMonth) {
          items.push({
            key: `month-${i}`,
            label: format(date, 'MMMM yyyy'),
            x,
            isMonthBoundary: true,
            tier: 'secondary',
          });
          lastMonth = month;
        }

        items.push({
          key: `day-${i}`,
          label: format(date, 'EEE d'),
          x,
          isMonthBoundary: dayOfMonth === 1,
          tier: 'primary',
        });
      }
    } else if (zoomLevel === 'week' || dayWidth >= 10) {
      // Week zoom: show Monday dates like "Mar 3" every 7 days, with month name above
      let lastMonth = -1;
      for (let i = 0; i < totalDays; i++) {
        const date = addDays(projectStart, i);
        const dayOfWeek = getDay(date); // 0=Sun, 1=Mon
        const month = date.getMonth();

        // Month header
        if (month !== lastMonth) {
          items.push({
            key: `month-${i}`,
            label: format(date, 'MMMM yyyy'),
            x: i * dayWidth,
            isMonthBoundary: true,
            tier: 'secondary',
          });
          lastMonth = month;
        }

        // Show label on Mondays
        if (dayOfWeek === 1) {
          items.push({
            key: `week-${i}`,
            label: format(date, 'MMM d'),
            x: i * dayWidth,
            isMonthBoundary: false,
            tier: 'primary',
          });
        }
      }
    } else {
      // Month zoom: show month names like "Mar 2026"
      let lastMonth = -1;
      for (let i = 0; i < totalDays; i++) {
        const date = addDays(projectStart, i);
        const month = date.getMonth();

        if (month !== lastMonth) {
          items.push({
            key: `month-${i}`,
            label: format(date, 'MMM yyyy'),
            x: i * dayWidth,
            isMonthBoundary: true,
            tier: 'primary',
          });
          lastMonth = month;
        }
      }
    }

    return items;
  }, [projectStart, totalDays, dayWidth, zoomLevel]);

  return (
    <div
      className="relative select-none overflow-hidden"
      style={{
        height: 52,
        backgroundColor: '#18181b',
        borderBottom: '1px solid #27272a',
      }}
    >
      {labels.map((item) => {
        const left = item.x - scrollX;

        // Skip off-screen labels (with some buffer)
        if (left < -200 || left > 5000) return null;

        if (item.tier === 'secondary') {
          return (
            <div
              key={item.key}
              className="absolute whitespace-nowrap"
              style={{
                left,
                top: 4,
                fontSize: 11,
                fontWeight: 600,
                color: '#a1a1aa',
                borderLeft: item.isMonthBoundary
                  ? '1px solid #3f3f46'
                  : undefined,
                paddingLeft: 4,
              }}
            >
              {item.label}
            </div>
          );
        }

        return (
          <div
            key={item.key}
            className="absolute whitespace-nowrap"
            style={{
              left,
              top: 24,
              fontSize: 10,
              color: '#71717a',
              borderLeft: item.isMonthBoundary
                ? '1px solid #3f3f46'
                : undefined,
              paddingLeft: 3,
            }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
};
