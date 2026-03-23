import React, { useState, useRef, useEffect } from 'react';

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

export default function InlineEdit({
  value,
  onSave,
  type = 'text',
  displayValue,
  min,
  max,
  autoEdit,
  readOnly,
  validate,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevAutoEditRef = useRef(autoEdit);
  const errorId = useRef(`inline-edit-err-${Math.random().toString(36).slice(2)}`).current;

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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditValue(e.target.value);
    if (error) setError(null);
  }

  function handleSave() {
    if (validate) {
      const validationError = validate(editValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setError(null);
    setEditing(false);
    if (editValue !== value) {
      onSave(editValue);
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
    const hasError = !!error;
    return (
      <div className="w-full">
        <input
          ref={inputRef}
          type={type}
          value={editValue}
          onChange={handleChange}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className={`inline-edit-input${hasError ? ' inline-edit-error' : ''}`}
          data-testid="inline-edit-input"
          min={min}
          max={max}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
        />
        {hasError && (
          <div id={errorId} className="inline-edit-error-message" role="alert">
            {error}
          </div>
        )}
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
      onDoubleClick={() => {
        setEditValue(value);
        setEditing(true);
      }}
      title="Double-click to edit"
    >
      {displayValue || value || '\u00A0'}
    </span>
  );
}
