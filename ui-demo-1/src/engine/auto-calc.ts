import { startOfDay } from 'date-fns';
import { getEndDate, getStartDate, workingDaysBetween } from './date-utils';

/**
 * Given any two of {startDate, endDate, duration}, calculate the third.
 * Returns a complete set of all three.
 */
export function autoCalc(
  startDate: Date | null,
  endDate: Date | null,
  duration: number | null
): { startDate: Date; endDate: Date; duration: number } {
  if (startDate && endDate && duration === null) {
    const s = startOfDay(startDate);
    const e = startOfDay(endDate);
    return { startDate: s, endDate: e, duration: Math.max(1, workingDaysBetween(s, e)) };
  }

  if (startDate && duration !== null && !endDate) {
    const s = startOfDay(startDate);
    return { startDate: s, endDate: getEndDate(s, duration), duration };
  }

  if (endDate && duration !== null && !startDate) {
    const e = startOfDay(endDate);
    return { startDate: getStartDate(e, duration), endDate: e, duration };
  }

  if (startDate && endDate && duration !== null) {
    // All three provided — trust start + duration, recalculate end
    const s = startOfDay(startDate);
    return { startDate: s, endDate: getEndDate(s, duration), duration };
  }

  // Fallback: use today
  const now = startOfDay(new Date());
  const d = duration ?? 5;
  return { startDate: now, endDate: getEndDate(now, d), duration: d };
}
