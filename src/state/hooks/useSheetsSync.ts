import { useEffect, useRef, type RefObject } from 'react';
import * as Y from 'yjs';
import type { UIStore } from '../../store/UIStore';
import type { ConflictRecord } from '../../types';
import { SheetsAdapter } from '../../sheets/SheetsAdapter';
import {
  getAccessToken,
  setAuthChangeCallback,
  removeAuthChangeCallback,
} from '../../sheets/oauth';
import { connectCollab } from '../../collab/yjsProvider';
import { updateTaskField } from '../../mutations';

export function useSheetsSync(
  doc: Y.Doc,
  spreadsheetId: string | undefined,
  uiStore: UIStore | null,
  roomId: string | undefined,
  accessToken: string | undefined,
  undoManagerRef: RefObject<Y.UndoManager | null>
): RefObject<SheetsAdapter | null> {
  const adapterRef = useRef<SheetsAdapter | null>(null);

  useEffect(() => {
    if (!spreadsheetId || !uiStore) return;

    // Clear undo stack on sandbox->sheet promotion
    if (undoManagerRef.current) {
      undoManagerRef.current.clear();
    }

    const adapter = new SheetsAdapter(
      doc,
      spreadsheetId,
      {
        onConflict: (conflicts: ConflictRecord[]) => {
          uiStore.setState({ pendingConflicts: conflicts });
        },
        onSyncError: (error) => {
          uiStore.setState({ syncError: error });
        },
        onSyncing: (syncing) => {
          uiStore.setState({ isSyncing: syncing });
        },
        onSyncComplete: () => {
          uiStore.setState({ syncComplete: true, dataSource: 'sheet' });
        },
      },
      getAccessToken
    );

    adapterRef.current = adapter;
    uiStore.setState({ dataSource: 'loading' });
    adapter.start();

    // beforeunload guard for sheet mode
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (adapter.isSavePending()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // Auth token refresh: restart adapter polling on token change
    const authChangeHandler = () => {
      // Token refreshed — adapter will pick it up on next poll/write via getAccessToken
      // Reconnect collab if needed
      if (roomId && accessToken) {
        connectCollab(roomId, accessToken, doc);
      }
    };
    setAuthChangeCallback(authChangeHandler);

    // Conflict resolution event handler
    const conflictResolveHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { taskId: string; field: string; value: unknown };
      updateTaskField(doc, detail.taskId, detail.field, detail.value);
    };
    window.addEventListener('ganttlet:conflict-resolve', conflictResolveHandler);

    return () => {
      adapter.stop();
      adapterRef.current = null;
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      removeAuthChangeCallback(authChangeHandler);
      window.removeEventListener('ganttlet:conflict-resolve', conflictResolveHandler);
    };
  }, [spreadsheetId, doc, uiStore, roomId, accessToken, undoManagerRef]);

  return adapterRef;
}
