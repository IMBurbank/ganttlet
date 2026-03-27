import * as Y from 'yjs';

/**
 * Schema migration registry.
 *
 * Each migration upgrades the Y.Doc from version N-1 to version N.
 * Migrations MUST be idempotent — in a CRDT system, two peers may independently
 * run the same migration. The result must be identical regardless of execution order.
 *
 * To add a new migration:
 *   1. Append an entry to MIGRATIONS with the next version number
 *   2. Bump CURRENT_VERSION to match
 *   3. Add an idempotency test (run migration twice, assert same Y.Doc state)
 */

export const CURRENT_VERSION = 2;

export interface Migration {
  /** Target version this migration produces */
  version: number;
  /** Human-readable description for logs */
  description: string;
  /** Idempotent migration function. Receives the Y.Doc to mutate in-place. */
  migrate: (doc: Y.Doc) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
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
