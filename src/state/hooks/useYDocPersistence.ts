import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

/**
 * Attach y-indexeddb persistence to a Y.Doc for crash recovery.
 *
 * Returns { isSynced } — true when IndexedDB restore is complete (or immediately
 * if no roomId is provided, meaning no persistence is needed).
 *
 * The isSynced flag gates schema migration: migrateDoc() must not run until
 * IndexedDB has restored any prior session state, otherwise migration ops may
 * lose to restored ops with higher lamport timestamps.
 */
export function useYDocPersistence(doc: Y.Doc, roomId?: string): { isSynced: boolean } {
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);
  const [isSynced, setIsSynced] = useState(!roomId);

  useEffect(() => {
    if (!roomId) {
      setIsSynced(true);
      return;
    }

    setIsSynced(false);
    const persistence = new IndexeddbPersistence(`ganttlet-${roomId}`, doc);
    persistenceRef.current = persistence;

    persistence.on('synced', () => {
      setIsSynced(true);
    });

    return () => {
      persistence.destroy();
      persistenceRef.current = null;
      setIsSynced(false);
    };
  }, [doc, roomId]);

  return { isSynced };
}
