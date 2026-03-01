import type { Task, Dependency, ZoomLevel } from '../types';
import { dateToX, daysBetween } from './dateUtils';

interface Point { x: number; y: number; }

export function getDependencyPoints(
  dep: Dependency,
  fromTask: Task,
  toTask: Task,
  taskYPositions: Map<string, number>,
  timelineStart: Date,
  colWidth: number,
  zoom: ZoomLevel,
  rowHeight: number,
): { start: Point; end: Point } | null {
  const fromY = taskYPositions.get(dep.fromId);
  const toY = taskYPositions.get(dep.toId);
  if (fromY === undefined || toY === undefined) return null;

  const fromStartX = dateToX(fromTask.startDate, timelineStart, colWidth, zoom);
  const fromEndX = dateToX(fromTask.endDate, timelineStart, colWidth, zoom);
  const toStartX = dateToX(toTask.startDate, timelineStart, colWidth, zoom);
  const toEndX = dateToX(toTask.endDate, timelineStart, colWidth, zoom);
  const midRow = rowHeight / 2;

  let start: Point;
  let end: Point;

  switch (dep.type) {
    case 'FS':
      start = { x: fromEndX, y: fromY + midRow };
      end = { x: toStartX, y: toY + midRow };
      break;
    case 'FF':
      start = { x: fromEndX, y: fromY + midRow };
      end = { x: toEndX, y: toY + midRow };
      break;
    case 'SS':
      start = { x: fromStartX, y: fromY + midRow };
      end = { x: toStartX, y: toY + midRow };
      break;
    case 'SF':
      start = { x: fromStartX, y: fromY + midRow };
      end = { x: toEndX, y: toY + midRow };
      break;
  }

  return { start, end };
}

export function createBezierPath(start: Point, end: Point): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const minOffset = 20;

  if (dx > minOffset) {
    const cx = dx * 0.4;
    return `M ${start.x} ${start.y} C ${start.x + cx} ${start.y}, ${end.x - cx} ${end.y}, ${end.x} ${end.y}`;
  }

  // Need to route around - go right, down/up, then left to target
  const offset = minOffset;
  const midY = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} ` +
    `L ${start.x + offset} ${start.y} ` +
    `Q ${start.x + offset + 8} ${start.y}, ${start.x + offset + 8} ${start.y + (dy > 0 ? 8 : -8)} ` +
    `L ${start.x + offset + 8} ${midY} ` +
    `L ${end.x - offset - 8} ${midY} ` +
    `L ${end.x - offset - 8} ${end.y + (dy > 0 ? -8 : 8)} ` +
    `Q ${end.x - offset - 8} ${end.y}, ${end.x - offset} ${end.y} ` +
    `L ${end.x} ${end.y}`;
}

export function createArrowHead(end: Point): string {
  const size = 5;
  return `M ${end.x} ${end.y} L ${end.x - size} ${end.y - size} L ${end.x - size} ${end.y + size} Z`;
}

export function cascadeDependents(
  tasks: Task[],
  movedTaskId: string,
  daysDelta: number,
): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));
  const visited = new Set<string>();

  function cascade(taskId: string, delta: number) {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    // Find all tasks that depend on this task
    for (const [, task] of taskMap) {
      for (const dep of task.dependencies) {
        if (dep.fromId === taskId) {
          const dependent = taskMap.get(task.id);
          if (!dependent || dependent.isSummary) continue;

          const startDate = new Date(dependent.startDate);
          const endDate = new Date(dependent.endDate);
          startDate.setDate(startDate.getDate() + delta);
          endDate.setDate(endDate.getDate() + delta);
          dependent.startDate = startDate.toISOString().split('T')[0];
          dependent.endDate = endDate.toISOString().split('T')[0];

          cascade(task.id, delta);
        }
      }
    }
  }

  cascade(movedTaskId, daysDelta);
  return Array.from(taskMap.values());
}
