import { create } from 'zustand';
import { differenceInCalendarDays, addDays } from 'date-fns';
import type { ZoomLevel } from '../types';

const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  day: 40,
  week: 18,
  month: 5,
};

interface TimelineStore {
  zoomLevel: ZoomLevel;
  scrollX: number;
  scrollY: number;
  dayWidth: number;

  setZoomLevel: (level: ZoomLevel) => void;
  setScrollX: (x: number) => void;
  setScrollY: (y: number) => void;
  dateToX: (date: Date, projectStartDate: Date) => number;
  xToDate: (x: number, projectStartDate: Date) => Date;
}

export const useTimelineStore = create<TimelineStore>()((set, get) => ({
  zoomLevel: 'week',
  scrollX: 0,
  scrollY: 0,
  dayWidth: ZOOM_DAY_WIDTHS['week'],

  setZoomLevel: (level) =>
    set({
      zoomLevel: level,
      dayWidth: ZOOM_DAY_WIDTHS[level],
    }),

  setScrollX: (x) => set({ scrollX: x }),

  setScrollY: (y) => set({ scrollY: y }),

  dateToX: (date, projectStartDate) => {
    const { dayWidth } = get();
    return differenceInCalendarDays(date, projectStartDate) * dayWidth;
  },

  xToDate: (x, projectStartDate) => {
    const { dayWidth } = get();
    return addDays(projectStartDate, Math.round(x / dayWidth));
  },
}));
