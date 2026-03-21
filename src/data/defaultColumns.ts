import type { ColumnConfig } from '../types';

export const defaultColumns: ColumnConfig[] = [
  { key: 'id', label: 'ID', width: 80, visible: true },
  { key: 'name', label: 'Task Name', width: 240, visible: true },
  { key: 'owner', label: 'Owner', width: 120, visible: true },
  { key: 'startDate', label: 'Start', width: 90, visible: true },
  { key: 'endDate', label: 'End', width: 90, visible: true },
  { key: 'duration', label: 'Duration', width: 70, visible: true },
  { key: 'predecessors', label: 'Predecessors', width: 140, visible: true },
  { key: 'done', label: 'Done', width: 50, visible: true },
  { key: 'description', label: 'Description', width: 180, visible: false },
  { key: 'functionalArea', label: 'Area', width: 100, visible: false },
  { key: 'workStream', label: 'Work Stream', width: 140, visible: false },
  { key: 'project', label: 'Project', width: 120, visible: false },
  { key: 'okrs', label: 'OKRs', width: 200, visible: true },
  { key: 'notes', label: 'Notes', width: 180, visible: true },
];
