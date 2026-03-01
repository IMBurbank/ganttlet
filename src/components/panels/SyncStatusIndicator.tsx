import React, { useCallback } from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { loadFromSheet, getSpreadsheetId } from '../../sheets/sheetsSync';
import { isSignedIn } from '../../sheets/oauth';

export default function SyncStatusIndicator() {
  const { isSyncing, syncComplete } = useGanttState();
  const dispatch = useGanttDispatch();

  const sheetConnected = !!getSpreadsheetId() && isSignedIn();

  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    if (getSpreadsheetId() && isSignedIn()) {
      const tasks = await loadFromSheet();
      if (tasks.length > 0) {
        dispatch({ type: 'SET_TASKS', tasks });
      }
    } else {
      // Fake sync for demo mode
      dispatch({ type: 'START_SYNC' });
      setTimeout(() => {
        dispatch({ type: 'COMPLETE_SYNC' });
        setTimeout(() => dispatch({ type: 'RESET_SYNC' }), 2000);
      }, 1500);
    }
  }, [dispatch, isSyncing]);

  return (
    <button
      onClick={handleSync}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
        syncComplete
          ? 'bg-green-900/50 text-green-400 border border-green-700/50'
          : isSyncing
            ? 'bg-blue-900/50 text-blue-400 border border-blue-700/50'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-transparent'
      }`}
      disabled={isSyncing}
    >
      {syncComplete ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={isSyncing ? 'sync-spinning' : ''}
        >
          <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0115-6.7L21 8" />
          <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 01-15 6.7L3 16" />
        </svg>
      )}
      <span className="hidden sm:inline">
        {syncComplete ? 'Synced' : isSyncing ? 'Syncing...' : sheetConnected ? 'Sync Sheets' : 'No Sheet'}
      </span>
    </button>
  );
}
