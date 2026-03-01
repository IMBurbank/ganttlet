import React, { useCallback, useMemo, useRef } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { useTimelineStore, useDependencyStore, useUIStore } from '../stores';
import { useProjectDates } from '../hooks/useProjectDates';
import { useTaskColor } from '../hooks/useTaskColor';
import { useTaskDrag } from '../hooks/useTaskDrag';
import { useTaskResize } from '../hooks/useTaskResize';
import { TimelineHeader } from './TimelineHeader';
import { TimelineGrid } from './TimelineGrid';
import { TodayLine } from './TodayLine';
import { GanttBar } from './GanttBar';
import { SummaryBar } from './SummaryBar';
import { MilestoneMarker } from './MilestoneMarker';
import { DependencyLayer } from './DependencyLayer';
import { CollaborationOverlay } from './CollaborationOverlay';
import type { Task } from '../types';

interface TimelinePanelProps {
  visibleTasks: Task[];
}

const ROW_HEIGHT = 36;

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  visibleTasks,
}) => {
  const dayWidth = useTimelineStore((s) => s.dayWidth);
  const scrollX = useTimelineStore((s) => s.scrollX);
  const scrollY = useTimelineStore((s) => s.scrollY);
  const setScrollX = useTimelineStore((s) => s.setScrollX);
  const setScrollY = useTimelineStore((s) => s.setScrollY);

  const dependencies = useDependencyStore((s) => s.dependencies);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const showCriticalPath = useUIStore((s) => s.showCriticalPath);

  const { projectStart, projectEnd } = useProjectDates();
  const getTaskColor = useTaskColor();
  const { startDrag, onDrag, endDrag } = useTaskDrag();
  const { startResize, onResize, endResize } = useTaskResize();

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);

  const totalDays = differenceInCalendarDays(projectEnd, projectStart);
  const totalWidth = totalDays * dayWidth;
  const totalHeight = visibleTasks.length * ROW_HEIGHT;

  const handleDragStart = useCallback(
    (task: Task, clientX: number) => {
      isDraggingRef.current = true;
      startDrag(task, clientX);
    },
    [startDrag]
  );

  const handleResizeStart = useCallback(
    (task: Task, clientX: number) => {
      isResizingRef.current = true;
      startResize(task, clientX);
    },
    [startResize]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingRef.current) {
        onDrag(e.clientX);
      } else if (isResizingRef.current) {
        onResize(e.clientX);
      }
    },
    [onDrag, onResize]
  );

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      endDrag();
    }
    if (isResizingRef.current) {
      isResizingRef.current = false;
      endResize();
    }
  }, [endDrag, endResize]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.shiftKey) {
        // Horizontal scroll
        const newScrollX = Math.max(0, scrollX + e.deltaY);
        setScrollX(Math.min(newScrollX, Math.max(0, totalWidth - 800)));
      } else {
        // Vertical scroll
        const newScrollY = Math.max(0, scrollY + e.deltaY);
        setScrollY(Math.min(newScrollY, Math.max(0, totalHeight - 400)));
      }
    },
    [scrollX, scrollY, setScrollX, setScrollY, totalWidth, totalHeight]
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedTask(null);
  }, [setSelectedTask]);

  const handleSelect = useCallback(
    (taskId: string) => {
      setSelectedTask(taskId);
    },
    [setSelectedTask]
  );

  // Build task bars
  const taskElements = useMemo(() => {
    return visibleTasks.map((task, index) => {
      const x =
        differenceInCalendarDays(task.startDate, projectStart) * dayWidth -
        scrollX;
      const taskWidth =
        differenceInCalendarDays(task.endDate, task.startDate) * dayWidth;
      const y = index * ROW_HEIGHT;
      const color = getTaskColor(task);
      const isSelected = task.id === selectedTaskId;

      if (task.type === 'milestone') {
        return (
          <MilestoneMarker
            key={task.id}
            task={task}
            x={x}
            y={y}
            rowHeight={ROW_HEIGHT}
            color={color}
            isSelected={isSelected}
            onSelect={handleSelect}
          />
        );
      }

      if (task.type === 'summary') {
        return (
          <SummaryBar
            key={task.id}
            task={task}
            x={x}
            width={Math.max(taskWidth, 1)}
            y={y}
            rowHeight={ROW_HEIGHT}
            color={color}
            isSelected={isSelected}
            onSelect={handleSelect}
          />
        );
      }

      return (
        <GanttBar
          key={task.id}
          task={task}
          x={x}
          width={Math.max(taskWidth, dayWidth)}
          y={y}
          rowHeight={ROW_HEIGHT}
          color={color}
          isSelected={isSelected}
          onSelect={handleSelect}
          onDragStart={handleDragStart}
          onResizeStart={handleResizeStart}
        />
      );
    });
  }, [
    visibleTasks,
    projectStart,
    dayWidth,
    scrollX,
    selectedTaskId,
    getTaskColor,
    handleSelect,
    handleDragStart,
    handleResizeStart,
  ]);

  // SVG viewport dimensions
  const svgWidth = Math.max(totalWidth, 800);
  const svgHeight = Math.max(totalHeight, 400);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#09090b]">
      {/* Fixed timeline header */}
      <TimelineHeader
        projectStart={projectStart}
        totalDays={totalDays}
        dayWidth={dayWidth}
        scrollX={scrollX}
      />

      {/* Scrollable timeline area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        onWheel={handleWheel}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          className="select-none"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleBackgroundClick}
          style={{
            transform: `translateY(${-scrollY}px)`,
          }}
        >
          {/* Background grid */}
          <TimelineGrid
            width={svgWidth}
            height={svgHeight}
            projectStart={projectStart}
            dayWidth={dayWidth}
            scrollX={scrollX}
            rowHeight={ROW_HEIGHT}
            visibleTaskCount={visibleTasks.length}
          />

          {/* Dependency arrows */}
          <DependencyLayer
            visibleTasks={visibleTasks}
            dependencies={dependencies}
            projectStart={projectStart}
            dayWidth={dayWidth}
            scrollX={scrollX}
            rowHeight={ROW_HEIGHT}
          />

          {/* Task bars, summary bars, milestones */}
          <g className="task-elements">{taskElements}</g>

          {/* Critical path overlay */}
          {showCriticalPath && (
            <g className="critical-path-overlay" pointerEvents="none">
              {visibleTasks.map((task, index) => {
                if (!task.isCritical || task.type === 'summary') return null;
                const cx = differenceInCalendarDays(task.startDate, projectStart) * dayWidth - scrollX;
                const cw = Math.max(
                  differenceInCalendarDays(task.endDate, task.startDate) * dayWidth,
                  task.type === 'milestone' ? 14 : dayWidth
                );
                const cy = index * ROW_HEIGHT + 3;
                return (
                  <rect
                    key={`crit-${task.id}`}
                    x={cx - 2}
                    y={cy}
                    width={cw + 4}
                    height={ROW_HEIGHT - 6}
                    rx={6}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="4,2"
                    opacity={0.6}
                  />
                );
              })}
            </g>
          )}

          {/* Today line */}
          <TodayLine
            projectStart={projectStart}
            dayWidth={dayWidth}
            scrollX={scrollX}
            height={svgHeight}
          />

          {/* Collaboration cursors */}
          <CollaborationOverlay width={svgWidth} height={svgHeight} />
        </svg>
      </div>
    </div>
  );
};
