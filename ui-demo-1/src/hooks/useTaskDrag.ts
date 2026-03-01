import { useCallback, useRef } from 'react';
import { useTimelineStore, useTaskStore, useDependencyStore } from '../stores';
import { addWorkingDays } from '../engine/date-utils';
import { cascadeDates } from '../engine/dependency-resolver';
import type { Task } from '../types';

export function useTaskDrag() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const dependencies = useDependencyStore((s) => s.dependencies);
  const dragRef = useRef<{
    taskId: string;
    startX: number;
    origStartDate: Date;
    origEndDate: Date;
  } | null>(null);

  const startDrag = useCallback(
    (task: Task, clientX: number) => {
      dragRef.current = {
        taskId: task.id,
        startX: clientX,
        origStartDate: task.startDate,
        origEndDate: task.endDate,
      };
    },
    []
  );

  const onDrag = useCallback(
    (clientX: number) => {
      if (!dragRef.current) return;
      const { taskId, startX, origStartDate } = dragRef.current;
      const dayWidth = useTimelineStore.getState().dayWidth;
      const deltaDays = Math.round((clientX - startX) / dayWidth);
      if (deltaDays === 0) return;

      const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
      if (!task) return;

      const newStart = addWorkingDays(origStartDate, deltaDays);
      const newEnd = addWorkingDays(newStart, task.duration);

      updateTask(taskId, { startDate: newStart, endDate: newEnd });

      // Cascade to dependents
      const taskMap = new Map(useTaskStore.getState().tasks.map((t) => [t.id, t]));
      const updates = cascadeDates(taskMap, dependencies, taskId);
      for (const [id, dates] of updates) {
        updateTask(id, dates);
      }
    },
    [dependencies, updateTask]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return { startDrag, onDrag, endDrag, isDragging: () => dragRef.current !== null };
}
