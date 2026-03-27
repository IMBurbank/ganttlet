import * as Y from 'yjs';

/**
 * Schema migration registry.
 *
 * ## Version scheme: major.minor
 *
 * **Major version** — breaking changes that older code cannot safely handle.
 *   Examples: rename a field, change field semantics, restructure data layout.
 *   Older code operating on a newer-major doc would misinterpret or corrupt data.
 *   → Hard lock-out: SchemaIncompatibleError blocks the app.
 *
 * **Minor version** — additive changes that older code can safely ignore.
 *   Examples: add optional fields, remove unused fields, add optional Sheet columns.
 *   Older code reads unknown fields as defaults; writeTaskToDoc preserves unknown fields.
 *   → Soft warning: "A newer version is available. Refresh when convenient."
 *
 * This distinction matters during rolling deployments: when CDN caches update over
 * minutes, some users temporarily run older code. Minor-version changes don't lock
 * anyone out. Major-version changes do — and should be deployed carefully.
 *
 * ## Migration rules
 *
 * - Migrations MUST be idempotent — in a CRDT system, two peers may independently
 *   run the same migration. The result must be identical regardless of execution order.
 * - The first peer to connect runs the migration; ops propagate to all peers via CRDT.
 *
 * ## To add a migration
 *
 *   1. Append an entry to MIGRATIONS with the next version number
 *   2. Set `breaking: true` if older code would corrupt data, `false` if additive
 *   3. Bump CURRENT_MAJOR if breaking, CURRENT_MINOR if additive
 *   4. Add an idempotency test (run migration twice, assert same Y.Doc state)
 */

/** Major version — gates hard lock-out. Bump only for breaking changes. */
export const CURRENT_MAJOR = 2;

/** Minor version — informational. Bump for additive/compatible changes. */
export const CURRENT_MINOR = 0;

export interface Migration {
  /** Target version this migration produces (major version) */
  version: number;
  /** Whether this migration is breaking (locks out older code) or additive (soft warning) */
  breaking: boolean;
  /** Human-readable description for logs */
  description: string;
  /** Idempotent migration function. Receives the Y.Doc to mutate in-place. */
  migrate: (doc: Y.Doc) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    breaking: true,
    description: 'Phase 20: strip isExpanded/isHidden from task Y.Maps',
    migrate: (doc: Y.Doc) => {
      const tasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
      tasks.forEach((ymap) => {
        if (ymap.has('isExpanded')) ymap.delete('isExpanded');
        if (ymap.has('isHidden')) ymap.delete('isHidden');
      });
    },
  },
];
