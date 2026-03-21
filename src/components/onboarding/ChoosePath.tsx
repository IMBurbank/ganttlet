import { useState, useCallback, useMemo } from 'react';
import { useGanttDispatch } from '../../state/GanttContext';
import { getRecentSheets, type RecentSheet } from '../../utils/recentSheets';
import SheetSelector from './SheetSelector';

interface ChoosePathProps {
  onSelectSheet: (sheetId: string) => void;
}

export default function ChoosePath({ onSelectSheet }: ChoosePathProps) {
  const dispatch = useGanttDispatch();
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const recentSheets = useMemo(() => getRecentSheets(), []);

  const handleNewProject = useCallback(() => {
    dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'empty' });
  }, [dispatch]);

  const handleTryDemo = useCallback(async () => {
    const { fakeTasks, fakeChangeHistory } = await import('../../data/templates/softwareRelease');
    dispatch({ type: 'ENTER_SANDBOX', tasks: fakeTasks, changeHistory: fakeChangeHistory });
  }, [dispatch]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface-base text-text-primary px-6">
      <h1 className="text-3xl font-bold mb-3" data-testid="choose-path-title">
        What would you like to do?
      </h1>
      <p className="text-text-muted mb-8">
        Start a new project, connect an existing sheet, or try the demo.
      </p>

      <div className="flex gap-3 flex-wrap justify-center mb-8">
        <button
          onClick={handleNewProject}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          data-testid="new-project-button"
        >
          New Project
        </button>
        <button
          onClick={() => setShowSheetSelector(true)}
          className="px-5 py-2.5 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors font-medium text-sm"
          data-testid="existing-sheet-button"
        >
          Connect Existing Sheet
        </button>
        <button
          onClick={handleTryDemo}
          className="px-5 py-2.5 border border-border-default text-text-muted rounded-lg hover:bg-surface-hover transition-colors font-medium text-sm"
          data-testid="demo-button"
        >
          Demo
        </button>
      </div>

      {/* Recent sheets if any */}
      {recentSheets.length > 0 && (
        <div className="w-full max-w-md" data-testid="recent-projects">
          <h2 className="text-sm font-medium text-text-muted mb-2">Recent projects</h2>
          <div className="border border-border-default rounded-lg overflow-hidden">
            {recentSheets.map((sheet: RecentSheet) => (
              <button
                key={sheet.sheetId}
                onClick={() => onSelectSheet(sheet.sheetId)}
                className="w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors border-b border-border-default last:border-b-0"
                data-testid={`recent-sheet-${sheet.sheetId}`}
              >
                <div className="font-medium text-sm">{sheet.title}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sheet Selector Modal */}
      {showSheetSelector && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          data-testid="sheet-selector-modal"
        >
          <div className="relative">
            <button
              onClick={() => setShowSheetSelector(false)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-surface-base rounded-full border border-border-default flex items-center justify-center text-text-muted hover:text-text-primary z-10"
              data-testid="close-sheet-selector"
            >
              &times;
            </button>
            <SheetSelector onSelectSheet={onSelectSheet} />
          </div>
        </div>
      )}
    </div>
  );
}
