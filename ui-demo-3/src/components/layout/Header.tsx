import React from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import UserPresence from '../panels/UserPresence';
import SyncStatusIndicator from '../panels/SyncStatusIndicator';

export default function Header() {
  const { isHistoryPanelOpen } = useGanttState();
  const dispatch = useGanttDispatch();

  return (
    <header className="flex items-center justify-between px-4 h-12 bg-gray-900 border-b border-gray-800 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-blue-400">
            <rect x="2" y="4" width="8" height="3" rx="1" fill="currentColor" opacity="0.9" />
            <rect x="4" y="9" width="12" height="3" rx="1" fill="currentColor" opacity="0.7" />
            <rect x="3" y="14" width="6" height="3" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="6" y="19" width="16" height="3" rx="1" fill="currentColor" opacity="0.3" />
          </svg>
          <h1 className="text-base font-bold text-white tracking-tight">Ganttlet</h1>
        </div>
        <span className="text-xs text-gray-500 border-l border-gray-700 pl-3">Q2 Product Launch</span>
      </div>
      <div className="flex items-center gap-4">
        <UserPresence />
        <SyncStatusIndicator />
        <button
          onClick={() => dispatch({ type: 'TOGGLE_HISTORY_PANEL' })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            isHistoryPanelOpen
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
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
