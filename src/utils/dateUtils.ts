import {
  addDays,
  differenceInCalendarDays,
  differenceInBusinessDays,
  format,
  parseISO,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  isWeekend,
  addBusinessDays,
  isSameDay,
} from 'date-fns';
import type { ZoomLevel } from '../types';

export function parseDate(dateStr: string): Date {
  return parseISO(dateStr);
}

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatDisplayDate(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d');
}

/**
 * Returns the number of calendar days between two date strings.
 * Used for cascade deltas (relative positioning), NOT for duration.
 * For duration, use taskDuration() instead.
 */
export function daysBetween(start: string, end: string): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start));
}

export function addDaysToDate(dateStr: string, days: number): string {
  return formatDate(addDays(parseISO(dateStr), days));
}

/**
 * Signed business-day difference between two date strings.
 * Used for cascade deltas so shifts skip weekends.
 */
export function businessDaysDelta(start: string, end: string): number {
  return differenceInBusinessDays(parseISO(end), parseISO(start));
}

export function getTimelineRange(tasks: Array<{ startDate: string; endDate: string }>): {
  start: Date;
  end: Date;
} {
  if (tasks.length === 0) {
    const now = new Date();
    return { start: now, end: addDays(now, 90) };
  }
  const starts = tasks.map((t) => parseISO(t.startDate));
  const ends = tasks.map((t) => parseISO(t.endDate));
  const minStart = new Date(Math.min(...starts.map((d) => d.getTime())));
  const maxEnd = new Date(Math.max(...ends.map((d) => d.getTime())));
  return {
    start: addDays(minStart, -7),
    end: addDays(maxEnd, 14),
  };
}

export function getColumnWidth(zoom: ZoomLevel): number {
  switch (zoom) {
    case 'day':
      return 36;
    case 'week':
      return 100;
    case 'month':
      return 180;
  }
}

/**
 * Pixel width of a single calendar day at the given zoom level.
 * Day zoom: 1 column = 1 day, so dayPx = colWidth.
 * Week zoom: 1 column = 7 days, so dayPx = colWidth / 7.
 * Month zoom: 1 column = 30 days, so dayPx = colWidth / 30.
 */
export function getDayPx(zoom: ZoomLevel): number {
  const colWidth = getColumnWidth(zoom);
  return zoom === 'day' ? colWidth : zoom === 'week' ? colWidth / 7 : colWidth / 30;
}

export function getTimelineDays(start: Date, end: Date): Date[] {
  return eachDayOfInterval({ start, end });
}

export function getTimelineWeeks(start: Date, end: Date): Date[] {
  return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
}

export function getTimelineMonths(start: Date, end: Date): Date[] {
  return eachMonthOfInterval({ start, end });
}

export function isWeekendDay(date: Date): boolean {
  return isWeekend(date);
}

export function isSameDayCheck(d1: Date, d2: Date): boolean {
  return isSameDay(d1, d2);
}

function dateToXCalendar(
  dateStr: string,
  timelineStart: Date,
  colWidth: number,
  zoom: ZoomLevel
): number {
  const date = parseISO(dateStr);
  const daysDiff = differenceInCalendarDays(date, timelineStart);
  if (zoom === 'day') {
    return daysDiff * colWidth;
  } else if (zoom === 'week') {
    return (daysDiff / 7) * colWidth;
  } else {
    return (daysDiff / 30) * colWidth;
  }
}

function xToDateCalendar(x: number, timelineStart: Date, colWidth: number, zoom: ZoomLevel): Date {
  let daysDiff: number;
  if (zoom === 'day') {
    daysDiff = Math.round(x / colWidth);
  } else if (zoom === 'week') {
    daysDiff = Math.round((x / colWidth) * 7);
  } else {
    daysDiff = Math.round((x / colWidth) * 30);
  }
  return addDays(timelineStart, daysDiff);
}

export function formatTimelineHeader(date: Date, zoom: ZoomLevel): string {
  switch (zoom) {
    case 'day':
      return format(date, 'd');
    case 'week':
      return format(date, 'MMM d');
    case 'month':
      return format(date, 'MMM yyyy');
  }
}

export function formatTimelineSubHeader(date: Date, zoom: ZoomLevel): string {
  switch (zoom) {
    case 'day':
      return format(date, 'EEE');
    case 'week':
      return '';
    case 'month':
      return '';
  }
}

export function getMonthLabel(date: Date): string {
  return format(date, 'MMMM yyyy');
}

/** @internal — pixel mapping only. For duration, use taskDuration. */
function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    if (!isWeekend(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/** Date to X position, skipping weekends when collapseWeekends is true and zoom is 'day'. */
export function dateToX(
  dateStr: string,
  timelineStart: Date,
  colWidth: number,
  zoom: ZoomLevel,
  collapseWeekends: boolean = false
): number {
  if (!collapseWeekends || zoom !== 'day')
    return dateToXCalendar(dateStr, timelineStart, colWidth, zoom);
  const date = parseISO(dateStr);
  return businessDaysBetween(timelineStart, date) * colWidth;
}

/** Inverse: x to date, skipping weekends when collapseWeekends is true and zoom is 'day'. */
export function xToDate(
  x: number,
  timelineStart: Date,
  colWidth: number,
  zoom: ZoomLevel,
  collapseWeekends: boolean = false
): Date {
  if (!collapseWeekends || zoom !== 'day') return xToDateCalendar(x, timelineStart, colWidth, zoom);
  const bizDays = Math.round(x / colWidth);
  let count = 0;
  const current = new Date(timelineStart);
  while (count < bizDays) {
    current.setDate(current.getDate() + 1);
    if (!isWeekend(current)) count++;
  }
  return current;
}

/** Get timeline days, optionally filtering out weekends. */
export function getTimelineDaysFiltered(start: Date, end: Date, collapseWeekends: boolean): Date[] {
  const all = eachDayOfInterval({ start, end });
  return collapseWeekends ? all.filter((d) => !isWeekend(d)) : all;
}

/**
 * Inclusive business day count: [start, end] counting both endpoints.
 * A same-day task has duration 1. Uses date-fns differenceInBusinessDays.
 */
export function taskDuration(start: string, end: string): number {
  return differenceInBusinessDays(parseISO(end), parseISO(start)) + 1;
}

/**
 * Derive end date from start + duration using inclusive convention.
 * taskEndDate(start, 1) returns start (same-day task).
 */
export function taskEndDate(start: string, duration: number): string {
  return format(addBusinessDays(parseISO(start), duration - 1), 'yyyy-MM-dd');
}

/**
 * Snap forward to next Monday if date is a weekend. No-op if already a weekday.
 */
export function ensureBusinessDay(date: Date): Date {
  const day = date.getDay();
  if (day === 0) return addDays(date, 1); // Sunday → Monday
  if (day === 6) return addDays(date, 2); // Saturday → Monday
  return date;
}

/**
 * Snap backward to previous Friday if date is a weekend. No-op if already a weekday.
 */
export function prevBusinessDay(date: Date): Date {
  const day = date.getDay();
  if (day === 0) return addDays(date, -2); // Sunday → Friday
  if (day === 6) return addDays(date, -1); // Saturday → Friday
  return date;
}

/**
 * Check if a date string falls on a weekend. For validation use.
 */
export function isWeekendDate(dateStr: string): boolean {
  return isWeekend(parseISO(dateStr));
}

/**
 * Returns task with duration recomputed from dates.
 */
export function withDuration<T extends { startDate: string; endDate: string }>(
  task: T
): T & { duration: number } {
  return { ...task, duration: taskDuration(task.startDate, task.endDate) };
}
