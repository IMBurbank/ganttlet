import { useCallback } from 'react';
import { signIn } from '../../sheets/oauth';

export default function CollaboratorWelcome() {
  const handleSignIn = useCallback(() => {
    signIn();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface-base text-text-primary px-6">
      <h1 className="text-3xl font-bold mb-3" data-testid="collaborator-title">
        You've been invited to collaborate on a project
      </h1>
      <p className="text-text-muted mb-8 text-center max-w-md">
        Sign in with Google to view and edit this Gantt chart with your team.
      </p>
      <button
        onClick={handleSignIn}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        data-testid="collaborator-sign-in-button"
      >
        Sign in with Google
      </button>
    </div>
  );
}
