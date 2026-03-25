import * as Y from 'yjs';
import type { Dependency, DependencyType } from '../types';

/**
 * Parse the dependencies JSON string from a task's Y.Map.
 */
function parseDeps(ymap: Y.Map<unknown>): Dependency[] {
  try {
    const raw = ymap.get('dependencies') as string;
    if (raw) return JSON.parse(raw);
  } catch {
    /* empty */
  }
  return [];
}

/**
 * Add a dependency to a task's dependencies array.
 */
export function addDependency(doc: Y.Doc, taskId: string, dep: Dependency): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  doc.transact(() => {
    const deps = parseDeps(ymap);
    deps.push(dep);
    ymap.set('dependencies', JSON.stringify(deps));
  }, 'local');
}

/**
 * Update an existing dependency identified by fromId.
 */
export function updateDependency(
  doc: Y.Doc,
  taskId: string,
  fromId: string,
  update: Partial<{ type: DependencyType; lag: number }>
): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  doc.transact(() => {
    const deps = parseDeps(ymap);
    const updated = deps.map((d) => (d.fromId === fromId ? { ...d, ...update } : d));
    ymap.set('dependencies', JSON.stringify(updated));
  }, 'local');
}

/**
 * Remove a dependency identified by fromId.
 */
export function removeDependency(doc: Y.Doc, taskId: string, fromId: string): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const ymap = ytasks.get(taskId);
  if (!ymap) return;

  doc.transact(() => {
    const deps = parseDeps(ymap);
    const filtered = deps.filter((d) => d.fromId !== fromId);
    ymap.set('dependencies', JSON.stringify(filtered));
  }, 'local');
}
