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
  businessDaysDelta,
  taskDuration,
  taskEndDate,
  ensureBusinessDay,
  prevBusinessDay,
  isWeekendDate,
  withDuration,
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

    it('businessDaysDelta returns business days between two date strings', () => {
      // Mon to Fri same week = 4 business days
      expect(businessDaysDelta('2026-03-02', '2026-03-06')).toBe(4);
      // Fri to next Mon = 1 business day (skips weekend)
      expect(businessDaysDelta('2026-03-06', '2026-03-09')).toBe(1);
      // Mon to next Mon = 5 business days
      expect(businessDaysDelta('2026-03-02', '2026-03-09')).toBe(5);
      // Same date = 0
      expect(businessDaysDelta('2026-03-02', '2026-03-02')).toBe(0);
      // Negative (moving backward)
      expect(businessDaysDelta('2026-03-09', '2026-03-06')).toBe(-1);
    });
  });

  describe('earliestStart clamp must preserve task duration', () => {
    const timelineStart = new Date('2026-03-02'); // Monday
    const colWidth = 36;
    const zoom = 'day' as const;
    const collapseWeekends = false;

    /**
     * Simulates the buggy move handler: start is clamped to earliestStart,
     * but end uses the unclamped dx, causing the task to shrink.
     */
    function simulateBuggyDrag(
      origStart: string,
      origEnd: string,
      dxColumns: number,
      earliestStart: string
    ) {
      const dx = dxColumns * colWidth;
      const origStartX = dateToX(origStart, timelineStart, colWidth, zoom, collapseWeekends);
      const origEndX = dateToX(origEnd, timelineStart, colWidth, zoom, collapseWeekends);

      // Compute new start, then clamp
      let newStart = formatDate(
        xToDate(origStartX + dx, timelineStart, colWidth, zoom, collapseWeekends)
      );
      if (newStart < earliestStart) {
        newStart = earliestStart;
      }

      // Bug: end uses unclamped dx
      const newEnd = formatDate(
        xToDate(origEndX + dx, timelineStart, colWidth, zoom, collapseWeekends)
      );

      return { newStart, newEnd };
    }

    /**
     * Simulates the fixed move handler: when start is clamped, the clamped dx
     * is applied to end as well, preserving task duration.
     */
    function simulateFixedDrag(
      origStart: string,
      origEnd: string,
      dxColumns: number,
      earliestStart: string
    ) {
      const dx = dxColumns * colWidth;
      const origStartX = dateToX(origStart, timelineStart, colWidth, zoom, collapseWeekends);
      const origEndX = dateToX(origEnd, timelineStart, colWidth, zoom, collapseWeekends);

      // Compute new start, then clamp
      let newStartX = origStartX + dx;
      let newStart = formatDate(
        xToDate(newStartX, timelineStart, colWidth, zoom, collapseWeekends)
      );
      if (newStart < earliestStart) {
        newStart = earliestStart;
        newStartX = dateToX(earliestStart, timelineStart, colWidth, zoom, collapseWeekends);
      }

      // Fixed: use clamped dx for end
      const clampedDx = newStartX - origStartX;
      const newEnd = formatDate(
        xToDate(origEndX + clampedDx, timelineStart, colWidth, zoom, collapseWeekends)
      );

      return { newStart, newEnd };
    }

    it('buggy handler shrinks task when dragged before earliestStart', () => {
      // Task: Mar 10 (Tue) - Mar 13 (Fri), duration = 3 days
      // earliestStart: Mar 9 (Mon)
      // Drag left by 3 columns (trying to move to Mar 7)
      // Start clamps to Mar 9, but end moves to Mar 10 with unclamped dx
      // Duration shrinks from 3 to 1 -- this is the bug
      const { newStart, newEnd } = simulateBuggyDrag('2026-03-10', '2026-03-13', -3, '2026-03-09');
      expect(newStart).toBe('2026-03-09');
      // Bug: end moved by -3 days instead of the clamped -1 day
      const origDuration = daysBetween('2026-03-10', '2026-03-13');
      const newDuration = daysBetween(newStart, newEnd);
      expect(newDuration).toBeLessThan(origDuration); // confirms the bug
    });

    it('fixed handler preserves duration when dragged before earliestStart', () => {
      // Same scenario: task Mar 10-13, earliestStart Mar 9, drag -3 cols
      const { newStart, newEnd } = simulateFixedDrag('2026-03-10', '2026-03-13', -3, '2026-03-09');
      expect(newStart).toBe('2026-03-09');
      // Fixed: duration is preserved
      const origDuration = daysBetween('2026-03-10', '2026-03-13');
      const newDuration = daysBetween(newStart, newEnd);
      expect(newDuration).toBe(origDuration);
    });

    it('fixed handler allows normal drag when not hitting earliestStart', () => {
      // Task: Mar 12 - Mar 15, earliestStart: Mar 9, drag left by 1
      // No clamping needed, should work normally
      const { newStart, newEnd } = simulateFixedDrag('2026-03-12', '2026-03-15', -1, '2026-03-09');
      expect(newStart).toBe('2026-03-11');
      expect(newEnd).toBe('2026-03-14');
      const origDuration = daysBetween('2026-03-12', '2026-03-15');
      const newDuration = daysBetween(newStart, newEnd);
      expect(newDuration).toBe(origDuration);
    });
  });

  describe('inclusive convention functions', () => {
    describe('taskDuration', () => {
      it('same-day task has duration 1', () => {
        expect(taskDuration('2026-03-10', '2026-03-10')).toBe(1);
      });

      it('Mon-Fri is 5 business days', () => {
        expect(taskDuration('2026-03-09', '2026-03-13')).toBe(5);
      });

      it('Fri-Tue spanning weekend is 3 business days', () => {
        // Fri(1) + Mon(2) + Tue(3) = 3
        expect(taskDuration('2026-03-06', '2026-03-10')).toBe(3);
      });

      it('2 weeks Mon-Fri is 10 business days', () => {
        expect(taskDuration('2026-03-09', '2026-03-20')).toBe(10);
      });
    });

    describe('taskEndDate', () => {
      it('duration 1 returns start date (same-day task)', () => {
        expect(taskEndDate('2026-03-09', 1)).toBe('2026-03-09');
      });

      it('duration 5 from Monday returns Friday', () => {
        expect(taskEndDate('2026-03-09', 5)).toBe('2026-03-13');
      });

      it('duration 3 from Friday returns Tuesday (skips weekend)', () => {
        expect(taskEndDate('2026-03-06', 3)).toBe('2026-03-10');
      });
    });

    describe('roundtrip: taskDuration(start, taskEndDate(start, d)) === d', () => {
      const start = '2026-03-09';
      it('d=1', () => {
        expect(taskDuration(start, taskEndDate(start, 1))).toBe(1);
      });
      it('d=3', () => {
        expect(taskDuration(start, taskEndDate(start, 3))).toBe(3);
      });
      it('d=5', () => {
        expect(taskDuration(start, taskEndDate(start, 5))).toBe(5);
      });
      it('d=10', () => {
        expect(taskDuration(start, taskEndDate(start, 10))).toBe(10);
      });
    });

    describe('ensureBusinessDay', () => {
      it('weekday unchanged', () => {
        const mon = new Date('2026-03-09');
        expect(formatDate(ensureBusinessDay(mon))).toBe('2026-03-09');
      });

      it('Saturday snaps to Monday', () => {
        const sat = new Date('2026-03-07');
        expect(formatDate(ensureBusinessDay(sat))).toBe('2026-03-09');
      });

      it('Sunday snaps to Monday', () => {
        const sun = new Date('2026-03-08');
        expect(formatDate(ensureBusinessDay(sun))).toBe('2026-03-09');
      });
    });

    describe('prevBusinessDay', () => {
      it('weekday unchanged', () => {
        const mon = new Date('2026-03-09');
        expect(formatDate(prevBusinessDay(mon))).toBe('2026-03-09');
      });

      it('Saturday snaps to Friday', () => {
        const sat = new Date('2026-03-07');
        expect(formatDate(prevBusinessDay(sat))).toBe('2026-03-06');
      });

      it('Sunday snaps to Friday', () => {
        const sun = new Date('2026-03-08');
        expect(formatDate(prevBusinessDay(sun))).toBe('2026-03-06');
      });
    });

    describe('isWeekendDate', () => {
      it('Monday is not a weekend', () => {
        expect(isWeekendDate('2026-03-09')).toBe(false);
      });

      it('Saturday is a weekend', () => {
        expect(isWeekendDate('2026-03-07')).toBe(true);
      });

      it('Sunday is a weekend', () => {
        expect(isWeekendDate('2026-03-08')).toBe(true);
      });
    });

    describe('withDuration', () => {
      it('recomputes duration correctly from dates', () => {
        const task = { startDate: '2026-03-09', endDate: '2026-03-13', name: 'My task' };
        const result = withDuration(task);
        expect(result.duration).toBe(5);
      });

      it('preserves other fields', () => {
        const task = { startDate: '2026-03-09', endDate: '2026-03-13', name: 'My task', id: 42 };
        const result = withDuration(task);
        expect(result.name).toBe('My task');
        expect(result.id).toBe(42);
        expect(result.startDate).toBe('2026-03-09');
        expect(result.endDate).toBe('2026-03-13');
      });

      it('recomputes for a Fri-Tue spanning task', () => {
        const task = { startDate: '2026-03-06', endDate: '2026-03-10' };
        expect(withDuration(task).duration).toBe(3);
      });
    });
  });

  describe('move-drag must preserve visual width with collapsed weekends', () => {
    const timelineStart = new Date('2026-03-02'); // Monday
    const colWidth = 36;
    const zoom = 'day' as const;

    function getVisualWidth(start: string, end: string): number {
      const startX = dateToX(start, timelineStart, colWidth, zoom, true);
      const endX = dateToX(end, timelineStart, colWidth, zoom, true);
      return (endX - startX) / colWidth;
    }

    function simulateCorrectDrag(origStart: string, origEnd: string, columnsDragged: number) {
      const dx = columnsDragged * colWidth;
      const startX = dateToX(origStart, timelineStart, colWidth, zoom, true);
      const newStart = formatDate(xToDate(startX + dx, timelineStart, colWidth, zoom, true));
      const endX = dateToX(origEnd, timelineStart, colWidth, zoom, true);
      const newEnd = formatDate(xToDate(endX + dx, timelineStart, colWidth, zoom, true));
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
