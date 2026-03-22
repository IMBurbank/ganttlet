import type { Task, ChangeRecord } from '../../types';

export interface Template {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  load: () => Promise<{ tasks: Task[]; changeHistory: ChangeRecord[] }>;
}

export const templates: Template[] = [
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Start from scratch with an empty project',
    taskCount: 0,
    load: async () => ({ tasks: [], changeHistory: [] }),
  },
  {
    id: 'software-release',
    name: 'Software Release',
    description: 'Plan a full product launch with engineering, UX, and go-to-market tracks',
    taskCount: 32,
    load: async () => {
      const mod = await import('./softwareRelease');
      return { tasks: mod.fakeTasks, changeHistory: mod.fakeChangeHistory };
    },
  },
  {
    id: 'marketing-campaign',
    name: 'Marketing Campaign',
    description: 'Run a multi-channel marketing campaign from research to launch',
    taskCount: 11,
    load: async () => {
      const mod = await import('./marketingCampaign');
      return { tasks: mod.tasks, changeHistory: mod.changeHistory };
    },
  },
  {
    id: 'event-planning',
    name: 'Event Planning',
    description: 'Organize an event from goal setting through day-of execution',
    taskCount: 11,
    load: async () => {
      const mod = await import('./eventPlanning');
      return { tasks: mod.tasks, changeHistory: mod.changeHistory };
    },
  },
];

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
