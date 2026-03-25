import { useContext } from 'react';
import { UndoManagerContext } from '../../state/TaskStoreProvider';

export default function UndoRedoButtons() {
  const { undoManager, canUndo, canRedo } = useContext(UndoManagerContext);

  return (
    <>
      <button
        disabled={!canUndo}
        onClick={() => undoManager?.undo()}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        disabled={!canRedo}
        onClick={() => undoManager?.redo()}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </>
  );
}
