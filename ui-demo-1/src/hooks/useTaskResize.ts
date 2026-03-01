import { useCallback, useRef } from 'react';
import { useTimelineStore, useTaskStore, useDependencyStore } from '../stores';
import { addWorkingDays } from '../engine/date-utils';
import { cascadeDates } from '../engine/dependency-resolver';
import type { Task } from '../types';

export function useTaskResize() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const dependencies = useDependencyStore((s) => s.dependencies);
  const resizeRef = useRef<{
    taskId: string;
    startX: number;
    origDuration: number;
    origEndDate: Date;
  } | null>(null);

  const startResize = useCallback(
    (task: Task, clientX: number) => {
      resizeRef.current = {
        taskId: task.id,
        startX: clientX,
        origDuration: task.duration,
        origEndDate: task.endDate,
      };
    },
    []
  );

  const onResize = useCallback(
    (clientX: number) => {
      if (!resizeRef.current) return;
      const { taskId, startX, origDuration } = resizeRef.current;
      const dayWidth = useTimelineStore.getState().dayWidth;
      const deltaDays = Math.round((clientX - startX) / dayWidth);
      const newDuration = Math.max(1, origDuration + deltaDays);

      const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
      if (!task) return;

      const newEnd = addWorkingDays(task.startDate, newDuration);
      updateTask(taskId, { duration: newDuration, endDate: newEnd });

      // Cascade
      const taskMap = new Map(useTaskStore.getState().tasks.map((t) => [t.id, t]));
      const updates = cascadeDates(taskMap, dependencies, taskId);
      for (const [id, dates] of updates) {
        updateTask(id, dates);
      }
    },
    [dependencies, updateTask]
  );

  const endResize = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return { startResize, onResize, endResize, isResizing: () => resizeRef.current !== null };
}
