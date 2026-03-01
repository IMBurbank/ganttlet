import React from 'react';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';

export default function UndoRedoButtons() {
  const { undoStack, redoStack } = useGanttState();
  const dispatch = useGanttDispatch();

  return (
    <>
      <button
        onClick={() => dispatch({ type: 'UNDO' })}
        disabled={undoStack.length === 0}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        onClick={() => dispatch({ type: 'REDO' })}
        disabled={redoStack.length === 0}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </>
  );
}
