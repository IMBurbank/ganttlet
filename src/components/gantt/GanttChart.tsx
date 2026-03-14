import React, { useMemo, useEffect } from 'react';
import { parseISO, isValid } from 'date-fns';
import type { Task, ZoomLevel, ColorByField, Dependency, FakeUser, CollabUser } from '../../types';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import {
  dateToX,
  getTimelineRange,
  getColumnWidth,
  getDayPx,
  getTimelineDays,
  getTimelineDaysFiltered,
  getTimelineWeeks,
  getTimelineMonths,
} from '../../utils/dateUtils';
import { buildTaskYPositions, ROW_HEIGHT } from '../../utils/layoutUtils';
import { getTaskColor } from '../../data/colorPalettes';
import {
  computeCriticalPathScoped,
  computeEarliestStart,
  detectConflicts,
} from '../../utils/schedulerWasm';
import SlackIndicator from './SlackIndicator';
import CascadeHighlight from './CascadeHighlight';
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
  users: FakeUser[];
  collabUsers?: CollabUser[];
  isCollabConnected?: boolean;
  onDependencyClick?: (dep: Dependency, successorId: string) => void;
}

export default function GanttChart({
  visibleTasks,
  allTasks,
  zoom,
  colorBy,
  users,
  collabUsers,
  isCollabConnected,
  onDependencyClick,
}: GanttChartProps) {
  const {
    showOwnerOnBar,
    showAreaOnBar,
    showOkrsOnBar,
    showCriticalPath,
    criticalPathScope,
    collapseWeekends,
    lastCascadeIds,
    cascadeShifts,
  } = useGanttState();
  const dispatch = useGanttDispatch();

  // Auto-clear cascade IDs after 2 seconds
  useEffect(() => {
    if (lastCascadeIds.length > 0) {
      const timer = setTimeout(() => {
        dispatch({ type: 'SET_LAST_CASCADE_IDS', taskIds: [] });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [lastCascadeIds, dispatch]);

  // Auto-clear cascade shifts after 2 seconds
  useEffect(() => {
    if (cascadeShifts.length > 0) {
      const timer = setTimeout(() => {
        dispatch({ type: 'SET_CASCADE_SHIFTS', shifts: [] });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [cascadeShifts, dispatch]);

  const viewingMap = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    if (isCollabConnected && collabUsers && collabUsers.length > 0) {
      collabUsers.forEach((u) => {
        if (u.viewingTaskId) {
          map.set(u.viewingTaskId, { color: u.color, name: u.name });
        }
      });
    } else {
      users.forEach((u) => {
        if (u.viewingTaskId && u.isOnline) {
          map.set(u.viewingTaskId, { color: u.color, name: u.name });
        }
      });
    }
    return map;
  }, [users, collabUsers, isCollabConnected]);

  const criticalPathResult = useMemo(
    () =>
      showCriticalPath
        ? computeCriticalPathScoped(allTasks, criticalPathScope)
        : { taskIds: new Set<string>(), edges: [] as Array<{ fromId: string; toId: string }> },
    [allTasks, showCriticalPath, criticalPathScope]
  );
  const criticalPathIds = criticalPathResult.taskIds;
  const criticalEdges = criticalPathResult.edges;

  const conflictMap = useMemo(() => {
    const conflicts = detectConflicts(allTasks);
    const map = new Map<string, string>();
    for (const c of conflicts) {
      map.set(c.taskId, c.message);
    }
    return map;
  }, [allTasks]);

  const { start: timelineStart, end: timelineEnd } = useMemo(
    () => getTimelineRange(allTasks),
    [allTasks]
  );

  const colWidth = getColumnWidth(zoom);
  const dayPx = getDayPx(zoom);
  const taskYPositions = useMemo(() => buildTaskYPositions(visibleTasks), [visibleTasks]);

  const totalDays = useMemo(() => {
    if (zoom === 'day') {
      return collapseWeekends
        ? getTimelineDaysFiltered(timelineStart, timelineEnd, true).length
        : getTimelineDays(timelineStart, timelineEnd).length;
    }
    if (zoom === 'week') return getTimelineWeeks(timelineStart, timelineEnd).length;
    return getTimelineMonths(timelineStart, timelineEnd).length;
  }, [timelineStart, timelineEnd, zoom, collapseWeekends]);

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
          <TodayLine timelineStart={timelineStart} zoom={zoom} totalHeight={totalHeight} />
          {/* Slack indicators and cascade highlights */}
          {visibleTasks.map((task) => {
            if (task.isSummary || task.isMilestone) return null;
            const yPos = taskYPositions.get(task.id);
            if (yPos === undefined) return null;

            const earliest = computeEarliestStart(allTasks, task.id);
            const taskX = dateToX(task.startDate, timelineStart, colWidth, zoom, collapseWeekends);
            const taskEndX = dateToX(task.endDate, timelineStart, colWidth, zoom, collapseWeekends);
            const taskWidth = Math.max(taskEndX - taskX + dayPx, 0);

            const shift = cascadeShifts.find((s) => s.taskId === task.id);

            return (
              <React.Fragment key={`indicators-${task.id}`}>
                {earliest && (
                  <SlackIndicator
                    earliestX={dateToX(earliest, timelineStart, colWidth, zoom, collapseWeekends)}
                    actualX={taskX}
                    y={yPos}
                    height={ROW_HEIGHT}
                  />
                )}
                {shift && (
                  <CascadeHighlight
                    originalX={dateToX(
                      shift.fromStartDate,
                      timelineStart,
                      colWidth,
                      zoom,
                      collapseWeekends
                    )}
                    currentX={taskX}
                    y={yPos}
                    originalWidth={Math.max(
                      dateToX(shift.fromEndDate, timelineStart, colWidth, zoom, collapseWeekends) -
                        dateToX(
                          shift.fromStartDate,
                          timelineStart,
                          colWidth,
                          zoom,
                          collapseWeekends
                        ) +
                        dayPx,
                      0
                    )}
                    currentWidth={taskWidth}
                    height={ROW_HEIGHT}
                  />
                )}
              </React.Fragment>
            );
          })}
          {/* Render bars */}
          {visibleTasks.map((task) => {
            const yPos = taskYPositions.get(task.id);
            if (yPos === undefined) return null;
            const color = getTaskColor(colorBy, task[colorBy] as string);
            const x = dateToX(task.startDate, timelineStart, colWidth, zoom, collapseWeekends);
            const endX = dateToX(task.endDate, timelineStart, colWidth, zoom, collapseWeekends);
            const width = Math.max(endX - x + dayPx, 0);
            const viewer = viewingMap.get(task.id);
            const earliest = computeEarliestStart(allTasks, task.id);

            if (task.isMilestone) {
              return (
                <MilestoneMarker
                  key={task.id}
                  x={x}
                  y={yPos + ROW_HEIGHT / 2}
                  color={color}
                  size={12}
                  taskName={task.name}
                  isCritical={criticalPathIds.has(task.id)}
                  viewerName={viewer?.name}
                  viewerColor={viewer?.color}
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
                  done={task.done}
                  taskName={task.name}
                  viewerName={viewer?.name}
                  viewerColor={viewer?.color}
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
                done={task.done}
                color={color}
                x={x}
                y={yPos}
                width={width}
                timelineStart={timelineStart}
                zoom={zoom}
                rowHeight={ROW_HEIGHT}
                notes={task.notes}
                owner={task.owner}
                functionalArea={task.functionalArea}
                okrs={task.okrs}
                showOwner={showOwnerOnBar}
                showArea={showAreaOnBar}
                showOkrs={showOkrsOnBar}
                isCritical={criticalPathIds.has(task.id)}
                viewerName={viewer?.name}
                viewerColor={viewer?.color}
                collapseWeekends={collapseWeekends}
                earliestStart={earliest ?? undefined}
                conflictMessage={conflictMap.get(task.id)}
              />
            );
          })}
          {/* Ghost bars for remote drags */}
          {collabUsers
            ?.filter((u) => u.dragging)
            .map((u) => {
              const drag = u.dragging!;
              if (!isValid(parseISO(drag.startDate)) || !isValid(parseISO(drag.endDate)))
                return null;
              const yPos = taskYPositions.get(drag.taskId);
              if (yPos === undefined) return null;
              const gx = dateToX(drag.startDate, timelineStart, colWidth, zoom, collapseWeekends);
              const gEndX = dateToX(drag.endDate, timelineStart, colWidth, zoom, collapseWeekends);
              const gw = Math.max(gEndX - gx + dayPx, 0);
              const barH = 28;
              const barY = yPos + (ROW_HEIGHT - barH) / 2;
              return (
                <g key={`ghost-${u.clientId}`} opacity={0.4}>
                  <rect
                    x={gx}
                    y={barY}
                    width={gw}
                    height={barH}
                    rx={4}
                    fill={u.color}
                    stroke={u.color}
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                  />
                  <text x={gx + 4} y={Math.max(barY - 4, 10)} fontSize={9} fill={u.color}>
                    {u.name}
                  </text>
                </g>
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
            onArrowClick={onDependencyClick}
            criticalPathIds={criticalPathIds}
            criticalEdges={criticalEdges}
            collapseWeekends={collapseWeekends}
          />
        </svg>
      </div>
    </div>
  );
}
