import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { UIStore } from '../../store/UIStore';
import type { ConflictRecord } from '../../types';
import { SheetsAdapter } from '../../sheets/SheetsAdapter';
import { getAccessToken } from '../../sheets/oauth';
import { updateTaskField } from '../../mutations';

/**
 * Manages SheetsAdapter lifecycle. Returns the adapter via state (not ref)
 * so consumers re-render when the adapter is created/destroyed.
 *
 * The accessToken prop is in the dependency array because the effect must
 * re-run when the user signs in (token goes from null → value). However,
 * a running adapter for the same spreadsheetId is NOT torn down on token
 * refresh — the adapter uses getAccessToken() callback internally.
 */
export function useSheetsSync(
  doc: Y.Doc,
  spreadsheetId: string | undefined,
  uiStore: UIStore | null,
  undoManagerRef: React.RefObject<Y.UndoManager | null>,
  accessToken: string | undefined
): SheetsAdapter | null {
  const [adapter, setAdapter] = useState<SheetsAdapter | null>(null);
  // Track the running adapter imperatively to avoid teardown on token refresh
  const runningRef = useRef<SheetsAdapter | null>(null);

  useEffect(() => {
    if (!spreadsheetId || !uiStore || !accessToken) return;

    // Guard: if the adapter is already running for this spreadsheetId, don't
    // tear it down on token refresh. The adapter uses getAccessToken() (callback)
    // for all API calls, so it automatically picks up refreshed tokens.
    if (
      runningRef.current &&
      !runningRef.current.isStopped() &&
      runningRef.current.getSpreadsheetId() === spreadsheetId
    ) {
      return;
    }

    // Clear undo stack on sandbox->sheet promotion
    if (undoManagerRef.current) {
      undoManagerRef.current.clear();
    }

    const newAdapter = new SheetsAdapter(
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

    runningRef.current = newAdapter;
    setAdapter(newAdapter);
    uiStore.setState({ dataSource: 'loading' });
    newAdapter.start();

    // beforeunload guard for sheet mode
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (newAdapter.isSavePending()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // Conflict resolution event handler — also clear from notifiedConflicts
    // so the same field can be re-reported if the conflict recurs.
    const conflictResolveHandler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { taskId: string; field: string; value: unknown };
      updateTaskField(doc, detail.taskId, detail.field, detail.value);
      await newAdapter.clearConflict(detail.taskId, detail.field);
    };
    window.addEventListener('ganttlet:conflict-resolve', conflictResolveHandler);

    return () => {
      newAdapter.stop();
      runningRef.current = null;
      setAdapter(null);
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('ganttlet:conflict-resolve', conflictResolveHandler);
    };
  }, [spreadsheetId, doc, uiStore, undoManagerRef, accessToken]);

  return adapter;
}
