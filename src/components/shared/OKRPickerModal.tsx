import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface OKRPickerModalProps {
  taskId: string;
  currentOkrs: string[];
  availableOkrs: string[];
  onSave: (okrs: string[]) => void;
  onClose: () => void;
}

export default function OKRPickerModal({
  taskId: _taskId,
  currentOkrs,
  availableOkrs,
  onSave,
  onClose,
}: OKRPickerModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentOkrs));

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  function toggleOkr(okr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(okr)) {
        next.delete(okr);
      } else {
        next.add(okr);
      }
      return next;
    });
  }

  function handleSave() {
    onSave(Array.from(selected));
    close();
  }

  // Merge available OKRs with any current OKRs not in the available set
  const allOkrs = [...availableOkrs];
  for (const okr of currentOkrs) {
    if (!allOkrs.includes(okr)) {
      allOkrs.push(okr);
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--raw-backdrop)' }}
        onClick={close}
      />

      <div className="relative bg-surface-raised border border-border-default rounded-lg shadow-xl w-[420px] max-h-[60vh] flex flex-col fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">Select OKRs</h2>
          <button
            onClick={close}
            className="text-text-secondary hover:text-text-primary transition-colors text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          {allOkrs.length === 0 ? (
            <p className="text-text-muted text-sm">No OKRs available for this workstream.</p>
          ) : (
            <div className="space-y-2">
              {allOkrs.map((okr) => {
                const isSelected = selected.has(okr);
                const isFromWorkstream = availableOkrs.includes(okr);
                return (
                  <label
                    key={okr}
                    className="flex items-start gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-surface-overlay transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOkr(okr)}
                      className="mt-0.5 w-4 h-4 rounded border-border-strong bg-surface-sunken text-blue-500 focus:ring-blue-500/30 cursor-pointer shrink-0"
                    />
                    <span
                      className={
                        isFromWorkstream ? 'text-text-secondary' : 'text-text-muted italic'
                      }
                    >
                      {okr}
                      {!isFromWorkstream && ' (custom)'}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            onClick={close}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
