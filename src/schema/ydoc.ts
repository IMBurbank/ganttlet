import * as Y from 'yjs';
import type { Task, Dependency } from '../types';
import { taskDuration } from '../utils/dateUtils';
import { ORIGIN } from '../collab/origins';
import { CURRENT_VERSION, MIGRATIONS } from './migrations';

/**
 * The 19 collaborative fields stored in each task's Y.Map.
 * Excludes: duration (computed from startDate/endDate).
 */
export const TASK_FIELDS: string[] = [
  'id',
  'name',
  'startDate',
  'endDate',
  'owner',
  'workStream',
  'project',
  'functionalArea',
  'done',
  'description',
  'isMilestone',
  'isSummary',
  'parentId',
  'childIds',
  'dependencies',
  'notes',
  'okrs',
  'constraintType',
  'constraintDate',
];

// ─── Doc Structure Accessor ──────────────────────────────────────────

export interface DocMaps {
  tasks: Y.Map<Y.Map<unknown>>;
  taskOrder: Y.Array<string>;
  meta: Y.Map<unknown>;
}

/**
 * Get typed references to the Y.Doc's top-level structures.
 * Pure accessor — no side effects, no version changes.
 */
export function getDocMaps(doc: Y.Doc): DocMaps {
  return {
    tasks: doc.getMap('tasks') as Y.Map<Y.Map<unknown>>,
    taskOrder: doc.getArray<string>('taskOrder'),
    meta: doc.getMap('meta') as Y.Map<unknown>,
  };
}

// ─── Schema Migration ────────────────────────────────────────────────

export type MigrateResult =
  | { status: 'ok'; fromVersion: number; toVersion: number; migrationsRun: number }
  | { status: 'incompatible'; docVersion: number; codeVersion: number }
  | { status: 'noop' };

/**
 * Migrate a Y.Doc to the current schema version.
 *
 * - Runs pending migrations in a single ORIGIN.INIT transaction (not undoable).
 * - Gates on future versions: if docVersion > CURRENT_VERSION, returns 'incompatible'.
 * - Re-checks version inside the transaction (CAS guard for single-client races).
 * - Idempotent: calling twice on the same doc is safe (second call returns 'noop').
 *
 * MUST be called after all persistence providers (IndexedDB, WebSocket) have synced.
 * The useDocMigration hook handles this timing.
 */
export function migrateDoc(doc: Y.Doc): MigrateResult {
  const { meta } = getDocMaps(doc);
  const docVersion = (meta.get('schemaVersion') as number) ?? 0;

  // Gate: refuse to operate on docs from the future
  if (docVersion > CURRENT_VERSION) {
    return { status: 'incompatible', docVersion, codeVersion: CURRENT_VERSION };
  }

  // Already current
  if (docVersion === CURRENT_VERSION) {
    return { status: 'noop' };
  }

  // Run pending migrations inside a single transaction
  const pending = MIGRATIONS.filter((m) => m.version > docVersion);
  doc.transact(() => {
    // Re-check version inside transaction (CAS guard for single-client races:
    // if another effect already migrated, skip)
    const currentInTxn = (meta.get('schemaVersion') as number) ?? 0;
    if (currentInTxn >= CURRENT_VERSION) return;

    for (const m of pending) {
      m.migrate(doc);
    }
    meta.set('schemaVersion', CURRENT_VERSION);
  }, ORIGIN.INIT);

  return {
    status: 'ok',
    fromVersion: docVersion,
    toVersion: CURRENT_VERSION,
    migrationsRun: pending.length,
  };
}

// ─── Task ↔ Y.Map Conversion ────────────────────────────────────────

/**
 * Write a task to the Y.Doc. Single public write path.
 *
 * - If the task already exists: updates known fields in place (preserves unknown
 *   fields from future schema versions — forward compatibility).
 * - If the task is new: creates a fresh Y.Map.
 *
 * This is the ONLY way to write task data to Y.Doc. There is no separate
 * "create" vs "update" function — the existence check is O(1) on Y.Map.
 */
export function writeTaskToDoc(ytasks: Y.Map<Y.Map<unknown>>, taskId: string, task: Task): void {
  const existing = ytasks.get(taskId);
  if (existing) {
    setKnownFields(existing, task);
  } else {
    ytasks.set(taskId, createTaskYMap(task));
  }
}

/** Set all known fields on an existing Y.Map. Unknown fields are preserved. */
function setKnownFields(ymap: Y.Map<unknown>, task: Task): void {
  ymap.set('id', task.id);
  ymap.set('name', task.name);
  ymap.set('startDate', task.startDate);
  ymap.set('endDate', task.endDate);
  ymap.set('owner', task.owner);
  ymap.set('workStream', task.workStream);
  ymap.set('project', task.project);
  ymap.set('functionalArea', task.functionalArea);
  ymap.set('done', task.done);
  ymap.set('description', task.description);
  ymap.set('isMilestone', task.isMilestone);
  ymap.set('isSummary', task.isSummary);
  ymap.set('parentId', task.parentId);
  ymap.set('childIds', JSON.stringify(task.childIds));
  ymap.set('dependencies', JSON.stringify(task.dependencies));
  ymap.set('notes', task.notes);
  ymap.set('okrs', JSON.stringify(task.okrs));
  if (task.constraintType != null) {
    ymap.set('constraintType', task.constraintType);
  }
  if (task.constraintDate != null) {
    ymap.set('constraintDate', task.constraintDate);
  }
}

/** Create a new Y.Map for a brand-new task. Only called by writeTaskToDoc. */
function createTaskYMap(task: Task): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();
  setKnownFields(ymap, task);
  return ymap;
}

/**
 * Convert a Y.Map back to a Task object.
 * Computes duration from startDate/endDate via taskDuration().
 * Parses childIds, dependencies, okrs from JSON strings with fallback to [].
 */
export function yMapToTask(ymap: Y.Map<unknown>): Task {
  let childIds: string[] = [];
  let dependencies: Dependency[] = [];
  let okrs: string[] = [];

  try {
    const raw = ymap.get('childIds');
    if (typeof raw === 'string') childIds = JSON.parse(raw);
  } catch {
    /* default to empty */
  }

  try {
    const raw = ymap.get('dependencies');
    if (typeof raw === 'string') dependencies = JSON.parse(raw);
  } catch {
    /* default to empty */
  }

  try {
    const raw = ymap.get('okrs');
    if (typeof raw === 'string') okrs = JSON.parse(raw);
  } catch {
    /* default to empty */
  }

  const startDate = (ymap.get('startDate') as string) ?? '';
  const endDate = (ymap.get('endDate') as string) ?? '';
  const duration = startDate && endDate ? taskDuration(startDate, endDate) : 0;

  return {
    id: (ymap.get('id') as string) ?? '',
    name: (ymap.get('name') as string) ?? '',
    startDate,
    endDate,
    duration,
    owner: (ymap.get('owner') as string) ?? '',
    workStream: (ymap.get('workStream') as string) ?? '',
    project: (ymap.get('project') as string) ?? '',
    functionalArea: (ymap.get('functionalArea') as string) ?? '',
    done: (ymap.get('done') as boolean) ?? false,
    description: (ymap.get('description') as string) ?? '',
    isMilestone: (ymap.get('isMilestone') as boolean) ?? false,
    isSummary: (ymap.get('isSummary') as boolean) ?? false,
    parentId: (ymap.get('parentId') as string | null) ?? null,
    childIds,
    dependencies,
    notes: (ymap.get('notes') as string) ?? '',
    okrs,
    constraintType: (ymap.get('constraintType') as Task['constraintType']) ?? undefined,
    constraintDate: (ymap.get('constraintDate') as string) ?? undefined,
  };
}

// Re-export for consumers
export { CURRENT_VERSION } from './migrations';
