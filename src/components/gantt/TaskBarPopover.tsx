import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { formatDisplayDate, addDaysToDate, daysBetween } from '../../utils/dateUtils';

interface TaskBarPopoverProps {
  taskId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function TaskBarPopover({ taskId, position, onClose }: TaskBarPopoverProps) {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const task = state.tasks.find(t => t.id === taskId);

  const [name, setName] = useState(task?.name ?? '');
  const [startDate, setStartDate] = useState(task?.startDate ?? '');
  const [endDate, setEndDate] = useState(task?.endDate ?? '');
  const [owner, setOwner] = useState(task?.owner ?? '');

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClose]);

  if (!task) return null;

  function saveField(field: string, value: string) {
    const oldValue = String((task as unknown as Record<string, unknown>)[field] ?? '');
    if (value === oldValue) return;

    if (field === 'startDate') {
      const newEndDate = addDaysToDate(value, task!.duration);
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'startDate', value });
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'endDate', value: newEndDate });
      setEndDate(newEndDate);
      dispatch({
        type: 'ADD_CHANGE_RECORD',
        taskId, taskName: task!.name, field: 'startDate',
        oldValue, newValue: value, user: 'You',
      });
      const delta = daysBetween(oldValue, value);
      if (delta !== 0) {
        dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: delta });
      }
    } else if (field === 'endDate') {
      const newDuration = daysBetween(task!.startDate, value);
      if (newDuration < 0) return;
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'endDate', value });
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field: 'duration', value: newDuration });
      dispatch({
        type: 'ADD_CHANGE_RECORD',
        taskId, taskName: task!.name, field: 'endDate',
        oldValue, newValue: value, user: 'You',
      });
      const endDelta = daysBetween(oldValue, value);
      if (endDelta !== 0) {
        dispatch({ type: 'CASCADE_DEPENDENTS', taskId, daysDelta: endDelta });
      }
    } else {
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId, field, value });
      dispatch({
        type: 'ADD_CHANGE_RECORD',
        taskId, taskName: task!.name, field,
        oldValue, newValue: value, user: 'You',
      });
    }
  }

  // Position popover so it doesn't overflow viewport
  const top = Math.min(position.y, window.innerHeight - 280);
  const left = Math.min(position.x, window.innerWidth - 260);

  const popover = (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-surface-raised border border-border-default rounded-lg shadow-xl w-[240px] fade-in"
      style={{ top, left }}
    >
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary truncate">{task.id}</span>
        <button
          onClick={handleClose}
          className="text-text-secondary hover:text-text-primary transition-colors text-sm leading-none cursor-pointer"
        >
          &times;
        </button>
      </div>
      <div className="px-3 py-2 space-y-2">
        <div>
          <label className="text-[10px] text-text-muted uppercase">Name</label>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => saveField('name', name)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-muted uppercase">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); saveField('startDate', e.target.value); }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-text-muted uppercase">End</label>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); saveField('endDate', e.target.value); }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase">Duration</label>
          <span className="block text-xs text-text-secondary px-2 py-1">{task.duration}d</span>
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase">Owner</label>
          <input
            type="text"
            value={owner}
            onChange={e => setOwner(e.target.value)}
            onBlur={() => saveField('owner', owner)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
