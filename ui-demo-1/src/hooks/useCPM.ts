import { useEffect } from 'react';
import { useTaskStore, useDependencyStore } from '../stores';
import { runCPM } from '../engine/cpm';

/**
 * Runs CPM analysis whenever tasks or dependencies change
 * and updates the isCritical / float fields on each task.
 */
export function useCPM() {
  const tasks = useTaskStore((s) => s.tasks);
  const dependencies = useDependencyStore((s) => s.dependencies);
  const updateTask = useTaskStore((s) => s.updateTask);

  useEffect(() => {
    if (tasks.length === 0) return;

    const results = runCPM(tasks, dependencies);

    for (const [taskId, cpm] of results) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) continue;

      // Only update if CPM data actually changed
      if (
        task.isCritical !== cpm.isCritical ||
        task.totalFloat !== cpm.totalFloat ||
        task.freeFloat !== cpm.freeFloat
      ) {
        updateTask(taskId, {
          earlyStart: cpm.earlyStart,
          earlyFinish: cpm.earlyFinish,
          lateStart: cpm.lateStart,
          lateFinish: cpm.lateFinish,
          totalFloat: cpm.totalFloat,
          freeFloat: cpm.freeFloat,
          isCritical: cpm.isCritical,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, dependencies.length]);
}
