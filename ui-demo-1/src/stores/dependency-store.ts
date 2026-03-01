import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Dependency } from '../types';

interface DependencyStore {
  dependencies: Dependency[];

  setDependencies: (dependencies: Dependency[]) => void;
  addDependency: (dependency: Omit<Dependency, 'id'>) => void;
  removeDependency: (id: string) => void;
  getDependenciesForTask: (taskId: string) => Dependency[];
  getPredecessors: (taskId: string) => Dependency[];
  getSuccessors: (taskId: string) => Dependency[];
}

export const useDependencyStore = create<DependencyStore>()((set, get) => ({
  dependencies: [],

  setDependencies: (dependencies) => set({ dependencies }),

  addDependency: (dependency) =>
    set((state) => ({
      dependencies: [...state.dependencies, { ...dependency, id: nanoid() }],
    })),

  removeDependency: (id) =>
    set((state) => ({
      dependencies: state.dependencies.filter((d) => d.id !== id),
    })),

  getDependenciesForTask: (taskId) => {
    return get().dependencies.filter(
      (d) => d.predecessorId === taskId || d.successorId === taskId
    );
  },

  getPredecessors: (taskId) => {
    return get().dependencies.filter((d) => d.successorId === taskId);
  },

  getSuccessors: (taskId) => {
    return get().dependencies.filter((d) => d.predecessorId === taskId);
  },
}));
