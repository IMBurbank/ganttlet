import { useMemo } from 'react';
import { subDays, addDays, startOfDay } from 'date-fns';
import { useTaskStore } from '../stores';

/**
 * Returns the project start/end dates padded with some buffer.
 */
export function useProjectDates() {
  const tasks = useTaskStore((s) => s.tasks);

  return useMemo(() => {
    if (tasks.length === 0) {
      const now = startOfDay(new Date());
      return { projectStart: subDays(now, 30), projectEnd: addDays(now, 60) };
    }

    let earliest = Infinity;
    let latest = -Infinity;
    for (const t of tasks) {
      const s = t.startDate.getTime();
      const e = t.endDate.getTime();
      if (s < earliest) earliest = s;
      if (e > latest) latest = e;
    }

    return {
      projectStart: subDays(new Date(earliest), 7),
      projectEnd: addDays(new Date(latest), 14),
    };
  }, [tasks]);
}
