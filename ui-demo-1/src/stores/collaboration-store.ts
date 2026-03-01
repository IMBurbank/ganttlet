import { create } from 'zustand';
import type { CollaborationUser } from '../types';

interface CollaborationStore {
  users: CollaborationUser[];

  setUsers: (users: CollaborationUser[]) => void;
  updateUserCursor: (userId: string, x: number, y: number) => void;
  updateUserSelection: (userId: string, taskId: string | null) => void;
}

export const useCollaborationStore = create<CollaborationStore>()((set) => ({
  users: [],

  setUsers: (users) => set({ users }),

  updateUserCursor: (userId, x, y) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.id === userId ? { ...u, cursorX: x, cursorY: y } : u
      ),
    })),

  updateUserSelection: (userId, taskId) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.id === userId ? { ...u, selectedTaskId: taskId } : u
      ),
    })),
}));
