import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { migrateDoc, type MigrateResult } from '../../schema/ydoc';

/**
 * Gate schema migration on persistence sync.
 *
 * Returns null while waiting for sync, then the MigrateResult once migration
 * has run. The outer TaskStoreProvider uses this to block rendering of the
 * inner component until migration is complete — making it structurally
 * impossible to use an unmigrated Y.Doc.
 */
export function useDocMigration(doc: Y.Doc, isSynced: boolean): MigrateResult | null {
  const [result, setResult] = useState<MigrateResult | null>(null);

  useEffect(() => {
    if (!isSynced) return;
    const migrationResult = migrateDoc(doc);
    setResult(migrationResult);
  }, [doc, isSynced]);

  return result;
}
