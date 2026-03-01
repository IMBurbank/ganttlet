import { addDays, differenceInCalendarDays, isWeekend, startOfDay } from 'date-fns';

/**
 * Add working days to a date (skips weekends).
 */
export function addWorkingDays(date: Date, days: number): Date {
  let current = startOfDay(date);
  let remaining = Math.abs(days);
  const direction = days >= 0 ? 1 : -1;

  while (remaining > 0) {
    current = addDays(current, direction);
    if (!isWeekend(current)) {
      remaining--;
    }
  }
  return current;
}

/**
 * Count working days between two dates (exclusive of end date).
 */
export function workingDaysBetween(start: Date, end: Date): number {
  const s = startOfDay(start);
  const e = startOfDay(end);
  const totalDays = differenceInCalendarDays(e, s);
  let workDays = 0;
  const dir = totalDays >= 0 ? 1 : -1;

  for (let i = dir; Math.abs(i) <= Math.abs(totalDays); i += dir) {
    const d = addDays(s, i);
    if (!isWeekend(d)) {
      workDays += dir;
    }
  }
  return workDays;
}

/**
 * Get the end date given a start date and a duration in working days.
 */
export function getEndDate(startDate: Date, durationDays: number): Date {
  if (durationDays <= 0) return startOfDay(startDate);
  return addWorkingDays(startDate, durationDays);
}

/**
 * Get the start date given an end date and a duration in working days.
 */
export function getStartDate(endDate: Date, durationDays: number): Date {
  if (durationDays <= 0) return startOfDay(endDate);
  return addWorkingDays(endDate, -durationDays);
}

/**
 * Ensure a date is a working day. If it falls on a weekend, move to Monday.
 */
export function ensureWorkingDay(date: Date): Date {
  let d = startOfDay(date);
  while (isWeekend(d)) {
    d = addDays(d, 1);
  }
  return d;
}
