import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Task, Project, Workstream } from '../types';

interface TaskStore {
  tasks: Task[];
  projects: Project[];
  workstreams: Workstream[];

  setTasks: (tasks: Task[]) => void;
  addTask: (task: Omit<Task, 'id'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleCollapse: (id: string) => void;
  getVisibleTasks: () => Task[];
  getTaskById: (id: string) => Task | undefined;
  setProjects: (projects: Project[]) => void;
  setWorkstreams: (workstreams: Workstream[]) => void;
  getChildTasks: (parentId: string) => Task[];
}

export const useTaskStore = create<TaskStore>()((set, get) => ({
  tasks: [],
  projects: [],
  workstreams: [],

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) =>
    set((state) => ({
      tasks: [...state.tasks, { ...task, id: nanoid() }],
    })),

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  deleteTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  toggleCollapse: (id) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, isCollapsed: !t.isCollapsed } : t
      ),
    })),

  getVisibleTasks: () => {
    const { tasks } = get();
    const collapsedParentIds = new Set<string>();
    const visible: Task[] = [];

    for (const task of tasks) {
      // Check if any ancestor is collapsed
      let hidden = false;
      let currentParentId = task.parentId;
      while (currentParentId) {
        if (collapsedParentIds.has(currentParentId)) {
          hidden = true;
          break;
        }
        const parent = tasks.find((t) => t.id === currentParentId);
        currentParentId = parent?.parentId ?? null;
      }

      if (!hidden) {
        visible.push(task);
      }

      // Track collapsed parents for their descendants
      if (task.isCollapsed) {
        collapsedParentIds.add(task.id);
      }
    }

    return visible;
  },

  getTaskById: (id) => {
    return get().tasks.find((t) => t.id === id);
  },

  setProjects: (projects) => set({ projects }),

  setWorkstreams: (workstreams) => set({ workstreams }),

  getChildTasks: (parentId) => {
    return get().tasks.filter((t) => t.parentId === parentId);
  },
}));
