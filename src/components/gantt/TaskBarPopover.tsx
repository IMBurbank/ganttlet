import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTask, useMutate } from '../../hooks';
import type { Task } from '../../types';
import { taskEndDate, taskDuration, isWeekendDate } from '../../utils/dateUtils';
import { validateEndDate } from '../../utils/taskFieldValidation';

const CONSTRAINT_LABELS: Record<NonNullable<Task['constraintType']>, string> = {
  ASAP: 'As Soon As Possible',
  ALAP: 'As Late As Possible',
  SNET: 'Start No Earlier Than',
  SNLT: 'Start No Later Than',
  FNET: 'Finish No Earlier Than',
  FNLT: 'Finish No Later Than',
  MSO: 'Must Start On',
  MFO: 'Must Finish On',
};

const CONSTRAINT_TYPES = Object.keys(CONSTRAINT_LABELS) as NonNullable<Task['constraintType']>[];
const DATE_BEARING_CONSTRAINTS = new Set(['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']);

interface TaskBarPopoverProps {
  taskId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function TaskBarPopover({ taskId, position, onClose }: TaskBarPopoverProps) {
  const task = useTask(taskId);
  const mutate = useMutate();
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Touched-field tracking: untouched fields sync from store, touched keep user's value
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [localName, setLocalName] = useState(task?.name ?? '');
  const [localStartDate, setLocalStartDate] = useState(task?.startDate ?? '');
  const [localEndDate, setLocalEndDate] = useState(task?.endDate ?? '');
  const [localOwner, setLocalOwner] = useState(task?.owner ?? '');
  const [dateError, setDateError] = useState<string | null>(null);

  // Effective values: touched fields use local, untouched sync from store
  const name = touched.has('name') ? localName : (task?.name ?? '');
  const startDate = touched.has('startDate') ? localStartDate : (task?.startDate ?? '');
  const endDate = touched.has('endDate') ? localEndDate : (task?.endDate ?? '');
  const owner = touched.has('owner') ? localOwner : (task?.owner ?? '');

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  const handleClose = useCallback(() => {
    setDateError(null);
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
      if (isWeekendDate(value)) {
        setDateError('Start date cannot be a weekend');
        return;
      }
      setDateError(null);
      const newEndDate = taskEndDate(value, task!.duration);
      // Move task: updates start + end + cascades dependents
      mutate({ type: 'MOVE_TASK', taskId, newStart: value, newEnd: newEndDate });
      setLocalEndDate(newEndDate);
      setTouched((prev) => new Set(prev).add('endDate'));
    } else if (field === 'endDate') {
      const error = validateEndDate(task!.startDate, value);
      if (error) {
        setDateError(error);
        return;
      }
      setDateError(null);
      // Resize task: updates end + cascades dependents
      mutate({ type: 'RESIZE_TASK', taskId, newEnd: value });
    } else {
      setDateError(null);
      mutate({ type: 'UPDATE_FIELD', taskId, field, value });
    }
  }

  // Position popover so it doesn't overflow viewport
  const top = Math.min(position.y, window.innerHeight - 280);
  const left = Math.min(position.x, window.innerWidth - 260);

  const duration = taskDuration(task.startDate, task.endDate);

  const popover = (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-surface-raised border border-border-default rounded-lg shadow-xl w-[240px] fade-in"
      data-testid="task-popover"
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
          <label
            htmlFor={`popover-name-${taskId}`}
            className="text-[10px] text-text-muted uppercase"
          >
            Name
          </label>
          <input
            id={`popover-name-${taskId}`}
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setLocalName(e.target.value);
              setTouched((prev) => new Set(prev).add('name'));
            }}
            onBlur={() => saveField('name', name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label
              htmlFor={`popover-start-${taskId}`}
              className="text-[10px] text-text-muted uppercase"
            >
              Start
            </label>
            <input
              id={`popover-start-${taskId}`}
              type="date"
              value={startDate}
              onChange={(e) => {
                setLocalStartDate(e.target.value);
                setTouched((prev) => new Set(prev).add('startDate'));
                saveField('startDate', e.target.value);
              }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1">
            <label
              htmlFor={`popover-end-${taskId}`}
              className="text-[10px] text-text-muted uppercase"
            >
              End
            </label>
            <input
              id={`popover-end-${taskId}`}
              type="date"
              value={endDate}
              onChange={(e) => {
                setLocalEndDate(e.target.value);
                setTouched((prev) => new Set(prev).add('endDate'));
                saveField('endDate', e.target.value);
              }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        {dateError && <span className="text-[10px] text-red-400">{dateError}</span>}
        <div>
          <label className="text-[10px] text-text-muted uppercase">Duration</label>
          <span className="block text-xs text-text-secondary px-2 py-1">{duration}d</span>
        </div>
        <div>
          <label
            htmlFor={`popover-owner-${taskId}`}
            className="text-[10px] text-text-muted uppercase"
          >
            Owner
          </label>
          <input
            id={`popover-owner-${taskId}`}
            type="text"
            value={owner}
            onChange={(e) => {
              setLocalOwner(e.target.value);
              setTouched((prev) => new Set(prev).add('owner'));
            }}
            onBlur={() => saveField('owner', owner)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor={`popover-constraint-${taskId}`}
            className="text-[10px] text-text-muted uppercase"
          >
            Constraint
          </label>
          <select
            id={`popover-constraint-${taskId}`}
            value={task.constraintType ?? 'ASAP'}
            onChange={(e) => {
              const ct = e.target.value as NonNullable<Task['constraintType']>;
              mutate({
                type: 'SET_CONSTRAINT',
                taskId,
                constraintType: ct,
                constraintDate: DATE_BEARING_CONSTRAINTS.has(ct)
                  ? (task.constraintDate ?? task.startDate)
                  : undefined,
              });
            }}
            className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {CONSTRAINT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {CONSTRAINT_LABELS[ct]}
              </option>
            ))}
          </select>
        </div>
        {DATE_BEARING_CONSTRAINTS.has(task.constraintType ?? 'ASAP') && (
          <div>
            <label
              htmlFor={`popover-cdate-${taskId}`}
              className="text-[10px] text-text-muted uppercase"
            >
              Constraint Date
            </label>
            <input
              id={`popover-cdate-${taskId}`}
              type="date"
              value={task.constraintDate ?? ''}
              onChange={(e) => {
                if (isWeekendDate(e.target.value)) {
                  setDateError('Constraint date cannot be a weekend');
                  return;
                }
                setDateError(null);
                mutate({
                  type: 'SET_CONSTRAINT',
                  taskId,
                  constraintType: task.constraintType!,
                  constraintDate: e.target.value,
                });
              }}
              className="w-full bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
