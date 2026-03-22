import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import UserPresence from '../panels/UserPresence';
import SyncStatus from '../onboarding/SyncStatus';
import ErrorBanner from '../onboarding/ErrorBanner';
import {
  initOAuth,
  signIn,
  signOut,
  getAuthState,
  getAccessToken,
  setAuthChangeCallback,
  removeAuthChangeCallback,
  type AuthState,
} from '../../sheets/oauth';
import { stopPolling } from '../../sheets/sheetsSync';
import { disconnectCollab } from '../../collab/yjsProvider';

const SheetSelector = lazy(() => import('../onboarding/SheetSelector'));
const TemplatePicker = lazy(() => import('../onboarding/TemplatePicker'));

export default function Header() {
  const { isHistoryPanelOpen, theme, dataSource } = useGanttState();
  const dispatch = useGanttDispatch();
  const [auth, setAuth] = useState<AuthState>(getAuthState());

  useEffect(() => {
    initOAuth();
    const handleAuthChange = (newState: AuthState) => setAuth({ ...newState });
    setAuthChangeCallback(handleAuthChange);
    return () => removeAuthChangeCallback(handleAuthChange);
  }, []);

  const [copied, setCopied] = useState(false);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get sheet ID from URL
  const sheetId = new URLSearchParams(window.location.search).get('sheet');
  const isSheetConnected = dataSource === 'sheet' && !!auth.accessToken;

  // Fetch sheet title when connected
  useEffect(() => {
    if (!isSheetConnected || !sheetId) return;
    const token = getAccessToken();
    if (!token) return;
    fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.properties?.title) setSheetTitle(data.properties.title);
      })
      .catch(() => {});
  }, [isSheetConnected, sheetId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const handleShare = useCallback(() => {
    const url = new URL(window.location.href);
    if (sheetId && !url.searchParams.has('room')) {
      url.searchParams.set('room', sheetId);
    }
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }, [sheetId]);

  const handleSignIn = useCallback(() => signIn(), []);
  const handleSignOut = useCallback(() => signOut(), []);

  const handleOpenInSheets = useCallback(() => {
    if (sheetId) {
      window.open(`https://docs.google.com/spreadsheets/d/${sheetId}`, '_blank');
    }
    setDropdownOpen(false);
  }, [sheetId]);

  const handleSwitchSheet = useCallback(() => {
    // Teardown current connection first
    stopPolling();
    disconnectCollab();
    setDropdownOpen(false);
    setShowSheetSelector(true);
  }, []);

  const handleSelectSheet = useCallback(
    (newSheetId: string) => {
      setShowSheetSelector(false);
      const url = new URL(window.location.href);
      url.searchParams.set('sheet', newSheetId);
      url.searchParams.set('room', newSheetId);
      window.history.replaceState({}, '', url.toString());
      dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'loading' });
      window.location.reload();
    },
    [dispatch]
  );

  const handleCreateNew = useCallback(() => {
    setDropdownOpen(false);
    setShowTemplatePicker(true);
  }, []);

  const handleDisconnect = useCallback(() => {
    setShowDisconnectConfirm(false);
    setDropdownOpen(false);
    // Clear URL params
    const url = new URL(window.location.href);
    url.searchParams.delete('sheet');
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
    // Teardown
    stopPolling();
    disconnectCollab();
    // Reset state — auth persists in localStorage
    dispatch({ type: 'RESET_STATE' });
  }, [dispatch]);

  const shareToast = copied
    ? 'Link copied. Anyone with access to the Google Sheet can collaborate.'
    : null;

  return (
    <>
      <ErrorBanner />
      <header className="flex items-center justify-between px-4 h-12 bg-surface-raised border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-blue-400">
              <rect x="2" y="4" width="8" height="3" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="4" y="9" width="12" height="3" rx="1" fill="currentColor" opacity="0.7" />
              <rect x="3" y="14" width="6" height="3" rx="1" fill="currentColor" opacity="0.5" />
              <rect x="6" y="19" width="16" height="3" rx="1" fill="currentColor" opacity="0.3" />
            </svg>
            <h1 className="text-base font-bold text-text-primary tracking-tight">Ganttlet</h1>
          </div>
          {isSheetConnected && sheetTitle ? (
            <a
              href={`https://docs.google.com/spreadsheets/d/${sheetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-muted border-l border-border-default pl-3 hover:text-blue-400 transition-colors truncate max-w-[200px]"
              data-testid="sheet-title"
              title={sheetTitle}
            >
              {sheetTitle}
            </a>
          ) : (
            <span className="text-xs text-text-muted border-l border-border-default pl-3">
              {isSheetConnected ? 'Loading...' : 'Ganttlet'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <UserPresence />
          <SyncStatus />
          {/* Share button */}
          <div className="relative">
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
              data-testid="share-button"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
              {copied ? 'Copied!' : 'Share'}
            </button>
            {shareToast && (
              <div
                className="absolute top-full right-0 mt-1 px-3 py-2 bg-surface-overlay text-text-primary text-xs rounded shadow-lg whitespace-nowrap z-50"
                data-testid="share-toast"
              >
                {shareToast}
              </div>
            )}
          </div>
          {/* Sheet dropdown (only when connected to sheet) */}
          {isSheetConnected && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
                data-testid="sheet-dropdown-trigger"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>
              {dropdownOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-48 bg-surface-base border border-border-default rounded-lg shadow-lg z-50 py-1"
                  data-testid="sheet-dropdown-menu"
                >
                  <button
                    onClick={handleOpenInSheets}
                    className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors"
                    data-testid="menu-open-sheets"
                  >
                    Open in Google Sheets
                  </button>
                  <button
                    onClick={handleSwitchSheet}
                    className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors"
                    data-testid="menu-switch-sheet"
                  >
                    Switch sheet
                  </button>
                  <button
                    onClick={handleCreateNew}
                    className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors"
                    data-testid="menu-create-new"
                  >
                    Create new project
                  </button>
                  <div className="border-t border-border-default my-1" />
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowDisconnectConfirm(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-surface-hover transition-colors"
                    data-testid="menu-disconnect"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Google Sign-In */}
          {auth.accessToken ? (
            <div className="flex items-center gap-2">
              {auth.userPicture && (
                <img
                  src={auth.userPicture}
                  alt={auth.userName || 'User'}
                  className="w-6 h-6 rounded-full"
                  referrerPolicy="no-referrer"
                />
              )}
              <span className="text-xs text-text-secondary hidden sm:inline">
                {auth.userName || auth.userEmail}
              </span>
              <button
                onClick={handleSignOut}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Sign in
            </button>
          )}
          {/* Theme toggle */}
          <button
            onClick={() =>
              dispatch({ type: 'SET_THEME', theme: theme === 'dark' ? 'light' : 'dark' })
            }
            className="flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_HISTORY_PANEL' })}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              isHistoryPanelOpen
                ? 'bg-blue-600 text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            History
          </button>
        </div>
      </header>
      {/* Disconnect confirmation dialog */}
      {showDisconnectConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          data-testid="disconnect-confirm"
        >
          <div className="bg-surface-base rounded-lg shadow-lg p-6 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-text-primary mb-2">
              Disconnect from this sheet?
            </h3>
            <p className="text-xs text-text-muted mb-4">
              Your data will remain in the Google Sheet. You can reconnect anytime.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDisconnectConfirm(false)}
                className="px-3 py-1.5 text-xs rounded border border-border-default text-text-secondary hover:bg-surface-hover transition-colors"
                data-testid="disconnect-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                data-testid="disconnect-confirm-btn"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Sheet selector modal */}
      {showSheetSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Suspense fallback={null}>
            <SheetSelector onSelectSheet={handleSelectSheet} />
          </Suspense>
        </div>
      )}
      {/* Template picker modal */}
      {showTemplatePicker && (
        <Suspense fallback={null}>
          <TemplatePicker
            onSelect={(templateId) => {
              setShowTemplatePicker(false);
              // Import and call createProjectFromTemplate
              import('../../sheets/sheetCreation').then(({ createProjectFromTemplate }) => {
                createProjectFromTemplate(`Ganttlet Project`, templateId, dispatch);
              });
            }}
            onClose={() => setShowTemplatePicker(false)}
          />
        </Suspense>
      )}
    </>
  );
}
