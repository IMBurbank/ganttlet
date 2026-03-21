import React, { useCallback } from 'react';
import { SHEET_COLUMNS } from '../../sheets/sheetsMapper';
import { useGanttState } from '../../state/GanttContext';

export default function HeaderMismatchError() {
  const { syncError, dataSource } = useGanttState();

  const handleDownloadTemplate = useCallback(() => {
    const csvContent = SHEET_COLUMNS.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ganttlet-header-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleNewSheet = useCallback(() => {
    // Navigate to root to start fresh (removes ?sheet= param)
    window.location.href = window.location.pathname;
  }, []);

  if (syncError?.type !== 'header_mismatch' || dataSource !== 'loading') {
    return null;
  }

  return (
    <div
      className="flex flex-col items-center justify-center h-screen bg-surface-base text-text-primary p-8"
      data-testid="header-mismatch-error"
    >
      <h1 className="text-2xl font-bold mb-4">Column Mismatch</h1>
      <p className="text-text-muted mb-6 text-center max-w-lg">
        The sheet headers don't match the expected format. Ganttlet requires specific columns to
        sync properly.
      </p>

      <div className="flex gap-8 mb-8 max-w-2xl w-full">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Expected Columns</h2>
          <ul
            className="text-xs text-text-muted space-y-1 bg-surface-overlay rounded p-3 border border-border-subtle"
            data-testid="expected-columns"
          >
            {SHEET_COLUMNS.map((col) => (
              <li key={col} className="font-mono">
                {col}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Found in Sheet</h2>
          <p
            className="text-xs text-text-muted bg-surface-overlay rounded p-3 border border-border-subtle"
            data-testid="found-columns"
          >
            Headers did not match the expected format.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleNewSheet}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          data-testid="create-new-sheet-btn"
        >
          Create a new sheet instead
        </button>
        <button
          onClick={handleDownloadTemplate}
          className="px-4 py-2 bg-surface-overlay text-text-primary rounded-lg hover:bg-surface-raised transition-colors font-medium text-sm border border-border-subtle"
          data-testid="download-template-btn"
        >
          Download header template
        </button>
      </div>
    </div>
  );
}
