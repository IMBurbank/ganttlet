import React from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import UserPresence from '../panels/UserPresence';
import SyncStatusIndicator from '../panels/SyncStatusIndicator';

export default function Header() {
  const { isHistoryPanelOpen, theme } = useGanttState();
  const dispatch = useGanttDispatch();

  return (
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
        <span className="text-xs text-text-muted border-l border-border-default pl-3">Q2 Product Launch</span>
      </div>
      <div className="flex items-center gap-4">
        <UserPresence />
        <SyncStatusIndicator />
        {/* Theme toggle */}
        <button
          onClick={() => dispatch({ type: 'SET_THEME', theme: theme === 'dark' ? 'light' : 'dark' })}
          className="flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          History
        </button>
      </div>
    </header>
  );
}
