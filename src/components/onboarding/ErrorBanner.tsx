import React, { useCallback } from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { signIn, setAuthChangeCallback, removeAuthChangeCallback } from '../../sheets/oauth';
import {
  loadFromSheet,
  scheduleSave,
  stopPolling,
  getSpreadsheetId,
} from '../../sheets/sheetsSync';
import { classifySyncError } from '../../sheets/syncErrors';
import type { SyncError } from '../../types';

export default function ErrorBanner() {
  const { syncError, dataSource, tasks } = useGanttState();
  const dispatch = useGanttDispatch();

  const handleReAuth = useCallback(() => {
    const onAuthChange = () => {
      dispatch({ type: 'SET_SYNC_ERROR', error: null });
      scheduleSave(tasks);
      removeAuthChangeCallback(onAuthChange);
    };
    setAuthChangeCallback(onAuthChange);
    signIn();
  }, [dispatch, tasks]);

  const handleOpenAnother = useCallback(() => {
    // Navigate to root (removes ?sheet= param)
    window.location.href = window.location.pathname;
  }, []);

  const handleRetry = useCallback(() => {
    dispatch({ type: 'SET_SYNC_ERROR', error: null });
    dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'loading' });
    loadFromSheet()
      .then((loadedTasks) => {
        if (loadedTasks.length > 0) {
          dispatch({ type: 'SET_TASKS', tasks: loadedTasks });
          dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
        } else {
          dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'empty' });
        }
      })
      .catch((err) => {
        dispatch({ type: 'SET_SYNC_ERROR', error: classifySyncError(err) });
      });
  }, [dispatch]);

  if (!syncError) return null;
  if (syncError.type === 'rate_limit' || syncError.type === 'header_mismatch') return null;

  const isLoading = dataSource === 'loading';
  const sheetId = getSpreadsheetId();

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-sm border-b border-border-subtle bg-surface-overlay"
      data-testid="error-banner"
    >
      <span className="text-yellow-400">&#9888;</span>
      <span className="text-text-primary flex-1">{renderMessage(syncError, handleReAuth)}</span>
      <div className="flex items-center gap-2">
        {(syncError.type === 'not_found' || syncError.type === 'forbidden') && (
          <button
            onClick={() => {
              stopPolling();
              if (syncError.type === 'not_found' && sheetId) {
                // TODO: removeRecentSheet(sheetId) — wired after Group B merge
              }
              handleOpenAnother();
            }}
            className="px-2 py-1 rounded text-xs font-medium text-blue-400 hover:bg-blue-900/30 transition-colors"
            data-testid="open-another-btn"
          >
            Open another sheet
          </button>
        )}
        {syncError.type === 'auth' && (
          <button
            onClick={handleOpenAnother}
            className="px-2 py-1 rounded text-xs font-medium text-blue-400 hover:bg-blue-900/30 transition-colors"
            data-testid="open-another-btn"
          >
            Open another sheet
          </button>
        )}
        {isLoading &&
          (syncError.type === 'auth' ||
            syncError.type === 'not_found' ||
            syncError.type === 'forbidden') && (
            <button
              onClick={handleRetry}
              className="px-2 py-1 rounded text-xs font-medium text-blue-400 hover:bg-blue-900/30 transition-colors"
              data-testid="retry-btn"
            >
              Retry
            </button>
          )}
      </div>
    </div>
  );
}

function renderMessage(syncError: SyncError, handleReAuth: () => void): React.ReactNode {
  switch (syncError.type) {
    case 'auth':
      return (
        <>
          Session expired.{' '}
          <button
            onClick={handleReAuth}
            className="underline text-blue-400 hover:text-blue-300"
            data-testid="reauth-btn"
          >
            Re-authorize
          </button>{' '}
          to keep syncing.
        </>
      );
    case 'not_found':
      return "Can't access this sheet. It may have been deleted.";
    case 'forbidden':
      return "Can't access this sheet. It may have been deleted.";
    case 'network':
      return "You're offline. Changes saved locally.";
    default:
      return syncError.message;
  }
}
