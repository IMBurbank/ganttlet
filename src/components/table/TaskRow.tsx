import React, { useState, useRef, useEffect, useContext } from 'react';
import { createPortal } from 'react-dom';
import type { Task, ColumnConfig, ColorByField } from '../../types';

const CONSTRAINT_OPTIONS: { value: NonNullable<Task['constraintType']>; label: string }[] = [
  { value: 'ASAP', label: 'ASAP' },
  { value: 'ALAP', label: 'ALAP' },
  { value: 'SNET', label: 'SNET' },
  { value: 'SNLT', label: 'SNLT' },
  { value: 'FNET', label: 'FNET' },
  { value: 'FNLT', label: 'FNLT' },
  { value: 'MSO', label: 'MSO' },
  { value: 'MFO', label: 'MFO' },
];
import type { ViewerInfo } from './TaskTable';
import { useMutate, useCollab } from '../../hooks';
import { useUIStore } from '../../hooks/useUIStore';
import { UIStoreContext } from '../../store/UIStore';
import { updateViewingTask } from '../../collab/awareness';
import { getTaskDepth } from '../../utils/layoutUtils';
import { getTaskColor } from '../../data/colorPalettes';
import { getHierarchyRole, findWorkstreamAncestor } from '../../utils/hierarchyUtils';
import InlineEdit from './InlineEdit';
import PredecessorsCell from './PredecessorsCell';
import OKRPickerModal from '../shared/OKRPickerModal';
import { formatDisplayDate, taskEndDate, taskDuration, isWeekendDate } from '../../utils/dateUtils';
import {
  validateTaskName,
  validateDuration,
  validateEndDate,
} from '../../utils/taskFieldValidation';

interface TaskRowProps {
  task: Task;
  columns: ColumnConfig[];
  colorBy: ColorByField;
  taskMap: Map<string, Task>;
  viewer: ViewerInfo | null;
  autoFocusName?: boolean;
}

export default function TaskRow({
  task,
  columns,
  colorBy,
  taskMap,
  viewer,
  autoFocusName,
}: TaskRowProps) {
  const mutate = useMutate();
  const uiStore = useContext(UIStoreContext)!;
  const { awareness } = useCollab();
  const collapsedTasks = useUIStore((s) => s.collapsedTasks);
  const rowRef = useRef<HTMLDivElement>(null);
  const [okrPickerOpen, setOkrPickerOpen] = useState(false);

  useEffect(() => {
    if (autoFocusName && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [autoFocusName]);

  const depth = getTaskDepth(task, taskMap);
  const visibleColumns = columns.filter((c) => c.visible);
  const color = getTaskColor(colorBy, task[colorBy] as string);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    uiStore.setState({ contextMenu: { x: e.clientX, y: e.clientY, taskId: task.id } });
  }

  function handleFieldUpdate(field: string, value: string | boolean) {
    let parsedValue: string | number | boolean = value;
    if (field === 'duration') {
      parsedValue = parseInt(value as string, 10) || 0;
    }
    mutate({ type: 'UPDATE_FIELD', taskId: task.id, field, value: parsedValue });
  }

  function handleDateUpdate(field: 'startDate' | 'endDate', value: string) {
    if (field === 'startDate') {
      const newEndDate = taskEndDate(value, task.duration);
      mutate({ type: 'MOVE_TASK', taskId: task.id, newStart: value, newEnd: newEndDate });
    } else {
      const newDuration = taskDuration(task.startDate, value);
      if (newDuration < 1) return;
      mutate({ type: 'RESIZE_TASK', taskId: task.id, newEnd: value });
    }
  }

  function handleDurationUpdate(value: string) {
    const newDuration = parseInt(value, 10);
    if (isNaN(newDuration) || newDuration < 1) return;
    const newEndDate = taskEndDate(task.startDate, newDuration);
    mutate({ type: 'RESIZE_TASK', taskId: task.id, newEnd: newEndDate });
  }

  function handleToggleExpand() {
    const state = uiStore.getState();
    const expanded = new Set(state.collapsedTasks);
    if (expanded.has(task.id)) {
      expanded.delete(task.id);
    } else {
      expanded.add(task.id);
    }
    uiStore.setState({ collapsedTasks: expanded });
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
                onClick={handleToggleExpand}
                className="shrink-0 w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                  className={`transition-transform duration-150 ${!collapsedTasks.has(task.id) ? 'rotate-90' : ''}`}
                >
                  <path d="M3 1 L8 5 L3 9 Z" />
                </svg>
              </button>
            ) : (
              <span className="shrink-0 w-4" />
            )}
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <InlineEdit
              value={task.name}
              onSave={(v) => handleFieldUpdate('name', v)}
              autoEdit={autoFocusName}
              validate={validateTaskName}
            />
          </div>
        );
      case 'owner':
        return <InlineEdit value={task.owner} onSave={(v) => handleFieldUpdate('owner', v)} />;
      case 'startDate':
        if (task.isSummary) {
          return (
            <span className="text-text-secondary text-xs">{formatDisplayDate(task.startDate)}</span>
          );
        }
        return (
          <InlineEdit
            value={task.startDate}
            displayValue={formatDisplayDate(task.startDate)}
            type="date"
            onSave={(v) => handleDateUpdate('startDate', v)}
            validate={(v) => (isWeekendDate(v) ? 'Start date cannot be a weekend' : null)}
          />
        );
      case 'endDate':
        if (task.isSummary) {
          return (
            <span className="text-text-secondary text-xs">{formatDisplayDate(task.endDate)}</span>
          );
        }
        return (
          <InlineEdit
            value={task.endDate}
            displayValue={formatDisplayDate(task.endDate)}
            type="date"
            onSave={(v) => handleDateUpdate('endDate', v)}
            validate={(v) => validateEndDate(task.startDate, v)}
          />
        );
      case 'duration':
        if (task.isSummary || task.isMilestone) {
          return (
            <span className="text-text-secondary text-xs">
              {task.isMilestone ? '0' : `${task.duration}d`}
            </span>
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
              onChange={(e) => handleFieldUpdate('done', e.target.checked)}
              disabled={task.isSummary}
              className="w-4 h-4 rounded border-border-strong bg-surface-sunken text-blue-500 focus:ring-blue-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                task.isSummary ? 'Summary tasks are auto-calculated from children' : 'Mark as done'
              }
            />
          </div>
        );
      case 'description':
        return (
          <InlineEdit
            value={task.description}
            onSave={(v) => handleFieldUpdate('description', v)}
          />
        );
      case 'functionalArea':
        return (
          <InlineEdit
            value={task.functionalArea}
            onSave={(v) => handleFieldUpdate('functionalArea', v)}
          />
        );
      case 'workStream': {
        const role = getHierarchyRole(task, taskMap);
        const wsReadOnly = role === 'task';
        return (
          <InlineEdit
            value={task.workStream}
            onSave={(v) => handleFieldUpdate('workStream', v)}
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
            onSave={(v) => handleFieldUpdate('project', v)}
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
                  mutate({
                    type: 'UPDATE_FIELD',
                    taskId: task.id,
                    field: 'okrs',
                    value: okrs,
                  });
                }}
                onClose={() => setOkrPickerOpen(false)}
              />
            )}
          </>
        );
      }
      case 'notes':
        return <InlineEdit value={task.notes} onSave={(v) => handleFieldUpdate('notes', v)} />;
      case 'constraintType':
        return (
          <select
            value={task.constraintType ?? 'ASAP'}
            onChange={(e) => {
              const ct = e.target.value as NonNullable<Task['constraintType']>;
              mutate({
                type: 'SET_CONSTRAINT',
                taskId: task.id,
                constraintType: ct,
                constraintDate: ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'].includes(ct)
                  ? (task.constraintDate ?? task.startDate)
                  : undefined,
              });
            }}
            className="bg-transparent border-none text-text-secondary text-xs cursor-pointer focus:outline-none hover:text-text-primary"
          >
            {CONSTRAINT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
      onMouseEnter={() => awareness && updateViewingTask(awareness, task.id, null)}
      onMouseLeave={() => awareness && updateViewingTask(awareness, null, null)}
    >
      {visibleColumns.map((col) => {
        const isCellViewed = isViewed && viewerCellColumn === col.key;
        return (
          <PresenceCell
            key={col.key}
            width={col.width}
            isHighlighted={isCellViewed}
            viewerColor={viewerColor}
            viewerName={viewer?.name}
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
  children,
}: {
  width: number;
  isHighlighted: boolean;
  viewerColor?: string;
  viewerName?: string;
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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isHighlighted &&
        hovered &&
        viewerName &&
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
          document.body
        )}
    </div>
  );
}
