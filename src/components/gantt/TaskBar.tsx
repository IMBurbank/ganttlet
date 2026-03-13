import React, { useRef, useCallback, useState } from 'react';
import type { ZoomLevel } from '../../types';
import {
  useGanttDispatch,
  useLocalDispatch,
  useActiveDrag,
  useAwareness,
  useSetViewingTask,
} from '../../state/GanttContext';
import { setDragIntent } from '../../collab/awareness';
import {
  dateToXCollapsed,
  xToDateCollapsed,
  formatDate,
  daysBetween,
  businessDaysDelta,
  getColumnWidth,
  ensureBusinessDay,
  prevBusinessDay,
  taskDuration,
} from '../../utils/dateUtils';
import { parseISO, format } from 'date-fns';
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
}: TaskBarProps) {
  const dispatch = useGanttDispatch();
  const localDispatch = useLocalDispatch();
  const activeDragRef = useActiveDrag();
  const awareness = useAwareness();
  const setViewingTask = useSetViewingTask();
  const dragRef = useRef<{
    startX: number;
    origStartDate: string;
    origEndDate: string;
    mode: 'move' | 'resize';
    lastStartDate: string;
    lastEndDate: string;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastCrdtBroadcast = useRef<number>(0);
  const clipId = useRef(`task-clip-${++clipIdCounter}`);

  const barHeight = 28;
  const barY = y + (rowHeight - barHeight) / 2;
  const colWidth = getColumnWidth(zoom);
  const minWidth = colWidth * 0.5;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: 'move' | 'resize') => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        startX: e.clientX,
        origStartDate: startDate,
        origEndDate: endDate,
        mode,
        lastStartDate: startDate,
        lastEndDate: endDate,
      };
      activeDragRef.current = taskId;

      function onMouseMove(ev: MouseEvent) {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;

        if (dragRef.current.mode === 'move') {
          let newStart = ensureBusinessDay(
            xToDateCollapsed(
              dateToXCollapsed(
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
          let clampedDx = dx;
          if (earliestStart && newStartStr < earliestStart) {
            newStartStr = earliestStart;
            newStart = parseISO(earliestStart);
            // Recompute the effective dx so end shifts by the same clamped amount
            clampedDx =
              dateToXCollapsed(earliestStart, timelineStart, colWidth, zoom, collapseWeekends) -
              dateToXCollapsed(
                dragRef.current.origStartDate,
                timelineStart,
                colWidth,
                zoom,
                collapseWeekends
              );
          }

          // Shift end by same (possibly clamped) pixel delta as start to preserve visual width
          const newEnd = prevBusinessDay(
            xToDateCollapsed(
              dateToXCollapsed(
                dragRef.current.origEndDate,
                timelineStart,
                colWidth,
                zoom,
                collapseWeekends
              ) + clampedDx,
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

          const moveAction = {
            type: 'MOVE_TASK' as const,
            taskId,
            newStartDate: newStartStr,
            newEndDate: newEndStr,
          };

          // RAF-throttled local render
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            localDispatch(moveAction);
            rafRef.current = null;
          });

          // 100ms-throttled CRDT broadcast + drag intent
          const now = performance.now();
          if (now - lastCrdtBroadcast.current >= 100) {
            lastCrdtBroadcast.current = now;
            // Cancel pending RAF to avoid double render — dispatch() updates React state directly
            if (rafRef.current) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            dispatch(moveAction);
            if (awareness)
              setDragIntent(awareness, { taskId, startDate: newStartStr, endDate: newEndStr });
          }
        } else {
          const newEndX =
            dateToXCollapsed(
              dragRef.current.origEndDate,
              timelineStart,
              colWidth,
              zoom,
              collapseWeekends
            ) + dx;
          const origStartX = dateToXCollapsed(
            dragRef.current.origStartDate,
            timelineStart,
            colWidth,
            zoom,
            collapseWeekends
          );
          if (newEndX - origStartX < minWidth) return;
          const newEnd = prevBusinessDay(
            xToDateCollapsed(newEndX, timelineStart, colWidth, zoom, collapseWeekends)
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

          const resizeAction = {
            type: 'RESIZE_TASK' as const,
            taskId,
            newEndDate: newEndStr,
            newDuration,
          };

          // RAF-throttled local render
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            localDispatch(resizeAction);
            rafRef.current = null;
          });

          // 100ms-throttled CRDT broadcast + drag intent
          const now = performance.now();
          if (now - lastCrdtBroadcast.current >= 100) {
            lastCrdtBroadcast.current = now;
            if (rafRef.current) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            dispatch(resizeAction);
            if (awareness)
              setDragIntent(awareness, {
                taskId,
                startDate: dragRef.current!.origStartDate,
                endDate: newEndStr,
              });
          }
        }
      }

      function onMouseUp() {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        // Clear drag guard before COMPLETE_DRAG dispatch. Safe because applyActionToYjs
        // sets isLocalUpdate=true, so the Yjs observer won't echo back a SET_TASKS.
        activeDragRef.current = null;
        if (awareness) setDragIntent(awareness, null);
        if (dragRef.current) {
          const finalTask = dragRef.current;
          dragRef.current = null;
          const daysDelta =
            finalTask.mode === 'move'
              ? businessDaysDelta(finalTask.origStartDate, finalTask.lastStartDate)
              : businessDaysDelta(finalTask.origEndDate, finalTask.lastEndDate);
          // Atomic: set final position + cascade in one dispatch
          dispatch({
            type: 'COMPLETE_DRAG',
            taskId,
            newStartDate: finalTask.lastStartDate,
            newEndDate: finalTask.lastEndDate,
            daysDelta,
          });
        }
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [
      dispatch,
      localDispatch,
      activeDragRef,
      awareness,
      taskId,
      startDate,
      endDate,
      timelineStart,
      colWidth,
      zoom,
      minWidth,
      collapseWeekends,
      earliestStart,
    ]
  );

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
        {/* Conflict indicator outline */}
        {conflictMessage && (
          <rect
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
          onMouseDown={(e) => handleMouseDown(e, 'move')}
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
          onMouseDown={(e) => handleMouseDown(e, 'move')}
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
            <g style={{ cursor: 'default' }}>
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
          onMouseDown={(e) => handleMouseDown(e, 'resize')}
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
