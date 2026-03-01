import React from 'react';
import type { Task, ColumnConfig, ColorByField } from '../../types';
import { useGanttDispatch } from '../../state/GanttContext';
import { getTaskDepth } from '../../utils/layoutUtils';
import { getTaskColor } from '../../data/colorPalettes';
import InlineEdit from './InlineEdit';
import { formatDisplayDate } from '../../utils/dateUtils';

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

  function handleFieldUpdate(field: string, value: string) {
    const oldValue = String((task as unknown as Record<string, unknown>)[field] ?? '');
    let parsedValue: string | number = value;
    if (field === 'duration' || field === 'percentComplete') {
      parsedValue = parseInt(value, 10) || 0;
    }
    dispatch({ type: 'UPDATE_TASK_FIELD', taskId: task.id, field, value: parsedValue });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task.id,
      taskName: task.name,
      field,
      oldValue,
      newValue: value,
      user: 'You',
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
        return (
          <span className="text-gray-400 text-xs">{formatDisplayDate(task.startDate)}</span>
        );
      case 'endDate':
        return (
          <span className="text-gray-400 text-xs">{formatDisplayDate(task.endDate)}</span>
        );
      case 'duration':
        return (
          <span className="text-gray-400 text-xs">{task.isMilestone ? '0' : `${task.duration}d`}</span>
        );
      case 'percentComplete':
        return (
          <div className="flex items-center gap-1">
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${task.percentComplete}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-gray-500 text-xs w-7 text-right">{task.percentComplete}%</span>
          </div>
        );
      case 'functionalArea':
        return <span className="text-gray-400 text-xs">{task.functionalArea}</span>;
      case 'workStream':
        return <span className="text-gray-400 text-xs">{task.workStream}</span>;
      case 'project':
        return <span className="text-gray-400 text-xs">{task.project}</span>;
      default:
        return null;
    }
  }

  return (
    <div
      className={`flex items-center h-9 border-b border-gray-800/50 text-sm hover:bg-gray-800/30 transition-colors group ${
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
          style={{ width: col.width, height: 36 }}
        >
          {renderCell(col)}
        </div>
      ))}
    </div>
  );
}
