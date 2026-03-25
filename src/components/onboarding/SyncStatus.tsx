import React from 'react';
import { useUIStore } from '../../hooks';

export default function SyncStatus() {
  const isSyncing = useUIStore((s) => s.isSyncing);
  const syncComplete = useUIStore((s) => s.syncComplete);
  const syncError = useUIStore((s) => s.syncError);

  const isRateLimited = syncError?.type === 'rate_limit';

  let label: string;
  let className: string;

  if (isRateLimited) {
    label = 'Sync paused — retrying automatically';
    className = 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50';
  } else if (syncComplete) {
    label = 'Synced';
    className = 'bg-green-900/50 text-green-400 border border-green-700/50';
  } else if (isSyncing) {
    label = 'Syncing...';
    className = 'bg-blue-900/50 text-blue-400 border border-blue-700/50';
  } else {
    label = 'Synced';
    className = 'text-text-secondary border border-transparent';
  }

  return (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${className}`}
      data-testid="sync-status"
    >
      {syncComplete && !isRateLimited ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-green-400"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={isSyncing ? 'sync-spinning' : ''}
        >
          <path d="M21 2v6h-6" />
          <path d="M3 12a9 9 0 0115-6.7L21 8" />
          <path d="M3 22v-6h6" />
          <path d="M21 12a9 9 0 01-15 6.7L3 16" />
        </svg>
      )}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
