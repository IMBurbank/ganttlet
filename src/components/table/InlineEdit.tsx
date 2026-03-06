import React, { useState, useRef, useEffect, useId } from 'react';

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  type?: 'text' | 'date' | 'number';
  displayValue?: string;
  min?: number;
  max?: number;
  autoEdit?: boolean;
  readOnly?: boolean;
  validate?: (value: string) => string | null;
}

export default function InlineEdit({ value, onSave, type = 'text', displayValue, min, max, autoEdit, readOnly, validate }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevAutoEditRef = useRef(autoEdit);
  const errorId = useId();

  useEffect(() => {
    const wasAutoEdit = prevAutoEditRef.current;
    prevAutoEditRef.current = autoEdit;
    if (autoEdit && !wasAutoEdit && !editing) {
      setEditValue(value);
      setEditing(true);
    }
  }, [autoEdit, editing, value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleSave() {
    const trimmed = type === 'text' ? editValue.trim() : editValue;
    if (validate) {
      const err = validate(trimmed);
      if (err) {
        setError(err);
        return;
      }
    }
    setError(null);
    setEditing(false);
    if (trimmed !== value) {
      onSave(trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditValue(value);
      setError(null);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: 'contents' }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            ref={inputRef}
            type={type}
            value={editValue}
            onChange={e => { setEditValue(e.target.value); if (error) setError(null); }}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className={`inline-edit-input${error ? ' inline-edit-error' : ''}`}
            min={min}
            max={max}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <span id={errorId} className="inline-edit-error-msg" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (readOnly) {
    return (
      <span className="text-text-secondary truncate" title={value}>
        {displayValue || value || '\u00A0'}
      </span>
    );
  }

  return (
    <span
      className="cursor-pointer hover:text-blue-400 transition-colors truncate"
      onDoubleClick={() => { setEditValue(value); setEditing(true); }}
      title="Double-click to edit"
    >
      {displayValue || value || '\u00A0'}
    </span>
  );
}
