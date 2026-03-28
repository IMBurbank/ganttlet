import React, { useCallback, useContext } from 'react';
import { useUIStore } from '../../hooks';
import { UIStoreContext } from '../../store/UIStore';
import { SheetsAdapterContext } from '../../state/TaskStoreProvider';
import { signIn, setAuthChangeCallback, removeAuthChangeCallback } from '../../sheets/oauth';
import { removeRecentSheet } from '../../utils/recentSheets';
import type { SyncError } from '../../types';

export default function ErrorBanner() {
  const syncError = useUIStore((s) => s.syncError);
  const dataSource = useUIStore((s) => s.dataSource);
  const uiStore = useContext(UIStoreContext);
  const adapter = useContext(SheetsAdapterContext);

  const handleReAuth = useCallback(() => {
    const onAuthChange = () => {
      uiStore?.setState({ syncError: null });
      removeAuthChangeCallback(onAuthChange);
      adapter?.restart();
    };
    setAuthChangeCallback(onAuthChange);
    signIn();
  }, [uiStore, adapter]);

  const handleOpenAnother = useCallback(() => {
    // Navigate to root (removes ?sheet= param)
    window.location.href = window.location.pathname;
  }, []);

  const handleRetry = useCallback(() => {
    uiStore?.setState({ syncError: null, dataSource: 'loading' });
    adapter?.restart();
  }, [uiStore, adapter]);

  if (!syncError) return null;
  if (syncError.type === 'rate_limit' || syncError.type === 'header_mismatch') return null;

  const isLoading = dataSource === 'loading';
  const sheetId = new URLSearchParams(window.location.search).get('sheet');

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
              if (syncError.type === 'not_found' && sheetId) {
                removeRecentSheet(sheetId);
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
