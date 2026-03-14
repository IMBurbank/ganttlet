import type { Task, Dependency, DependencyType, ZoomLevel } from '../types';
import { dateToX } from './dateUtils';

interface Point {
  x: number;
  y: number;
}

// Stub offset so arrows don't overlap the bar edges
const STUB = 12;

export function getDependencyPoints(
  dep: Dependency,
  fromTask: Task,
  toTask: Task,
  taskYPositions: Map<string, number>,
  timelineStart: Date,
  colWidth: number,
  zoom: ZoomLevel,
  rowHeight: number,
  collapseWeekends: boolean = false
): { start: Point; end: Point } | null {
  const fromY = taskYPositions.get(dep.fromId);
  const toY = taskYPositions.get(dep.toId);
  if (fromY === undefined || toY === undefined) return null;

  // dayPx = pixel width of a single day at the current zoom level
  const dayPx = zoom === 'day' ? colWidth : zoom === 'week' ? colWidth / 7 : colWidth / 30;
  const fromStartX = dateToX(fromTask.startDate, timelineStart, colWidth, zoom, collapseWeekends);
  const fromEndX =
    dateToX(fromTask.endDate, timelineStart, colWidth, zoom, collapseWeekends) + dayPx;
  const toStartX = dateToX(toTask.startDate, timelineStart, colWidth, zoom, collapseWeekends);
  const toEndX = dateToX(toTask.endDate, timelineStart, colWidth, zoom, collapseWeekends) + dayPx;
  const midRow = rowHeight / 2;

  let start: Point;
  let end: Point;

  // Add stub offsets to clear the bar edges
  switch (dep.type) {
    case 'FS':
      start = { x: fromEndX + STUB, y: fromY + midRow };
      end = { x: toStartX - STUB, y: toY + midRow };
      break;
    case 'FF':
      start = { x: fromEndX + STUB, y: fromY + midRow };
      end = { x: toEndX + STUB, y: toY + midRow };
      break;
    case 'SS':
      start = { x: fromStartX - STUB, y: fromY + midRow };
      end = { x: toStartX - STUB, y: toY + midRow };
      break;
    case 'SF':
      start = { x: fromStartX - STUB, y: fromY + midRow };
      end = { x: toEndX + STUB, y: toY + midRow };
      break;
  }

  return { start, end };
}

export function createBezierPath(start: Point, end: Point, depType?: DependencyType): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // For types that exit and enter on the same side (FF, SS), or when
  // the endpoint is behind the start, we need a different routing strategy.
  const sameDirection = depType === 'FF' || depType === 'SS';

  if (!sameDirection && dx > 10) {
    // Simple forward curve - smooth bezier between start and end stub points
    const cx = Math.min(dx * 0.4, 60);
    return `M ${start.x} ${start.y} C ${start.x + cx} ${start.y}, ${end.x - cx} ${end.y}, ${end.x} ${end.y}`;
  }

  if (sameDirection) {
    // Both stubs point the same direction - route out, across, then back
    const outset = 20;
    // For FF: both stubs go right; for SS: both stubs go left
    const dir = depType === 'FF' ? 1 : -1;
    const peakX =
      Math.max(start.x, end.x) * dir > 0
        ? Math.max(start.x, end.x) + outset
        : Math.min(start.x, end.x) - outset;
    const farX =
      depType === 'FF' ? Math.max(start.x, end.x) + outset : Math.min(start.x, end.x) - outset;
    const r = 6;
    const dirY = dy > 0 ? 1 : dy < 0 ? -1 : 1;

    return (
      `M ${start.x} ${start.y} ` +
      `L ${farX - r * dir} ${start.y} ` +
      `Q ${farX} ${start.y}, ${farX} ${start.y + r * dirY} ` +
      `L ${farX} ${end.y - r * dirY} ` +
      `Q ${farX} ${end.y}, ${farX - r * dir} ${end.y} ` +
      `L ${end.x} ${end.y}`
    );
  }

  // Backward path: end is behind start, need S-curve routing
  // FS: start stub goes right, end stub goes left
  // SF: start stub goes left, end stub goes right (reversed)
  const r = 6;
  const dirY = dy > 0 ? 1 : dy < 0 ? -1 : 1;
  const outset = 16;
  const isSF = depType === 'SF';
  const outX = isSF ? start.x - outset : start.x + outset;
  const inX = isSF ? end.x + outset : end.x - outset;
  const midY = (start.y + end.y) / 2;
  const dirOut = isSF ? -1 : 1;
  const dirIn = isSF ? 1 : -1;

  return (
    `M ${start.x} ${start.y} ` +
    `L ${outX - r * dirOut} ${start.y} ` +
    `Q ${outX} ${start.y}, ${outX} ${start.y + r * dirY} ` +
    `L ${outX} ${midY - r * dirY} ` +
    `Q ${outX} ${midY}, ${outX - r * dirOut} ${midY} ` +
    `L ${inX - r * dirIn} ${midY} ` +
    `Q ${inX} ${midY}, ${inX} ${midY + r * dirY} ` +
    `L ${inX} ${end.y - r * dirY} ` +
    `Q ${inX} ${end.y}, ${inX - r * dirIn} ${end.y} ` +
    `L ${end.x} ${end.y}`
  );
}

export function createArrowHead(end: Point, depType?: DependencyType): string {
  const size = 5;
  // The path line terminates at `end`. The arrowhead tip should extend
  // BEYOND `end` toward the target bar, with the base at `end` connecting
  // to the incoming line.
  if (depType === 'FF' || depType === 'SF') {
    // Tip points left (toward bar end), base at end.x
    return `M ${end.x - size} ${end.y} L ${end.x} ${end.y - size} L ${end.x} ${end.y + size} Z`;
  }
  // Tip points right (toward bar start), base at end.x (FS, SS, or default)
  return `M ${end.x + size} ${end.y} L ${end.x} ${end.y - size} L ${end.x} ${end.y + size} Z`;
}
