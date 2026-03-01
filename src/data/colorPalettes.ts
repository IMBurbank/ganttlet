import type { ColorByField } from '../types';

const ownerColors: Record<string, string> = {
  'Sarah Chen': '#3b82f6',
  'Marcus Johnson': '#22c55e',
  'Priya Patel': '#a855f7',
  'Alex Rivera': '#f97316',
  'Jordan Kim': '#ec4899',
  'Taylor Swift': '#06b6d4',
  'Unassigned': '#6b7280',
};

const workStreamColors: Record<string, string> = {
  'Platform Engineering': '#3b82f6',
  'User Experience': '#a855f7',
  'Go-to-Market': '#22c55e',
  'Q2 Product Launch': '#6366f1',
};

const projectColors: Record<string, string> = {
  'Q2 Product Launch': '#6366f1',
  'API Overhaul': '#3b82f6',
  'Design System': '#a855f7',
  'Marketing Push': '#22c55e',
};

const functionalAreaColors: Record<string, string> = {
  'Engineering': '#3b82f6',
  'Design': '#a855f7',
  'Marketing': '#22c55e',
  'QA': '#f97316',
  'DevOps': '#06b6d4',
  'Product': '#ec4899',
  'Management': '#6366f1',
};

const palettes: Record<ColorByField, Record<string, string>> = {
  owner: ownerColors,
  workStream: workStreamColors,
  project: projectColors,
  functionalArea: functionalAreaColors,
};

export function getTaskColor(colorBy: ColorByField, value: string): string {
  return palettes[colorBy]?.[value] ?? '#6b7280';
}

export function getPaletteEntries(colorBy: ColorByField): Array<{ label: string; color: string }> {
  return Object.entries(palettes[colorBy]).map(([label, color]) => ({ label, color }));
}
