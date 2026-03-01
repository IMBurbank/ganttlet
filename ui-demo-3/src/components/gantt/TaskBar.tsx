import React, { useRef, useCallback } from 'react';
import type { ZoomLevel } from '../../types';
import { useGanttDispatch } from '../../state/GanttContext';
import { dateToX, xToDate, formatDate, daysBetween, getColumnWidth } from '../../utils/dateUtils';
import Tooltip from '../shared/Tooltip';

interface TaskBarProps {
  taskId: string;
  taskName: string;
  startDate: string;
  endDate: string;
  percentComplete: number;
  color: string;
  x: number;
  y: number;
  width: number;
  timelineStart: Date;
  zoom: ZoomLevel;
  rowHeight: number;
}

export default function TaskBar({
  taskId, taskName, startDate, endDate, percentComplete, color,
  x, y, width, timelineStart, zoom, rowHeight,
}: TaskBarProps) {
  const dispatch = useGanttDispatch();
  const dragRef = useRef<{
    startX: number;
    origStartDate: string;
    origEndDate: string;
    mode: 'move' | 'resize';
  } | null>(null);

  const barHeight = 22;
  const barY = y + (rowHeight - barHeight) / 2;
  const colWidth = getColumnWidth(zoom);
  const minWidth = colWidth * 0.5;

  const handleMouseDown = useCallback((e: React.MouseEvent, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, origStartDate: startDate, origEndDate: endDate, mode };

    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;

      if (dragRef.current.mode === 'move') {
        const newStart = xToDate(dateToX(dragRef.current.origStartDate, timelineStart, colWidth, zoom) + dx, timelineStart, colWidth, zoom);
        const duration = daysBetween(dragRef.current.origStartDate, dragRef.current.origEndDate);
        const newStartStr = formatDate(newStart);
        const newEnd = new Date(newStart);
        newEnd.setDate(newEnd.getDate() + duration);
        const newEndStr = formatDate(newEnd);

        dispatch({ type: 'MOVE_TASK', taskId, newStartDate: newStartStr, newEndDate: newEndStr });
      } else {
        const newEndX = dateToX(dragRef.current.origEndDate, timelineStart, colWidth, zoom) + dx;
        const origStartX = dateToX(dragRef.current.origStartDate, timelineStart, colWidth, zoom);
        if (newEndX - origStartX < minWidth) return;
        const newEnd = xToDate(newEndX, timelineStart, colWidth, zoom);
        const newEndStr = formatDate(newEnd);
        const newDuration = daysBetween(dragRef.current.origStartDate, newEndStr);
        if (newDuration < 1) return;
        dispatch({ type: 'RESIZE_TASK', taskId, newEndDate: newEndStr, newDuration });
      }
    }

    function onMouseUp() {
      if (dragRef.current) {
        const finalTask = dragRef.current;
        dragRef.current = null;
        // Cascade dependents
        if (finalTask.mode === 'move') {
          const delta = daysBetween(finalTask.origStartDate, startDate);
          if (delta !== 0) {
            dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: delta });
          }
        }
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [dispatch, taskId, startDate, endDate, timelineStart, colWidth, zoom, minWidth]);

  const tooltipContent = (
    <div className="space-y-1">
      <div className="font-semibold text-white">{taskName}</div>
      <div className="text-gray-400">{startDate} - {endDate}</div>
      <div className="text-gray-400">{percentComplete}% complete</div>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} delay={300}>
      <g>
        {/* Background bar */}
        <rect
          x={x}
          y={barY}
          width={Math.max(width, 4)}
          height={barHeight}
          rx={4}
          fill={color}
          opacity={0.25}
          className="task-bar"
          onMouseDown={e => handleMouseDown(e, 'move')}
        />
        {/* Progress fill */}
        <rect
          x={x}
          y={barY}
          width={Math.max((width * percentComplete) / 100, 0)}
          height={barHeight}
          rx={4}
          fill={color}
          opacity={0.7}
          className="task-bar"
          onMouseDown={e => handleMouseDown(e, 'move')}
        />
        {/* Full bar stroke */}
        <rect
          x={x}
          y={barY}
          width={Math.max(width, 4)}
          height={barHeight}
          rx={4}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.6}
          className="task-bar"
          onMouseDown={e => handleMouseDown(e, 'move')}
        />
        {/* Task name label */}
        {width > 60 && (
          <text
            x={x + 6}
            y={barY + barHeight / 2 + 1}
            fontSize={11}
            fill="white"
            dominantBaseline="middle"
            style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
          >
            {taskName.length > width / 7 ? taskName.slice(0, Math.floor(width / 7)) + '...' : taskName}
          </text>
        )}
        {/* Right resize handle */}
        <rect
          x={x + Math.max(width, 4) - 6}
          y={barY}
          width={6}
          height={barHeight}
          fill="transparent"
          className="resize-handle"
          onMouseDown={e => handleMouseDown(e, 'resize')}
        />
      </g>
    </Tooltip>
  );
}
