import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Task, ColumnConfig, ColorByField } from '../../types';
import type { ViewerInfo } from './TaskTable';
import { useGanttDispatch, useSetViewingTask } from '../../state/GanttContext';
import { getTaskDepth } from '../../utils/layoutUtils';
import { getTaskColor } from '../../data/colorPalettes';
import { getHierarchyRole, findWorkstreamAncestor } from '../../utils/hierarchyUtils';
import InlineEdit from './InlineEdit';
import PredecessorsCell from './PredecessorsCell';
import OKRPickerModal from '../shared/OKRPickerModal';
import { formatDisplayDate, addDaysToDate, daysBetween } from '../../utils/dateUtils';
import { validateTaskName, validateDuration, validateEndDate } from '../../utils/taskFieldValidation';

interface TaskRowProps {
  task: Task;
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  viewer: ViewerInfo | null;
  autoFocusName?: boolean;
}

export default function TaskRow({ task, columns, colorBy, taskMap, viewer, autoFocusName }: TaskRowProps) {
  const dispatch = useGanttDispatch();
  const rowRef = useRef<HTMLDivElement>(null);
  const setViewingTask = useSetViewingTask();
  const [okrPickerOpen, setOkrPickerOpen] = useState(false);

  useEffect(() => {
    if (autoFocusName && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [autoFocusName]);

  const depth = getTaskDepth(task, taskMap);
  const visibleColumns = columns.filter(c => c.visible);
  const color = getTaskColor(colorBy, task[colorBy] as string);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    dispatch({ type: 'SET_CONTEXT_MENU', menu: { x: e.clientX, y: e.clientY, taskId: task.id } });
  }

  function handleFieldUpdate(field: string, value: string | boolean) {
    const oldValue = String((task as unknown as Record<string, unknown>)[field] ?? '');
    let parsedValue: string | number | boolean = value;
    if (field === 'duration') {
      parsedValue = parseInt(value as string, 10) || 0;
    }
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field, value: parsedValue });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task.id,
      taskName: task.name,
      field,
      oldValue,
      newValue: String(value),
      user: 'You',
    });
  }

  function handleDateUpdate(field: 'startDate' | 'endDate', value: string) {
    const oldValue = task[field];
    if (field === 'startDate') {
      const newEndDate = addDaysToDate(value, task.duration);
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'startDate', value });
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'endDate', value: newEndDate });
      dispatch({
        type: 'ADD_CHANGE_RECORD',
        taskId: task.id, taskName: task.name, field: 'startDate',
        oldValue, newValue: value, user: 'You',
      });
      const delta = daysBetween(oldValue, value);
      if (delta !== 0) {
        dispatch({ type: 'CASCADE_DEPENDENTS', taskId: task.id, daysDelta: delta });
      }
    } else {
      const newDuration = daysBetween(task.startDate, value);
      if (newDuration < 0) return;
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'endDate', value });
      dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'duration', value: newDuration });
      dispatch({
        type: 'ADD_CHANGE_RECORD',
        taskId: task.id, taskName: task.name, field: 'endDate',
        oldValue, newValue: value, user: 'You',
      });
      const endDelta = daysBetween(oldValue, value);
      if (endDelta !== 0) {
        dispatch({ type: 'CASCADE_DEPENDENTS', taskId: task.id, daysDelta: endDelta });
      }
    }
  }

  function handleDurationUpdate(value: string) {
    const newDuration = parseInt(value, 10);
    if (isNaN(newDuration) || newDuration < 0) return;
    const oldEndDate = task.endDate;
    const oldValue = String(task.duration);
    const newEndDate = addDaysToDate(task.startDate, newDuration);
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'duration', value: newDuration });
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'endDate', value: newEndDate });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task.id, taskName: task.name, field: 'duration',
      oldValue, newValue: value, user: 'You',
    });
    const endDelta = daysBetween(oldEndDate, newEndDate);
    if (endDelta !== 0) {
      dispatch({ type: 'CASCADE_DEPENDENTS', taskId: task.id, daysDelta: endDelta });
    }
  }

  function renderCell(col: ColumnConfig) {
    switch (col.key) {
      case 'id':
        return <span className="text-text-secondary text-xs font-mono">{task.id}</span>;
      case 'name':
        return (
          <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 16 }}>
            {task.isSummary ? (
              <button
                onClick={() => dispatch({ type: 'TOGGLE_EXPAND', taskId: task.id })}
                className="shrink-0 w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              >
                <svg
                  width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                  className={`transition-transform duration-150 ${task.isExpanded ? 'rotate-90' : ''}`}
                >
                  <path d="M3 1 L8 5 L3 9 Z" />
                </svg>
              </button>
            ) : (
              <span className="shrink-0 w-4" />
            )}
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <InlineEdit
              value={task.name}
              onSave={v => handleFieldUpdate('name', v)}
              autoEdit={autoFocusName}
              validate={validateTaskName}
            />
          </div>
        );
      case 'owner':
        return (
          <InlineEdit
            value={task.owner}
            onSave={v => handleFieldUpdate('owner', v)}
          />
        );
      case 'startDate':
        if (task.isSummary) {
          return <span className="text-text-secondary text-xs">{formatDisplayDate(task.startDate)}</span>;
        }
        return (
          <InlineEdit
            value={task.startDate}
            displayValue={formatDisplayDate(task.startDate)}
            type="date"
            onSave={v => handleDateUpdate('startDate', v)}
          />
        );
      case 'endDate':
        if (task.isSummary) {
          return <span className="text-text-secondary text-xs">{formatDisplayDate(task.endDate)}</span>;
        }
        return (
          <InlineEdit
            value={task.endDate}
            displayValue={formatDisplayDate(task.endDate)}
            type="date"
            onSave={v => handleDateUpdate('endDate', v)}
            validate={v => validateEndDate(task.startDate, v)}
          />
        );
      case 'duration':
        if (task.isSummary || task.isMilestone) {
          return (
            <span className="text-text-secondary text-xs">{task.isMilestone ? '0' : `${task.duration}d`}</span>
          );
        }
        return (
          <InlineEdit
            value={String(task.duration)}
            displayValue={`${task.duration}d`}
            type="number"
            min={1}
            onSave={handleDurationUpdate}
            validate={validateDuration}
          />
        );
      case 'done':
        return (
          <div className="flex items-center justify-center w-full">
            <input
              type="checkbox"
              checked={task.done}
              onChange={e => handleFieldUpdate('done', e.target.checked)}
              disabled={task.isSummary}
              className="w-4 h-4 rounded border-border-strong bg-surface-sunken text-blue-500 focus:ring-blue-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={task.isSummary ? 'Summary tasks are auto-calculated from children' : 'Mark as done'}
            />
          </div>
        );
      case 'description':
        return (
          <InlineEdit
            value={task.description}
            onSave={v => handleFieldUpdate('description', v)}
          />
        );
      case 'functionalArea':
        return (
          <InlineEdit
            value={task.functionalArea}
            onSave={v => handleFieldUpdate('functionalArea', v)}
          />
        );
      case 'workStream': {
        const role = getHierarchyRole(task, taskMap);
        const wsReadOnly = role === 'task';
        return (
          <InlineEdit
            value={task.workStream}
            onSave={v => handleFieldUpdate('workStream', v)}
            readOnly={wsReadOnly}
          />
        );
      }
      case 'project': {
        const role = getHierarchyRole(task, taskMap);
        const projReadOnly = role === 'task' || role === 'workstream';
        return (
          <InlineEdit
            value={task.project}
            onSave={v => handleFieldUpdate('project', v)}
            readOnly={projReadOnly}
          />
        );
      }
      case 'predecessors':
        return <PredecessorsCell task={task} taskMap={taskMap} />;
      case 'okrs': {
        const okrDisplay = task.okrs.join(', ');
        const workstream = findWorkstreamAncestor(task, taskMap);
        const availableOkrs = workstream ? workstream.okrs : [];
        return (
          <>
            <span
              className="cursor-pointer hover:text-blue-400 transition-colors truncate text-xs"
              onClick={() => setOkrPickerOpen(true)}
              title="Click to edit OKRs"
            >
              {okrDisplay || '\u00A0'}
            </span>
            {okrPickerOpen && (
              <OKRPickerModal
                taskId={task.id}
                currentOkrs={task.okrs}
                availableOkrs={availableOkrs}
                onSave={(okrs) => {
                  const oldValue = task.okrs.join(', ');
                  dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'okrs', value: okrs });
                  dispatch({
                    type: 'ADD_CHANGE_RECORD',
                    taskId: task.id, taskName: task.name, field: 'okrs',
                    oldValue, newValue: okrs.join(', '), user: 'You',
                  });
                }}
                onClose={() => setOkrPickerOpen(false)}
              />
            )}
          </>
        );
      }
      case 'notes':
        return (
          <InlineEdit
            value={task.notes}
            onSave={v => handleFieldUpdate('notes', v)}
          />
        );
      default:
        return null;
    }
  }

  const isViewed = !!viewer;
  const viewerColor = viewer?.color;
  const viewerCellColumn = viewer?.viewingCellColumn ?? null;

  return (
    <div
      ref={rowRef}
      className={`flex items-center h-11 border-b border-border-subtle text-sm hover:bg-surface-overlay/30 transition-colors group ${
        task.isSummary ? 'font-medium text-text-primary' : 'text-text-secondary'
      } ${task.isMilestone ? 'italic' : ''}`}
      style={{
        borderLeft: isViewed ? `3px solid ${viewerColor}` : '3px solid transparent',
      }}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setViewingTask(task.id, null)}
      onMouseLeave={() => setViewingTask(null, null)}
    >
      {visibleColumns.map(col => {
        const isCellViewed = isViewed && viewerCellColumn === col.key;
        return (
          <PresenceCell
            key={col.key}
            width={col.width}
            isHighlighted={isCellViewed}
            viewerColor={viewerColor}
            viewerName={viewer?.name}
            onCellClick={() => setViewingTask(task.id, col.key)}
          >
            {renderCell(col)}
          </PresenceCell>
        );
      })}
    </div>
  );
}

function PresenceCell({
  width,
  isHighlighted,
  viewerColor,
  viewerName,
  onCellClick,
  children,
}: {
  width: number;
  isHighlighted: boolean;
  viewerColor?: string;
  viewerName?: string;
  onCellClick?: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  function handleMouseEnter(e: React.MouseEvent) {
    if (!isHighlighted) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 4 });
    setHovered(true);
  }

  function handleMouseLeave() {
    setHovered(false);
  }

  return (
    <div
      className="px-2 truncate shrink-0 flex items-center relative"
      style={{
        width,
        height: 44,
        boxShadow: isHighlighted ? `inset 0 0 0 2px ${viewerColor}` : undefined,
        borderRadius: isHighlighted ? 2 : undefined,
      }}
      onClick={onCellClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isHighlighted && hovered && viewerName &&
        createPortal(
          <div
            className="fixed z-50 px-2 py-1 text-xs rounded shadow-lg pointer-events-none fade-in whitespace-nowrap"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: 'translate(-50%, -100%)',
              backgroundColor: viewerColor,
              color: 'white',
            }}
          >
            {viewerName}
          </div>,
          document.body,
        )
      }
    </div>
  );
}
