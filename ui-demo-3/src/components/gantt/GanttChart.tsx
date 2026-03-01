import React, { useMemo } from 'react';
import type { Task, ZoomLevel, ColorByField } from '../../types';
import { dateToX, getTimelineRange, getColumnWidth, getTimelineDays, getTimelineWeeks, getTimelineMonths } from '../../utils/dateUtils';
import { buildTaskYPositions, ROW_HEIGHT } from '../../utils/layoutUtils';
import { getTaskColor } from '../../data/colorPalettes';
import TimelineHeader from './TimelineHeader';
import GridLines from './GridLines';
import TodayLine from './TodayLine';
import TaskBar from './TaskBar';
import SummaryBar from './SummaryBar';
import MilestoneMarker from './MilestoneMarker';
import DependencyLayer from './DependencyLayer';

interface GanttChartProps {
  visibleTasks: Task[];
  allTasks: Task[];
  zoom: ZoomLevel;
  colorBy: ColorByField;
}

export default function GanttChart({ visibleTasks, allTasks, zoom, colorBy }: GanttChartProps) {
  const { start: timelineStart, end: timelineEnd } = useMemo(
    () => getTimelineRange(allTasks),
    [allTasks]
  );

  const colWidth = getColumnWidth(zoom);
  const taskYPositions = useMemo(() => buildTaskYPositions(visibleTasks), [visibleTasks]);

  const totalDays = useMemo(() => {
    if (zoom === 'day') return getTimelineDays(timelineStart, timelineEnd).length;
    if (zoom === 'week') return getTimelineWeeks(timelineStart, timelineEnd).length;
    return getTimelineMonths(timelineStart, timelineEnd).length;
  }, [timelineStart, timelineEnd, zoom]);

  const totalWidth = totalDays * colWidth;
  const totalHeight = visibleTasks.length * ROW_HEIGHT;

  return (
    <div className="inline-flex flex-col min-w-full">
      <TimelineHeader
        timelineStart={timelineStart}
        timelineEnd={timelineEnd}
        zoom={zoom}
        totalWidth={totalWidth}
      />
      <div className="relative" style={{ width: totalWidth }}>
        <svg width={totalWidth} height={totalHeight} className="block">
          <GridLines
            timelineStart={timelineStart}
            timelineEnd={timelineEnd}
            zoom={zoom}
            totalHeight={totalHeight}
          />
          <TodayLine
            timelineStart={timelineStart}
            zoom={zoom}
            totalHeight={totalHeight}
          />
          {/* Render bars */}
          {visibleTasks.map(task => {
            const yPos = taskYPositions.get(task.id);
            if (yPos === undefined) return null;
            const color = getTaskColor(colorBy, task[colorBy] as string);
            const x = dateToX(task.startDate, timelineStart, colWidth, zoom);
            const endX = dateToX(task.endDate, timelineStart, colWidth, zoom);
            const width = Math.max(endX - x, 0);

            if (task.isMilestone) {
              return (
                <MilestoneMarker
                  key={task.id}
                  x={x}
                  y={yPos + ROW_HEIGHT / 2}
                  color={color}
                  size={12}
                />
              );
            }

            if (task.isSummary) {
              return (
                <SummaryBar
                  key={task.id}
                  x={x}
                  y={yPos + ROW_HEIGHT / 2 - 4}
                  width={width}
                  color={color}
                  percentComplete={task.percentComplete}
                />
              );
            }

            return (
              <TaskBar
                key={task.id}
                taskId={task.id}
                taskName={task.name}
                startDate={task.startDate}
                endDate={task.endDate}
                percentComplete={task.percentComplete}
                color={color}
                x={x}
                y={yPos}
                width={width}
                timelineStart={timelineStart}
                zoom={zoom}
                rowHeight={ROW_HEIGHT}
              />
            );
          })}
          {/* Dependencies */}
          <DependencyLayer
            tasks={visibleTasks}
            allTasks={allTasks}
            taskYPositions={taskYPositions}
            timelineStart={timelineStart}
            zoom={zoom}
            rowHeight={ROW_HEIGHT}
          />
        </svg>
      </div>
    </div>
  );
}
