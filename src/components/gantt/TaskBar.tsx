import React, { useRef, useCallback, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { ZoomLevel } from '../../types';
import { useMutate } from '../../hooks';
import {
  dateToX,
  xToDate,
  getColumnWidth,
  getDayPx,
  ensureBusinessDay,
  prevBusinessDay,
  taskDuration,
} from '../../utils/dateUtils';
import { format } from 'date-fns';
import { setDragIntent, updateViewingTask } from '../../collab/awareness';
import Tooltip from '../shared/Tooltip';
import TaskBarPopover from './TaskBarPopover';

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
  collapseWeekends?: boolean;
  earliestStart?: string;
  conflictMessage?: string;
  awareness?: Awareness | null;
}

let clipIdCounter = 0;

export default function TaskBar({
  taskId,
  taskName,
  startDate,
  endDate,
  done,
  color,
  x,
  y,
  width,
  timelineStart,
  zoom,
  rowHeight,
  notes,
  owner,
  functionalArea,
  okrs,
  showOwner,
  showArea,
  showOkrs,
  isCritical,
  viewerName,
  viewerColor,
  collapseWeekends = false,
  earliestStart,
  conflictMessage,
  awareness,
}: TaskBarProps) {
  const mutate = useMutate();
  const dragRef = useRef<{
    startX: number;
    origStartDate: string;
    origEndDate: string;
    mode: 'move' | 'resize';
    lastStartDate: string;
    lastEndDate: string;
    lastBroadcastTime: number;
  } | null>(null);
  const gRef = useRef<SVGGElement>(null);
  const clipId = useRef(`task-clip-${++clipIdCounter}`);

  const barHeight = 28;
  const barY = y + (rowHeight - barHeight) / 2;
  const colWidth = getColumnWidth(zoom);
  const dayPx = getDayPx(zoom);
  const minWidth = colWidth * 0.5;

  const broadcastDragIntent = useCallback(
    (dragState: { lastStartDate: string; lastEndDate: string; lastBroadcastTime: number }) => {
      if (!awareness) return;
      const now = performance.now();
      if (now - dragState.lastBroadcastTime < 100) return;
      dragState.lastBroadcastTime = now;
      setDragIntent(awareness, {
        taskId,
        startDate: dragState.lastStartDate,
        endDate: dragState.lastEndDate,
      });
    },
    [awareness, taskId]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: 'move' | 'resize') => {
      // Don't initiate drag on double-click (detail >= 2) — let onDoubleClick handle it
      if (e.detail >= 2) return;
      e.preventDefault();
      e.stopPropagation();

      // Capture pointer — all subsequent move/up events route to this element
      (e.target as Element).setPointerCapture(e.pointerId);

      dragRef.current = {
        startX: e.clientX,
        origStartDate: startDate,
        origEndDate: endDate,
        mode,
        lastStartDate: startDate,
        lastEndDate: endDate,
        lastBroadcastTime: 0,
      };
    },
    [startDate, endDate]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;

      if (dragRef.current.mode === 'move') {
        const newStart = ensureBusinessDay(
          xToDate(
            dateToX(
              dragRef.current.origStartDate,
              timelineStart,
              colWidth,
              zoom,
              collapseWeekends
            ) + dx,
            timelineStart,
            colWidth,
            zoom,
            collapseWeekends
          )
        );
        let newStartStr = format(newStart, 'yyyy-MM-dd');

        // Clamp to earliest start constraint
        if (earliestStart && newStartStr < earliestStart) {
          newStartStr = earliestStart;
        }

        // Shift end by same pixel delta to preserve visual width
        const clampedDx =
          earliestStart && format(newStart, 'yyyy-MM-dd') < earliestStart
            ? dateToX(earliestStart, timelineStart, colWidth, zoom, collapseWeekends) -
              dateToX(
                dragRef.current.origStartDate,
                timelineStart,
                colWidth,
                zoom,
                collapseWeekends
              )
            : dx;

        const newEnd = prevBusinessDay(
          xToDate(
            dateToX(dragRef.current.origEndDate, timelineStart, colWidth, zoom, collapseWeekends) +
              clampedDx,
            timelineStart,
            colWidth,
            zoom,
            collapseWeekends
          )
        );
        const newEndStr = format(newEnd, 'yyyy-MM-dd');

        // Skip if dates haven't changed
        if (
          newStartStr === dragRef.current.lastStartDate &&
          newEndStr === dragRef.current.lastEndDate
        )
          return;
        dragRef.current.lastStartDate = newStartStr;
        dragRef.current.lastEndDate = newEndStr;

        // CSS transform — GPU composited, zero React re-renders
        if (gRef.current) {
          const origX = dateToX(startDate, timelineStart, colWidth, zoom, collapseWeekends);
          const newX = dateToX(newStartStr, timelineStart, colWidth, zoom, collapseWeekends);
          gRef.current.style.transform = `translate(${newX - origX}px, 0)`;
        }

        // Broadcast drag intent (throttled 100ms)
        broadcastDragIntent(dragRef.current);
      } else {
        const newEndX =
          dateToX(dragRef.current.origEndDate, timelineStart, colWidth, zoom, collapseWeekends) +
          dayPx +
          dx;
        const origStartX = dateToX(
          dragRef.current.origStartDate,
          timelineStart,
          colWidth,
          zoom,
          collapseWeekends
        );
        if (newEndX - origStartX < minWidth) return;
        const newEnd = prevBusinessDay(
          xToDate(newEndX, timelineStart, colWidth, zoom, collapseWeekends)
        );
        let newEndStr = format(newEnd, 'yyyy-MM-dd');
        // Enforce minimum 1-day duration
        if (newEndStr < dragRef.current.origStartDate) {
          newEndStr = dragRef.current.origStartDate;
        }
        const newDuration = taskDuration(dragRef.current.origStartDate, newEndStr);
        if (newDuration < 1) return;

        // Skip if end date hasn't changed
        if (newEndStr === dragRef.current.lastEndDate) return;
        dragRef.current.lastEndDate = newEndStr;

        // Broadcast drag intent (throttled 100ms)
        broadcastDragIntent(dragRef.current);
      }
    },
    [
      startDate,
      timelineStart,
      colWidth,
      zoom,
      collapseWeekends,
      earliestStart,
      dayPx,
      minWidth,
      broadcastDragIntent,
    ]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      (e.target as Element).releasePointerCapture(e.pointerId);

      const finalTask = dragRef.current;
      dragRef.current = null;

      // Clear CSS transform
      if (gRef.current) {
        gRef.current.style.transform = '';
      }

      // Clear awareness drag intent
      if (awareness) {
        setDragIntent(awareness, null);
      }

      // Only commit if the task actually moved
      const moved =
        finalTask.lastStartDate !== finalTask.origStartDate ||
        finalTask.lastEndDate !== finalTask.origEndDate;
      if (moved) {
        if (finalTask.mode === 'move') {
          mutate({
            type: 'MOVE_TASK',
            taskId,
            newStart: finalTask.lastStartDate,
            newEnd: finalTask.lastEndDate,
          });
        } else {
          mutate({
            type: 'RESIZE_TASK',
            taskId,
            newEnd: finalTask.lastEndDate,
          });
        }
      }
    },
    [mutate, taskId, awareness]
  );

  const handleLostPointerCapture = useCallback(() => {
    // Safety net: browser stole capture (e.g. alert dialog, permission prompt)
    if (!dragRef.current) return;
    dragRef.current = null;
    if (gRef.current) {
      gRef.current.style.transform = '';
    }
    if (awareness) {
      setDragIntent(awareness, null);
    }
  }, [awareness]);

  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPopoverPos({ x: e.clientX, y: e.clientY });
  }, []);

  // Build owner/area/okrs subtitle
  const subtitleParts: string[] = [];
  if (showOwner && owner) subtitleParts.push(owner);
  if (showArea && functionalArea) subtitleParts.push(functionalArea);
  if (showOkrs && okrs && okrs.length > 0) subtitleParts.push(okrs.join(', '));
  const subtitle = subtitleParts.join(' \u00B7 ');

  const tooltipContent = (
    <div className="space-y-1">
      <div className="font-semibold text-text-primary">{taskName}</div>
      <div className="text-text-secondary">
        {startDate} - {endDate}
      </div>
      <div className="text-text-secondary">{done ? 'Done' : 'In progress'}</div>
      {notes && <div className="text-text-muted text-xs italic">{notes}</div>}
      {conflictMessage && <div className="text-red-400 text-xs font-medium">{conflictMessage}</div>}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} delay={300} svg>
      <g
        ref={gRef}
        opacity={done ? 0.4 : 1}
        onMouseEnter={() => awareness && updateViewingTask(awareness, taskId, null)}
        onMouseLeave={() => awareness && updateViewingTask(awareness, null, null)}
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
        {/* Conflict indicator outline */}
        {conflictMessage && (
          <rect
            data-testid="conflict-outline"
            x={x - 2}
            y={barY - 2}
            width={Math.max(width, 4) + 4}
            height={barHeight + 4}
            rx={6}
            fill="none"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="4 2"
            opacity={0.9}
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
          data-testid={`task-bar-${taskId}`}
          data-critical={isCritical ? 'true' : undefined}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => handlePointerDown(e, 'move')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLostPointerCapture={handleLostPointerCapture}
          onDoubleClick={handleDoubleClick}
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
          data-testid={`task-bar-${taskId}`}
          data-critical={isCritical ? 'true' : undefined}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => handlePointerDown(e, 'move')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLostPointerCapture={handleLostPointerCapture}
          onDoubleClick={handleDoubleClick}
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
        {/* Conflict warning icon */}
        {conflictMessage && (
          <Tooltip
            content={<div className="text-red-300 text-xs">{conflictMessage}</div>}
            delay={100}
            svg
          >
            <g data-testid="conflict-indicator" style={{ cursor: 'default' }}>
              <circle
                cx={x + Math.max(width, 4) + 10}
                cy={barY + barHeight / 2}
                r={8}
                fill="#ef4444"
                opacity={0.9}
              />
              <text
                x={x + Math.max(width, 4) + 10}
                y={barY + barHeight / 2 + 1}
                fontSize={11}
                fill="white"
                textAnchor="middle"
                dominantBaseline="middle"
                fontWeight={700}
                style={{ pointerEvents: 'none' }}
              >
                !
              </text>
            </g>
          </Tooltip>
        )}
        {/* Right resize handle */}
        <rect
          x={x + Math.max(width, 4) - 6}
          y={barY}
          width={6}
          height={barHeight}
          fill="transparent"
          className="resize-handle"
          data-testid={`resize-handle-${taskId}`}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => handlePointerDown(e, 'resize')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLostPointerCapture={handleLostPointerCapture}
        />
      </g>
      {popoverPos && (
        <foreignObject x={0} y={0} width={1} height={1} overflow="visible">
          <TaskBarPopover
            taskId={taskId}
            position={popoverPos}
            onClose={() => setPopoverPos(null)}
          />
        </foreignObject>
      )}
    </Tooltip>
  );
}
