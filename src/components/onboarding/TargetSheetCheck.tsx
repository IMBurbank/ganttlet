import { useState, useEffect } from 'react';
import { readSheet } from '../../sheets/sheetsClient';
import { validateHeaders } from '../../sheets/sheetsMapper';
import { rowsToTasks } from '../../sheets/sheetsMapper';

export type TargetSheetAction = 'proceed' | 'replace' | 'open-existing' | 'create-new';

interface TargetSheetCheckProps {
  spreadsheetId: string;
  onAction: (action: TargetSheetAction) => void;
  onCancel: () => void;
}

type SheetState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'empty' }
  | { type: 'ganttlet'; taskCount: number }
  | { type: 'non-ganttlet' };

export default function TargetSheetCheck({
  spreadsheetId,
  onAction,
  onCancel,
}: TargetSheetCheckProps) {
  const [sheetState, setSheetState] = useState<SheetState>({ type: 'loading' });

  useEffect(() => {
    let cancelled = false;

    readSheet(spreadsheetId, 'Sheet1')
      .then((rows) => {
        if (cancelled) return;

        // Empty sheet: no rows, or single blank row
        if (rows.length === 0 || (rows.length === 1 && rows[0].every((c) => !c))) {
          setSheetState({ type: 'empty' });
          return;
        }

        // Check if headers match Ganttlet format
        if (validateHeaders(rows[0])) {
          const tasks = rowsToTasks(rows);
          setSheetState({ type: 'ganttlet', taskCount: tasks.length });
        } else {
          setSheetState({ type: 'non-ganttlet' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to read sheet';
        setSheetState({ type: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [spreadsheetId]);

  // Auto-proceed for empty sheets
  useEffect(() => {
    if (sheetState.type === 'empty') {
      onAction('proceed');
    }
  }, [sheetState, onAction]);

  if (sheetState.type === 'loading') {
    return (
      <div className="p-6 text-center" data-testid="target-check-loading">
        <p className="text-text-muted">Checking sheet contents…</p>
      </div>
    );
  }

  if (sheetState.type === 'error') {
    return (
      <div className="p-6" data-testid="target-check-error">
        <p className="text-red-500 mb-4">{sheetState.message}</p>
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
        >
          Back
        </button>
      </div>
    );
  }

  if (sheetState.type === 'ganttlet') {
    return (
      <div className="p-6 flex flex-col gap-4" data-testid="target-check-ganttlet">
        <p className="text-text-primary">
          This sheet has {sheetState.taskCount} existing task{sheetState.taskCount !== 1 ? 's' : ''}
          . Replace them with your current project, or open the existing data instead?
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onAction('replace')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            data-testid="replace-button"
          >
            Replace
          </button>
          <button
            onClick={() => onAction('open-existing')}
            className="px-4 py-2 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
            data-testid="open-existing-button"
          >
            Open existing
          </button>
        </div>
      </div>
    );
  }

  if (sheetState.type === 'non-ganttlet') {
    return (
      <div className="p-6 flex flex-col gap-4" data-testid="target-check-non-ganttlet">
        <p className="text-text-primary">
          This sheet has data that isn&apos;t in Ganttlet format. Creating a new sheet is
          recommended.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onAction('create-new')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            data-testid="create-new-button"
          >
            Create New Sheet
          </button>
          <button
            onClick={() => onAction('replace')}
            className="px-4 py-2 border border-border-default text-text-muted rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
            data-testid="overwrite-button"
          >
            Overwrite anyway
          </button>
        </div>
      </div>
    );
  }

  return null;
}
