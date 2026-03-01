import React from 'react';
import type { Task, ColumnConfig, ColorByField } from '../../types';
import { useGanttDispatch } from '../../state/GanttContext';
import { getTaskDepth } from '../../utils/layoutUtils';
import { getTaskColor } from '../../data/colorPalettes';
import InlineEdit from './InlineEdit';
import { formatDisplayDate, addDaysToDate, daysBetween } from '../../utils/dateUtils';

interface TaskRowProps {
  task: Task;
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  isViewed: boolean;
  viewerColor?: string;
}

export default function TaskRow({ task, columns, colorBy, taskMap, isViewed, viewerColor }: TaskRowProps) {
  const dispatch = useGanttDispatch();
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
    }
  }

  function handleDurationUpdate(value: string) {
    const newDuration = parseInt(value, 10);
    if (isNaN(newDuration) || newDuration < 0) return;
    const oldValue = String(task.duration);
    const newEndDate = addDaysToDate(task.startDate, newDuration);
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'duration', value: newDuration });
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field: 'endDate', value: newEndDate });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task.id, taskName: task.name, field: 'duration',
      oldValue, newValue: value, user: 'You',
    });
  }

  function renderCell(col: ColumnConfig) {
    switch (col.key) {
      case 'name':
        return (
          <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 16 }}>
            {task.isSummary ? (
              <button
                onClick={() => dispatch({ type: 'TOGGLE_EXPAND', taskId: task.id })}
                className="shrink-0 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
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
          return <span className="text-gray-400 text-xs">{formatDisplayDate(task.startDate)}</span>;
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
          return <span className="text-gray-400 text-xs">{formatDisplayDate(task.endDate)}</span>;
        }
        return (
          <InlineEdit
            value={task.endDate}
            displayValue={formatDisplayDate(task.endDate)}
            type="date"
            onSave={v => handleDateUpdate('endDate', v)}
          />
        );
      case 'duration':
        if (task.isSummary || task.isMilestone) {
          return (
            <span className="text-gray-400 text-xs">{task.isMilestone ? '0' : `${task.duration}d`}</span>
          );
        }
        return (
          <InlineEdit
            value={String(task.duration)}
            displayValue={`${task.duration}d`}
            type="number"
            min={1}
            onSave={handleDurationUpdate}
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
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
      case 'workStream':
        return (
          <InlineEdit
            value={task.workStream}
            onSave={v => handleFieldUpdate('workStream', v)}
          />
        );
      case 'project':
        return (
          <InlineEdit
            value={task.project}
            onSave={v => handleFieldUpdate('project', v)}
          />
        );
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

  return (
    <div
      className={`flex items-center h-11 border-b border-gray-800/50 text-sm hover:bg-gray-800/30 transition-colors group ${
        task.isSummary ? 'font-medium text-gray-200' : 'text-gray-300'
      } ${task.isMilestone ? 'italic' : ''}`}
      style={{
        borderLeft: isViewed ? `3px solid ${viewerColor}` : '3px solid transparent',
      }}
      onContextMenu={handleContextMenu}
    >
      {visibleColumns.map(col => (
        <div
          key={col.key}
          className="px-2 truncate shrink-0 flex items-center"
          style={{ width: col.width, height: 44 }}
        >
          {renderCell(col)}
        </div>
      ))}
    </div>
  );
}
