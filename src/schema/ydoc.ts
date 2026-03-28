import * as Y from 'yjs';
import type { Task } from '../types';
import { taskDuration } from '../utils/dateUtils';
import { ORIGIN } from '../collab/origins';
import { CURRENT_MAJOR, CURRENT_MINOR, MIGRATIONS } from './migrations';

// ─── Field Registry ──────────────────────────────────────────────────
//
// Single source of truth for all Task ↔ Y.Doc field serialization.
//
// To add a new field:
//   1. Add it to the Task interface in src/types/index.ts
//   2. Add an entry here with the correct serialization type
//   3. Add it to SHEET_COLUMNS + taskToRow + REQUIRED_COLUMNS in src/sheets/sheetsMapper.ts
//   4. If the field needs a default for existing docs, add a migration in src/schema/migrations.ts
//   5. Run `npx vitest run` — the cross-system coverage tests will catch anything you missed
//
// That's it. setKnownFields, yMapToTask, and TASK_FIELDS are all derived from this registry.
// You do NOT need to update them manually.

type FieldType =
  | 'string'
  | 'boolean'
  | 'json-string-array'
  | 'json-dep-array'
  | 'nullable-string'
  | 'optional-string';

interface FieldDef {
  /** Field name on the Task interface (must match exactly) */
  name: string;
  /** Serialization type — determines how the field is written to/read from Y.Map */
  type: FieldType;
}

/**
 * The field registry. Order doesn't matter — TASK_FIELDS is derived from this.
 *
 * Types:
 *   'string'            — stored as-is, defaults to ''
 *   'boolean'           — stored as-is, defaults to false
 *   'json-string-array' — JSON.stringify on write, JSON.parse on read, defaults to []
 *   'json-dep-array'    — same as json-string-array but typed as Dependency[]
 *   'nullable-string'   — stored as-is, defaults to null
 *   'optional-string'   — only written if non-null, defaults to undefined on read
 */
const FIELD_REGISTRY: FieldDef[] = [
  { name: 'id', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'startDate', type: 'string' },
  { name: 'endDate', type: 'string' },
  { name: 'owner', type: 'string' },
  { name: 'workStream', type: 'string' },
  { name: 'project', type: 'string' },
  { name: 'functionalArea', type: 'string' },
  { name: 'done', type: 'boolean' },
  { name: 'description', type: 'string' },
  { name: 'isMilestone', type: 'boolean' },
  { name: 'isSummary', type: 'boolean' },
  { name: 'parentId', type: 'nullable-string' },
  { name: 'childIds', type: 'json-string-array' },
  { name: 'dependencies', type: 'json-dep-array' },
  { name: 'notes', type: 'string' },
  { name: 'okrs', type: 'json-string-array' },
  { name: 'constraintType', type: 'optional-string' },
  { name: 'constraintDate', type: 'optional-string' },
];

/** Derived from FIELD_REGISTRY — do not edit manually. */
export const TASK_FIELDS: string[] = FIELD_REGISTRY.map((f) => f.name);

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

/**
 * Migration result.
 *
 * - 'ok': migrations ran successfully
 * - 'noop': doc already at current version
 * - 'incompatible': doc major version is higher than code — older code would corrupt data.
 *   Hard lock-out: app must block editing.
 * - 'compatible': doc minor version is higher than code — additive changes only.
 *   Older code can safely operate. Caller may show a soft "update available" banner.
 */
export type MigrateResult =
  | { status: 'ok'; fromVersion: number; toVersion: number; migrationsRun: number }
  | { status: 'incompatible'; docMajor: number; codeMajor: number }
  | { status: 'compatible'; docMinor: number; codeMinor: number }
  | { status: 'noop' };

/**
 * Migrate a Y.Doc to the current schema version.
 *
 * Version scheme: meta stores `schemaMajor` and `schemaMinor` separately.
 *
 * - Major version gates hard lock-out (breaking changes).
 * - Minor version is informational (additive changes, soft warning).
 * - Runs pending migrations in a single ORIGIN.INIT transaction (not undoable).
 * - Re-checks major version inside the transaction (CAS guard for single-client races).
 * - Idempotent: calling twice on the same doc is safe (second call returns 'noop').
 *
 * MUST be called after all persistence providers (IndexedDB, WebSocket) have synced.
 * The useDocMigration hook handles this timing.
 */
export function migrateDoc(doc: Y.Doc): MigrateResult {
  const { meta } = getDocMaps(doc);

  // Read version — fall back to legacy single-number schemaVersion for pre-major/minor docs
  let docMajor: number;
  let docMinor: number;
  if (meta.has('schemaMajor')) {
    docMajor = (meta.get('schemaMajor') as number) ?? 0;
    docMinor = (meta.get('schemaMinor') as number) ?? 0;
  } else {
    // Legacy: single schemaVersion field → treat as major, minor=0
    docMajor = (meta.get('schemaVersion') as number) ?? 0;
    docMinor = 0;
  }

  // Gate: refuse to operate on docs with a higher MAJOR version
  if (docMajor > CURRENT_MAJOR) {
    return { status: 'incompatible', docMajor, codeMajor: CURRENT_MAJOR };
  }

  // Compatible: same major, higher minor — additive changes we don't know about.
  // Safe to operate (writeTaskToDoc preserves unknown fields). Show soft warning.
  if (docMajor === CURRENT_MAJOR && docMinor > CURRENT_MINOR) {
    return { status: 'compatible', docMinor, codeMinor: CURRENT_MINOR };
  }

  // Already current
  if (docMajor === CURRENT_MAJOR && docMinor === CURRENT_MINOR) {
    return { status: 'noop' };
  }

  // Run pending migrations
  const pending = MIGRATIONS.filter((m) => m.version > docMajor);
  let migrated = false;
  doc.transact(() => {
    // Re-check inside transaction (CAS guard: if another effect or peer
    // already migrated during the async gap, skip to avoid double-run)
    const currentMajor =
      (meta.get('schemaMajor') as number) ?? (meta.get('schemaVersion') as number) ?? 0;
    if (currentMajor >= CURRENT_MAJOR) return;

    for (const m of pending) {
      m.migrate(doc);
    }
    meta.set('schemaMajor', CURRENT_MAJOR);
    meta.set('schemaMinor', CURRENT_MINOR);
    // Clean up legacy field
    if (meta.has('schemaVersion')) {
      meta.delete('schemaVersion');
    }
    migrated = true;
  }, ORIGIN.INIT);

  // CAS guard may skip the migration body if another caller already migrated.
  // In that case, the doc is at the correct version — return noop, not ok.
  if (!migrated) {
    return { status: 'noop' };
  }

  return {
    status: 'ok',
    fromVersion: docMajor,
    toVersion: CURRENT_MAJOR,
    migrationsRun: pending.length,
  };
}

// ─── Task ↔ Y.Map Conversion (registry-driven) ──────────────────────

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

/**
 * Set all known fields on a Y.Map from a Task object.
 * Driven by FIELD_REGISTRY — adding a field to the registry automatically
 * includes it here. Unknown fields on the Y.Map are preserved.
 */
function setKnownFields(ymap: Y.Map<unknown>, task: Task): void {
  for (const field of FIELD_REGISTRY) {
    const value = (task as unknown as Record<string, unknown>)[field.name];
    switch (field.type) {
      case 'string':
      case 'boolean':
      case 'nullable-string':
        ymap.set(field.name, value);
        break;
      case 'json-string-array':
      case 'json-dep-array':
        ymap.set(field.name, JSON.stringify(value));
        break;
      case 'optional-string':
        if (value != null) {
          ymap.set(field.name, value);
        } else if (ymap.has(field.name)) {
          ymap.delete(field.name);
        }
        break;
    }
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
 * Driven by FIELD_REGISTRY — adding a field to the registry automatically
 * includes it here. Computes duration from startDate/endDate.
 */
export function yMapToTask(ymap: Y.Map<unknown>): Task {
  const result: Record<string, unknown> = {};

  for (const field of FIELD_REGISTRY) {
    const raw = ymap.get(field.name);
    switch (field.type) {
      case 'string':
        result[field.name] = (raw as string) ?? '';
        break;
      case 'boolean':
        result[field.name] = (raw as boolean) ?? false;
        break;
      case 'nullable-string':
        result[field.name] = (raw as string | null) ?? null;
        break;
      case 'optional-string':
        result[field.name] = (raw as string) ?? undefined;
        break;
      case 'json-string-array':
        try {
          result[field.name] = typeof raw === 'string' ? JSON.parse(raw) : [];
        } catch {
          result[field.name] = [];
        }
        break;
      case 'json-dep-array':
        try {
          result[field.name] = typeof raw === 'string' ? JSON.parse(raw) : [];
        } catch {
          result[field.name] = [];
        }
        break;
    }
  }

  // Computed field: duration is derived, never stored
  const startDate = result.startDate as string;
  const endDate = result.endDate as string;
  result.duration = startDate && endDate ? taskDuration(startDate, endDate) : 0;

  return result as unknown as Task;
}

// Re-export for consumers
export { CURRENT_MAJOR, CURRENT_MINOR } from './migrations';
