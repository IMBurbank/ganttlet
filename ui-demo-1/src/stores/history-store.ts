import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { ChangeRecord } from '../types';

interface HistoryStore {
  records: ChangeRecord[];

  setRecords: (records: ChangeRecord[]) => void;
  addRecord: (record: Omit<ChangeRecord, 'id'>) => void;
  getRecordsForTask: (taskId: string) => ChangeRecord[];
}

export const useHistoryStore = create<HistoryStore>()((set, get) => ({
  records: [],

  setRecords: (records) => set({ records }),

  addRecord: (record) =>
    set((state) => ({
      records: [...state.records, { ...record, id: nanoid() }],
    })),

  getRecordsForTask: (taskId) => {
    return get().records.filter((r) => r.taskId === taskId);
  },
}));
