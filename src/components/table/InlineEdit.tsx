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
}

export default function InlineEdit({ value, onSave, type = 'text', displayValue, min, max, autoEdit, readOnly }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoEdit && !editing) {
      setEditValue(value);
      setEditing(true);
    }
  }, [autoEdit]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleSave() {
    setEditing(false);
    if (editValue !== value) {
      onSave(editValue);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditValue(value);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="inline-edit-input"
        min={min}
        max={max}
      />
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
