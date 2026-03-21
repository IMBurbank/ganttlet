import { useCallback } from 'react';
import { useGanttDispatch } from '../../state/GanttContext';
import { signIn } from '../../sheets/oauth';

interface FirstVisitWelcomeProps {
  onSignInComplete: () => void;
}

export default function FirstVisitWelcome({ onSignInComplete }: FirstVisitWelcomeProps) {
  const dispatch = useGanttDispatch();

  const handleTryDemo = useCallback(async () => {
    const { fakeTasks, fakeChangeHistory } = await import('../../data/templates/softwareRelease');
    dispatch({ type: 'ENTER_SANDBOX', tasks: fakeTasks, changeHistory: fakeChangeHistory });
  }, [dispatch]);

  const handleSignIn = useCallback(() => {
    signIn();
    onSignInComplete();
  }, [onSignInComplete]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface-base text-text-primary px-6">
      <h1 className="text-4xl font-bold mb-3" data-testid="first-visit-title">
        Ganttlet
      </h1>
      <p className="text-lg text-text-muted mb-8 text-center max-w-md">
        Free, open-source Gantt charts with real-time collaboration and two-way Google Sheets sync.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={handleTryDemo}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          data-testid="try-demo-button"
        >
          Try the demo
        </button>
        <button
          onClick={handleSignIn}
          className="px-6 py-3 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors font-medium"
          data-testid="sign-in-button"
        >
          Sign in with Google
        </button>
      </div>

      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl text-center">
        <div>
          <h3 className="font-semibold mb-1">Real-time collaboration</h3>
          <p className="text-sm text-text-muted">
            Work together with your team on the same chart, live.
          </p>
        </div>
        <div>
          <h3 className="font-semibold mb-1">Google Sheets sync</h3>
          <p className="text-sm text-text-muted">
            Two-way sync keeps your spreadsheet and chart in lockstep.
          </p>
        </div>
        <div>
          <h3 className="font-semibold mb-1">Smart scheduling</h3>
          <p className="text-sm text-text-muted">
            Critical path, dependencies, and constraints — computed in-browser.
          </p>
        </div>
      </div>
    </div>
  );
}
