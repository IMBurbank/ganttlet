import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, isWeekend, addBusinessDays, isSameDay } from 'date-fns';
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

export function daysBetween(start: string, end: string): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start));
}

export function addDaysToDate(dateStr: string, days: number): string {
  return formatDate(addDays(parseISO(dateStr), days));
}

export function addBusinessDaysToDate(dateStr: string, days: number): string {
  return formatDate(addBusinessDays(parseISO(dateStr), days));
}

export function getTimelineRange(tasks: Array<{ startDate: string; endDate: string }>): { start: Date; end: Date } {
  if (tasks.length === 0) {
    const now = new Date();
    return { start: now, end: addDays(now, 90) };
  }
  const starts = tasks.map(t => parseISO(t.startDate));
  const ends = tasks.map(t => parseISO(t.endDate));
  const minStart = new Date(Math.min(...starts.map(d => d.getTime())));
  const maxEnd = new Date(Math.max(...ends.map(d => d.getTime())));
  return {
    start: addDays(minStart, -7),
    end: addDays(maxEnd, 14),
  };
}

export function getColumnWidth(zoom: ZoomLevel): number {
  switch (zoom) {
    case 'day': return 36;
    case 'week': return 100;
    case 'month': return 180;
  }
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

export function dateToX(dateStr: string, timelineStart: Date, colWidth: number, zoom: ZoomLevel): number {
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

export function xToDate(x: number, timelineStart: Date, colWidth: number, zoom: ZoomLevel): Date {
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
    case 'day': return format(date, 'd');
    case 'week': return format(date, 'MMM d');
    case 'month': return format(date, 'MMM yyyy');
  }
}

export function formatTimelineSubHeader(date: Date, zoom: ZoomLevel): string {
  switch (zoom) {
    case 'day': return format(date, 'EEE');
    case 'week': return '';
    case 'month': return '';
  }
}

export function getMonthLabel(date: Date): string {
  return format(date, 'MMMM yyyy');
}
