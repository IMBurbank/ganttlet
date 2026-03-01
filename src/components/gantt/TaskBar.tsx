import React, { useRef, useCallback } from 'react';
import type { ZoomLevel } from '../../types';
import { useGanttDispatch, useSetViewingTask } from '../../state/GanttContext';
import { dateToX, xToDate, formatDate, daysBetween, getColumnWidth } from '../../utils/dateUtils';
import Tooltip from '../shared/Tooltip';

interface TaskBarProps {
  taskId: string;
  taskName: string;
  startDate: string;
  endDate: string;
  done: boolean;
  color: string;
  x: number;
  y: number;
  width: number;
  timelineStart: Date;
  zoom: ZoomLevel;
  rowHeight: number;
  notes?: string;
  owner?: string;
  functionalArea?: string;
  okrs?: string[];
  showOwner?: boolean;
  showArea?: boolean;
  showOkrs?: boolean;
  isCritical?: boolean;
  viewerName?: string;
  viewerColor?: string;
}

let clipIdCounter = 0;

export default function TaskBar({
  taskId, taskName, startDate, endDate, done, color,
  x, y, width, timelineStart, zoom, rowHeight, notes,
  owner, functionalArea, okrs, showOwner, showArea, showOkrs, isCritical,
  viewerName, viewerColor,
}: TaskBarProps) {
  const dispatch = useGanttDispatch();
  const setViewingTask = useSetViewingTask();
  const dragRef = useRef<{
    startX: number;
    origStartDate: string;
    origEndDate: string;
    mode: 'move' | 'resize';
    lastStartDate: string;
  } | null>(null);
  const clipId = useRef(`task-clip-${++clipIdCounter}`);

  const barHeight = 28;
  const barY = y + (rowHeight - barHeight) / 2;
  const colWidth = getColumnWidth(zoom);
  const minWidth = colWidth * 0.5;

  const handleMouseDown = useCallback((e: React.MouseEvent, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, origStartDate: startDate, origEndDate: endDate, mode, lastStartDate: startDate };

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

        dragRef.current.lastStartDate = newStartStr;
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
        if (finalTask.mode === 'move') {
          const delta = daysBetween(finalTask.origStartDate, finalTask.lastStartDate);
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

  // Build owner/area/okrs subtitle
  const subtitleParts: string[] = [];
  if (showOwner && owner) subtitleParts.push(owner);
  if (showArea && functionalArea) subtitleParts.push(functionalArea);
  if (showOkrs && okrs && okrs.length > 0) subtitleParts.push(okrs.join(', '));
  const subtitle = subtitleParts.join(' \u00B7 ');

  const tooltipContent = (
    <div className="space-y-1">
      <div className="font-semibold text-text-primary">{taskName}</div>
      <div className="text-text-secondary">{startDate} - {endDate}</div>
      <div className="text-text-secondary">{done ? 'Done' : 'In progress'}</div>
      {notes && <div className="text-text-muted text-xs italic">{notes}</div>}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} delay={300} svg>
      <g
        opacity={done ? 0.4 : 1}
        onMouseEnter={() => setViewingTask(taskId, null)}
        onMouseLeave={() => setViewingTask(null, null)}
      >
        <defs>
          <clipPath id={clipId.current}>
            <rect x={x + 4} y={barY} width={Math.max(width - 8, 0)} height={barHeight} />
          </clipPath>
        </defs>
        {/* Viewer presence outline */}
        {viewerColor && (
          <>
            <rect
              x={x - 3}
              y={barY - 3}
              width={Math.max(width, 4) + 6}
              height={barHeight + 6}
              rx={6}
              fill="none"
              stroke={viewerColor}
              strokeWidth={2}
              opacity={0.8}
              style={{ pointerEvents: 'none' }}
            />
            {viewerName && (
              <g style={{ pointerEvents: 'none' }}>
                <rect
                  x={x - 3}
                  y={barY - 16}
                  width={viewerName.length * 6.5 + 8}
                  height={14}
                  rx={3}
                  fill={viewerColor}
                />
                <text
                  x={x + 1}
                  y={barY - 7}
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
        {/* Critical path background glow */}
        {isCritical && (
          <rect
            x={x - 2}
            y={barY - 2}
            width={Math.max(width, 4) + 4}
            height={barHeight + 4}
            rx={6}
            fill="none"
            stroke="#ef4444"
            strokeWidth={1}
            opacity={0.3}
            style={{ pointerEvents: 'none' }}
          />
        )}
        {/* Main bar fill */}
        <rect
          x={x}
          y={barY}
          width={Math.max(width, 4)}
          height={barHeight}
          rx={4}
          fill={isCritical ? '#ef4444' : color}
          opacity={isCritical ? 0.35 : 0.6}
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
          stroke={isCritical ? '#ef4444' : color}
          strokeWidth={isCritical ? 2 : 1.5}
          opacity={isCritical ? 1 : 0.6}
          className="task-bar"
          onMouseDown={e => handleMouseDown(e, 'move')}
        />
        {/* Task name label with clipPath */}
        {width > 30 && (
          <text
            x={x + 6}
            y={subtitle ? barY + 11 : barY + barHeight / 2 + 1}
            fontSize={11}
            fill="var(--raw-bar-text)"
            dominantBaseline="middle"
            clipPath={`url(#${clipId.current})`}
            style={{
              pointerEvents: 'none',
              textShadow: 'var(--raw-bar-text-shadow)',
              textDecoration: done ? 'line-through' : 'none',
            }}
          >
            {taskName}
          </text>
        )}
        {/* Owner / Area subtitle */}
        {width > 60 && subtitle && (
          <text
            x={x + 6}
            y={barY + 22}
            fontSize={9}
            fill="var(--raw-bar-text)"
            dominantBaseline="middle"
            clipPath={`url(#${clipId.current})`}
            opacity={0.65}
            style={{
              pointerEvents: 'none',
              textShadow: 'var(--raw-bar-text-shadow)',
            }}
          >
            {subtitle}
          </text>
        )}
        {/* Done checkmark indicator */}
        {done && width > 20 && (
          <text
            x={x + width - 16}
            y={barY + barHeight / 2 + 1}
            fontSize={12}
            fill="var(--raw-bar-text)"
            dominantBaseline="middle"
            textAnchor="middle"
            style={{ pointerEvents: 'none' }}
          >
            ✓
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
