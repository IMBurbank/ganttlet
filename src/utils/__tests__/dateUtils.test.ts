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
  dateToXCollapsed,
  xToDateCollapsed,
  businessDaysBetween,
  workingDaysBetween,
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

  describe('duration should be business days, not calendar days', () => {
    it('daysBetween counts calendar days (still used for cascade delta)', () => {
      expect(daysBetween('2026-03-06', '2026-03-10')).toBe(4);
    });

    it('businessDaysBetween counts only weekdays (used for pixel mapping)', () => {
      // Mar 6 (Fri) to Mar 10 (Tue): Fri, [Sat, Sun], Mon = 2 business days
      expect(businessDaysBetween(new Date('2026-03-06'), new Date('2026-03-10'))).toBe(2);
    });

    it('Mar 6 (Fri) to Mar 10 (Tue) = 2 working days (Fri, Mon)', () => {
      // Start-inclusive, end-exclusive: Fri(1), [Sat skip], [Sun skip], Mon(2)
      expect(workingDaysBetween('2026-03-06', '2026-03-10')).toBe(2);
    });
  });

  describe('move-drag must preserve visual width with collapsed weekends', () => {
    const timelineStart = new Date('2026-03-02'); // Monday
    const colWidth = 36;
    const zoom = 'day' as const;

    function getVisualWidth(start: string, end: string): number {
      const startX = dateToXCollapsed(start, timelineStart, colWidth, zoom, true);
      const endX = dateToXCollapsed(end, timelineStart, colWidth, zoom, true);
      return (endX - startX) / colWidth;
    }

    function simulateCorrectDrag(origStart: string, origEnd: string, columnsDragged: number) {
      const dx = columnsDragged * colWidth;
      const startX = dateToXCollapsed(origStart, timelineStart, colWidth, zoom, true);
      const newStart = formatDate(xToDateCollapsed(startX + dx, timelineStart, colWidth, zoom, true));
      const endX = dateToXCollapsed(origEnd, timelineStart, colWidth, zoom, true);
      const newEnd = formatDate(xToDateCollapsed(endX + dx, timelineStart, colWidth, zoom, true));
      return { newStart, newEnd };
    }

    it('Fri-Mon (1 col) dragged 1 col right stays 1 col wide', () => {
      expect(getVisualWidth('2026-03-06', '2026-03-09')).toBe(1);
      const { newStart, newEnd } = simulateCorrectDrag('2026-03-06', '2026-03-09', 1);
      expect(newStart).toBe('2026-03-09');
      expect(getVisualWidth(newStart, newEnd)).toBe(1);
    });

    it('Thu-Tue (3 cols) dragged 2 cols right stays 3 cols wide', () => {
      expect(getVisualWidth('2026-03-05', '2026-03-10')).toBe(3);
      const { newStart, newEnd } = simulateCorrectDrag('2026-03-05', '2026-03-10', 2);
      expect(getVisualWidth(newStart, newEnd)).toBe(3);
    });

    it('Mon-Fri (4 cols) dragged 3 cols right stays 4 cols wide', () => {
      expect(getVisualWidth('2026-03-02', '2026-03-06')).toBe(4);
      const { newStart, newEnd } = simulateCorrectDrag('2026-03-02', '2026-03-06', 3);
      expect(getVisualWidth(newStart, newEnd)).toBe(4);
    });

    it('Wed-Mon (3 cols) dragged 1 col right stays 3 cols wide', () => {
      expect(getVisualWidth('2026-03-04', '2026-03-09')).toBe(3);
      const { newStart, newEnd } = simulateCorrectDrag('2026-03-04', '2026-03-09', 1);
      expect(getVisualWidth(newStart, newEnd)).toBe(3);
    });
  });
});
