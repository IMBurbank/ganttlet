import { describe, it, expect } from 'vitest';
import {
  parseDate,
  formatDate,
  daysBetween,
  addDaysToDate,
  getTimelineRange,
  getColumnWidth,
  dateToX,
  xToDate,
} from '../dateUtils';

describe('dateUtils', () => {
  describe('parseDate', () => {
    it('parses ISO date string', () => {
      const d = parseDate('2026-03-15');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2); // March = 2
      expect(d.getDate()).toBe(15);
    });
  });

  describe('formatDate', () => {
    it('formats date to yyyy-MM-dd', () => {
      const d = new Date(2026, 2, 15); // March 15, 2026
      expect(formatDate(d)).toBe('2026-03-15');
    });
  });

  describe('daysBetween', () => {
    it('returns correct number of days', () => {
      expect(daysBetween('2026-03-01', '2026-03-11')).toBe(10);
    });

    it('returns 0 for same date', () => {
      expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    });

    it('returns negative for reversed dates', () => {
      expect(daysBetween('2026-03-11', '2026-03-01')).toBe(-10);
    });
  });

  describe('addDaysToDate', () => {
    it('adds positive days', () => {
      expect(addDaysToDate('2026-03-01', 10)).toBe('2026-03-11');
    });

    it('adds negative days', () => {
      expect(addDaysToDate('2026-03-11', -10)).toBe('2026-03-01');
    });
  });

  describe('getTimelineRange', () => {
    it('returns range with padding', () => {
      const tasks = [
        { startDate: '2026-03-01', endDate: '2026-03-15' },
        { startDate: '2026-03-10', endDate: '2026-04-01' },
      ];
      const range = getTimelineRange(tasks);
      // Start should be 7 days before earliest start
      expect(range.start < new Date('2026-03-01')).toBe(true);
      // End should be 14 days after latest end
      expect(range.end > new Date('2026-04-01')).toBe(true);
    });

    it('returns default range for empty tasks', () => {
      const range = getTimelineRange([]);
      expect(range.start).toBeInstanceOf(Date);
      expect(range.end).toBeInstanceOf(Date);
    });
  });

  describe('getColumnWidth', () => {
    it('returns correct widths for each zoom level', () => {
      expect(getColumnWidth('day')).toBe(36);
      expect(getColumnWidth('week')).toBe(100);
      expect(getColumnWidth('month')).toBe(180);
    });
  });

  describe('dateToX / xToDate roundtrip', () => {
    it('converts date to x and back for day zoom', () => {
      const timelineStart = new Date('2026-03-01');
      const colWidth = 36;
      const x = dateToX('2026-03-11', timelineStart, colWidth, 'day');
      const backDate = xToDate(x, timelineStart, colWidth, 'day');
      expect(formatDate(backDate)).toBe('2026-03-11');
    });
  });
});
