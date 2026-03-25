import React from 'react';

export default function UndoRedoButtons() {
  // Undo/Redo will be wired to Y.UndoManager in Phase 4
  return (
    <>
      <button
        disabled
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        disabled
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>
    </>
  );
}
