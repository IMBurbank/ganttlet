import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export function useYDocPersistence(doc: Y.Doc, roomId?: string): void {
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);

  useEffect(() => {
    if (!roomId) return;

    const persistence = new IndexeddbPersistence(`ganttlet-${roomId}`, doc);
    persistenceRef.current = persistence;

    persistence.on('synced', () => {
      console.log('IndexedDB persistence synced for room:', roomId);
    });

    return () => {
      persistence.destroy();
      persistenceRef.current = null;
    };
  }, [doc, roomId]);
}
