import { useCallback, useRef, useEffect, useState, useContext, lazy, Suspense } from 'react';
import { useMutate } from '../../hooks';
import { UIStoreContext } from '../../store/UIStore';

const TemplatePicker = lazy(() => import('./TemplatePicker'));

interface EmptyStateProps {
  onSelectTemplate?: () => void;
}

export default function EmptyState({ onSelectTemplate }: EmptyStateProps) {
  const mutate = useMutate();
  const uiStore = useContext(UIStoreContext);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAddTask = useCallback(
    (name: string) => {
      if (!name.trim()) return;
      mutate({ type: 'ADD_TASK', task: { name: name.trim() } });
      // Transition from empty state to sandbox so the Gantt chart renders
      uiStore?.setState({ dataSource: 'sandbox' });
    },
    [mutate, uiStore]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleAddTask(e.currentTarget.value);
        e.currentTarget.value = '';
      }
    },
    [handleAddTask]
  );

  return (
    <div className="flex flex-col h-full bg-surface-base" data-testid="empty-state">
      {/* Table + Timeline layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Table panel */}
        <div className="shrink-0 w-80 border-r border-border-default flex flex-col">
          {/* Column headers */}
          <div className="flex items-center h-10 border-b border-border-default bg-surface-raised px-3">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Task Name
            </span>
          </div>
          {/* Add task input row */}
          <div className="flex items-center h-10 border-b border-border-default px-3">
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter task name..."
              className="w-full bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
              onKeyDown={handleKeyDown}
              data-testid="empty-state-task-input"
            />
          </div>
        </div>

        {/* Timeline panel */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Timeline header */}
          <div className="h-10 border-b border-border-default bg-surface-raised flex items-center px-4">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Timeline
            </span>
          </div>
          {/* Grid lines scaffolding */}
          <div className="flex-1 relative" data-testid="empty-state-timeline">
            {/* Vertical grid lines */}
            <div className="absolute inset-0 flex">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex-1 border-r border-border-default/30" />
              ))}
            </div>
            {/* Today marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-400/60"
              style={{ left: '25%' }}
              data-testid="today-marker"
            />
            {/* CTA overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p
                className="text-lg font-semibold text-text-primary mb-2"
                data-testid="empty-state-cta"
              >
                Add your first task
              </p>
              <svg
                className="w-6 h-6 text-text-muted animate-bounce"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              <p className="text-sm text-text-muted mt-2">
                Type a task name in the input and press Enter
              </p>
              <button
                onClick={() => setShowTemplatePicker(true)}
                className="mt-4 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                data-testid="start-from-template"
              >
                Or start from a template
              </button>
            </div>
          </div>
        </div>
      </div>
      {showTemplatePicker && (
        <Suspense fallback={null}>
          <TemplatePicker
            onSelect={(templateId) => {
              setShowTemplatePicker(false);
              if (onSelectTemplate) {
                onSelectTemplate();
              }
              import('../../sheets/sheetCreation')
                .then(async ({ createProjectFromTemplate }) => {
                  const spreadsheetId = await createProjectFromTemplate(
                    'Ganttlet Project',
                    templateId,
                    mutate
                  );
                  // Navigate to the new sheet — same pattern as Header.tsx
                  const url = new URL(window.location.href);
                  url.searchParams.set('sheet', spreadsheetId);
                  url.searchParams.set('room', spreadsheetId);
                  window.history.replaceState({}, '', url.toString());
                  uiStore?.setState({
                    spreadsheetId,
                    roomId: spreadsheetId,
                    dataSource: 'loading',
                    syncError: null,
                  });
                })
                .catch((e) => console.warn('Template creation failed:', e));
            }}
            onClose={() => setShowTemplatePicker(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
