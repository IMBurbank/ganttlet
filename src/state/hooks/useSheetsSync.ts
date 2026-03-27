import { useEffect, useRef, type RefObject } from 'react';
import * as Y from 'yjs';
import type { UIStore } from '../../store/UIStore';
import type { ConflictRecord } from '../../types';
import { SheetsAdapter } from '../../sheets/SheetsAdapter';
import { getAccessToken } from '../../sheets/oauth';
import { updateTaskField } from '../../mutations';

export function useSheetsSync(
  doc: Y.Doc,
  spreadsheetId: string | undefined,
  uiStore: UIStore | null,
  undoManagerRef: RefObject<Y.UndoManager | null>,
  accessToken: string | undefined
): RefObject<SheetsAdapter | null> {
  const adapterRef = useRef<SheetsAdapter | null>(null);

  useEffect(() => {
    if (!spreadsheetId || !uiStore || !accessToken) return;

    // Guard: if the adapter is already running for this spreadsheetId, don't
    // tear it down on token refresh. The adapter uses getAccessToken() (callback)
    // for all API calls, so it automatically picks up refreshed tokens.
    if (
      adapterRef.current &&
      !adapterRef.current.isStopped() &&
      adapterRef.current.getSpreadsheetId() === spreadsheetId
    ) {
      return;
    }

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
      window.removeEventListener('ganttlet:conflict-resolve', conflictResolveHandler);
    };
  }, [spreadsheetId, doc, uiStore, undoManagerRef, accessToken]);

  return adapterRef;
}
