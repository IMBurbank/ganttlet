import React, { useCallback, useState, lazy, Suspense } from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { isSignedIn } from '../../sheets/oauth';
import { getRecentSheets } from '../../utils/recentSheets';
import FirstVisitWelcome from './FirstVisitWelcome';
import ReturnVisitorWelcome from './ReturnVisitorWelcome';
import CollaboratorWelcome from './CollaboratorWelcome';
import ChoosePath from './ChoosePath';
import HeaderMismatchError from './HeaderMismatchError';
import ErrorBanner from './ErrorBanner';

const PromotionFlow = lazy(() => import('./PromotionFlow'));

export default function WelcomeGate({ children }: { children: React.ReactNode }) {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  // Track if user just signed in from FirstVisit (show ChoosePath instead of FirstVisit)
  const [justSignedIn, setJustSignedIn] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);

  const onSelectSheet = useCallback(
    (sheetId: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set('sheet', sheetId);
      url.searchParams.set('room', sheetId);
      window.history.replaceState({}, '', url.toString());
      dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'loading' });
      // Force re-render by reloading — the GanttContext useEffect picks up the URL params
      window.location.reload();
    },
    [dispatch]
  );

  // If dataSource is defined, the app is initialized — render children
  if (state.dataSource !== undefined) {
    // Header mismatch error takes priority over loading skeleton
    if (state.dataSource === 'loading' && state.syncError?.type === 'header_mismatch') {
      return <HeaderMismatchError />;
    }
    // Loading skeleton for loading state — show ErrorBanner if sync error exists
    if (state.dataSource === 'loading') {
      return (
        <div className="flex flex-col h-screen bg-surface-base" data-testid="loading-skeleton">
          {state.syncError && <ErrorBanner />}
          {/* Skeleton header */}
          <div className="h-12 border-b border-border-default bg-surface-raised animate-pulse" />
          {/* Skeleton toolbar */}
          <div className="h-10 border-b border-border-default bg-surface-raised/50 animate-pulse" />
          {/* Skeleton content */}
          <div className="flex flex-1 min-h-0">
            <div className="w-80 border-r border-border-default">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 border-b border-border-default px-3 flex items-center">
                  <div className="h-3 bg-surface-hover rounded w-3/4 animate-pulse" />
                </div>
              ))}
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-text-muted">Loading project...</span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <>
        {state.dataSource === 'sandbox' && (
          <div
            className="bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 px-4 py-2 text-sm flex items-center justify-center gap-2"
            data-testid="sandbox-banner"
          >
            <span>You&apos;re exploring a demo project. Nothing is saved.</span>
            <button
              onClick={() => setShowPromotion(true)}
              className="underline font-medium hover:text-amber-700 dark:hover:text-amber-100 transition-colors"
              data-testid="save-to-sheet-button"
            >
              Save to Google Sheet
            </button>
          </div>
        )}
        {showPromotion && (
          <Suspense fallback={null}>
            <PromotionFlow onClose={() => setShowPromotion(false)} />
          </Suspense>
        )}
        {children}
      </>
    );
  }

  // Check URL params
  const params = new URLSearchParams(window.location.search);
  const hasSheetOrRoom = params.has('sheet') || params.has('room');

  if (hasSheetOrRoom) {
    if (isSignedIn()) {
      // Signed in with URL params — render children; GanttContext useEffect handles loading
      return <>{children}</>;
    }
    // Not signed in with URL params — show collaborator welcome
    return <CollaboratorWelcome />;
  }

  // No URL params
  const signedIn = isSignedIn();
  const recentSheets = getRecentSheets();

  // If user just signed in from FirstVisit, show ChoosePath
  if (justSignedIn && signedIn) {
    return <ChoosePath onSelectSheet={onSelectSheet} />;
  }

  if (signedIn && recentSheets.length > 0) {
    return <ReturnVisitorWelcome onSelectSheet={onSelectSheet} />;
  }

  if (signedIn) {
    return <ChoosePath onSelectSheet={onSelectSheet} />;
  }

  return <FirstVisitWelcome onSignInComplete={() => setJustSignedIn(true)} />;
}
