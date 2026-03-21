import React, { useCallback } from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';

export default function WelcomeGate({ children }: { children: React.ReactNode }) {
  const state = useGanttState();
  const dispatch = useGanttDispatch();

  const handleTryDemo = useCallback(async () => {
    const { fakeTasks, fakeChangeHistory } = await import('../../data/templates/softwareRelease');
    dispatch({ type: 'ENTER_SANDBOX', tasks: fakeTasks, changeHistory: fakeChangeHistory });
  }, [dispatch]);

  // If dataSource is defined, the app is initialized — render children
  if (state.dataSource !== undefined) {
    return <>{children}</>;
  }

  // If URL has ?sheet= or ?room=, GanttContext useEffect handles loading — render nothing
  const params = new URLSearchParams(window.location.search);
  if (params.has('sheet') || params.has('room')) {
    return null;
  }

  // No sheet/room and no dataSource — show welcome placeholder
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface-base text-text-primary">
      <h1 className="text-3xl font-bold mb-4">Welcome to Ganttlet</h1>
      <p className="text-text-muted mb-8">
        Collaborative Gantt charts with real-time Google Sheets sync
      </p>
      <button
        onClick={handleTryDemo}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
      >
        Try the demo
      </button>
    </div>
  );
}
