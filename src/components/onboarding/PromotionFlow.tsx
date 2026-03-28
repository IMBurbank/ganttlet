import { useState, useCallback, useContext } from 'react';
import {
  isSignedIn,
  signIn,
  setAuthChangeCallback,
  removeAuthChangeCallback,
} from '../../sheets/oauth';
import { createSheet } from '../../sheets/sheetCreation';
import { UIStoreContext } from '../../store/UIStore';
import { navigateToSheet } from '../../utils/navigation';
import SheetSelector from './SheetSelector';
import TargetSheetCheck, { type TargetSheetAction } from './TargetSheetCheck';

type FlowStep =
  | { type: 'sign-in' }
  | { type: 'destination' }
  | { type: 'select-existing' }
  | { type: 'target-check'; sheetId: string }
  | { type: 'writing' }
  | { type: 'error'; message: string };

interface PromotionFlowProps {
  onClose: () => void;
}

export default function PromotionFlow({ onClose }: PromotionFlowProps) {
  const uiStore = useContext(UIStoreContext);
  const [step, setStep] = useState<FlowStep>(
    isSignedIn() ? { type: 'destination' } : { type: 'sign-in' }
  );

  const executeTransition = useCallback(
    async (spreadsheetId: string) => {
      setStep({ type: 'writing' });
      try {
        if (uiStore) navigateToSheet(spreadsheetId, uiStore);

        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save to sheet';
        setStep({ type: 'error', message });
      }
    },
    [uiStore, onClose]
  );

  const handleSignIn = useCallback(() => {
    signIn();
    // Listen for auth change to resume flow
    const onAuthChange = () => {
      if (isSignedIn()) {
        removeAuthChangeCallback(onAuthChange);
        setStep({ type: 'destination' });
      }
    };
    setAuthChangeCallback(onAuthChange);
  }, []);

  const handleCreateNew = useCallback(async () => {
    setStep({ type: 'writing' });
    try {
      const sheetId = await createSheet('Ganttlet Project');
      await executeTransition(sheetId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create sheet';
      setStep({ type: 'error', message });
    }
  }, [executeTransition]);

  const handleSelectExisting = useCallback((sheetId: string) => {
    setStep({ type: 'target-check', sheetId });
  }, []);

  const handleTargetAction = useCallback(
    async (action: TargetSheetAction) => {
      if (action === 'proceed' || action === 'replace') {
        if (step.type === 'target-check') {
          await executeTransition(step.sheetId);
        }
      } else if (action === 'open-existing') {
        // Open the sheet without writing sandbox data — reactive transition
        if (step.type === 'target-check') {
          if (uiStore) navigateToSheet(step.sheetId, uiStore);
          onClose();
        }
      } else if (action === 'create-new') {
        await handleCreateNew();
      }
    },
    [step, executeTransition, handleCreateNew, uiStore, onClose]
  );

  // Sign-in gate
  if (step.type === 'sign-in') {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="promotion-modal"
      >
        <div className="bg-surface-base rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Save to Google Sheets</h2>
          <p className="text-text-muted mb-6">
            Sign in with Google to save your project to a spreadsheet.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleSignIn}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              data-testid="sign-in-button"
            >
              Sign in with Google
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Destination picker
  if (step.type === 'destination') {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="promotion-modal"
      >
        <div className="bg-surface-base rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Save to Google Sheets</h2>
          <p className="text-text-muted mb-6">Where would you like to save your project?</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleCreateNew}
              className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium text-left"
              data-testid="create-new-sheet-button"
            >
              Create new sheet (recommended)
            </button>
            <button
              onClick={() => setStep({ type: 'select-existing' })}
              className="px-4 py-3 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium text-left"
              data-testid="save-to-existing-button"
            >
              Save to existing sheet
            </button>
          </div>
          <button
            onClick={onClose}
            className="mt-4 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Select existing sheet
  if (step.type === 'select-existing') {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="promotion-modal"
      >
        <div className="max-w-lg w-full mx-4">
          <button
            onClick={() => setStep({ type: 'destination' })}
            className="mb-2 text-sm text-text-muted hover:text-text-primary transition-colors"
            data-testid="back-button"
          >
            &larr; Back
          </button>
          <SheetSelector onSelectSheet={handleSelectExisting} />
        </div>
      </div>
    );
  }

  // Target sheet check
  if (step.type === 'target-check') {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="promotion-modal"
      >
        <div className="bg-surface-base rounded-xl shadow-lg max-w-md w-full mx-4">
          <TargetSheetCheck
            spreadsheetId={step.sheetId}
            onAction={handleTargetAction}
            onCancel={() => setStep({ type: 'select-existing' })}
          />
        </div>
      </div>
    );
  }

  // Writing state
  if (step.type === 'writing') {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="promotion-modal"
      >
        <div className="bg-surface-base rounded-xl shadow-lg p-6 max-w-md w-full mx-4 text-center">
          <p className="text-text-primary" data-testid="writing-status">
            Saving your project...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (step.type === 'error') {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="promotion-modal"
      >
        <div className="bg-surface-base rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
          <p className="text-red-500 mb-4" data-testid="promotion-error">
            {step.message}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setStep({ type: 'destination' })}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Try again
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border border-border-default text-text-primary rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
