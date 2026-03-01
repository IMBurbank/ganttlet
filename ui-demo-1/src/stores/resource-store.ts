import { create } from 'zustand';
import type { Resource } from '../types';

interface ResourceStore {
  resources: Resource[];

  setResources: (resources: Resource[]) => void;
  getResourceById: (id: string) => Resource | undefined;
}

export const useResourceStore = create<ResourceStore>()((set, get) => ({
  resources: [],

  setResources: (resources) => set({ resources }),

  getResourceById: (id) => {
    return get().resources.find((r) => r.id === id);
  },
}));
