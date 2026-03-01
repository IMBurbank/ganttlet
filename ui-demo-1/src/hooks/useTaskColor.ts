import { useMemo } from 'react';
import { useUIStore, useTaskStore, useResourceStore } from '../stores';
import type { Task } from '../types';

/**
 * Returns a function that maps a task to a color based on the current color mode.
 */
export function useTaskColor() {
  const colorMode = useUIStore((s) => s.colorMode);
  const workstreams = useTaskStore((s) => s.workstreams);
  const projects = useTaskStore((s) => s.projects);
  const resources = useResourceStore((s) => s.resources);

  return useMemo(() => {
    const wsMap = new Map(workstreams.map((ws) => [ws.id, ws.color]));
    const projMap = new Map(projects.map((p) => [p.id, p.color]));
    const resMap = new Map(resources.map((r) => [r.id, r.avatarColor]));

    return (task: Task): string => {
      switch (colorMode) {
        case 'workstream':
          return wsMap.get(task.workstreamId) || '#6366f1';
        case 'project':
          return projMap.get(task.projectId) || '#6366f1';
        case 'resource':
          if (task.assignedResourceIds.length > 0) {
            return resMap.get(task.assignedResourceIds[0]) || '#6366f1';
          }
          return '#52525b';
        case 'criticality':
          return task.isCritical ? '#ef4444' : '#3b82f6';
        default:
          return '#6366f1';
      }
    };
  }, [colorMode, workstreams, projects, resources]);
}
