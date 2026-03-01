import React, { useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { useTimelineStore, useUIStore, useTaskStore, useResourceStore } from '../stores';
import type { Task } from '../types';

interface TaskListPanelProps {
  visibleTasks: Task[];
}

export const TaskListPanel: React.FC<TaskListPanelProps> = ({ visibleTasks }) => {
  const setScrollY = useTimelineStore((s) => s.setScrollY);
  const columns = useUIStore((s) => s.columns);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const toggleDetailPanel = useUIStore((s) => s.toggleDetailPanel);
  const toggleCollapse = useTaskStore((s) => s.toggleCollapse);
  const resources = useResourceStore((s) => s.resources);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const visibleColumns = columns.filter((col) => col.visible);
  const totalWidth = visibleColumns.reduce((sum, col) => sum + col.width, 0);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrollY(e.currentTarget.scrollTop);
    },
    [setScrollY],
  );

  const handleRowClick = useCallback(
    (taskId: string) => {
      setSelectedTask(taskId);
    },
    [setSelectedTask],
  );

  const handleRowDoubleClick = useCallback(() => {
    toggleDetailPanel();
  }, [toggleDetailPanel]);

  const handleCollapseToggle = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.stopPropagation();
      toggleCollapse(taskId);
    },
    [toggleCollapse],
  );

  const resourceMap = React.useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  const renderCellContent = (col: typeof visibleColumns[number], task: Task) => {
    switch (col.id) {
      case 'wbs':
        return (
          <span className="font-mono text-zinc-500 text-xs">{task.wbsCode}</span>
        );

      case 'name':
        return (
          <div
            className="flex items-center gap-1 min-w-0"
            style={{ paddingLeft: task.level * 20 }}
          >
            {task.type === 'summary' ? (
              <button
                className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={(e) => handleCollapseToggle(e, task.id)}
              >
                {task.isCollapsed ? '▶' : '▼'}
              </button>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}
            {task.type === 'milestone' && (
              <span className="text-amber-400 text-xs flex-shrink-0">◆</span>
            )}
            <span
              className={`truncate ${
                task.type === 'summary' ? 'font-bold text-zinc-200' : 'text-zinc-300'
              }`}
            >
              {task.name}
            </span>
          </div>
        );

      case 'start':
        return (
          <span className="font-mono text-zinc-400 text-xs">
            {format(task.startDate, 'MMM d')}
          </span>
        );

      case 'end':
        return (
          <span className="font-mono text-zinc-400 text-xs">
            {format(task.endDate, 'MMM d')}
          </span>
        );

      case 'duration':
        return (
          <span className="font-mono text-zinc-400 text-xs">
            {task.duration}d
          </span>
        );

      case 'pctComplete':
        return (
          <div className="flex items-center gap-1">
            <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${task.percentComplete}%`,
                  backgroundColor:
                    task.percentComplete === 100
                      ? '#22c55e'
                      : task.percentComplete > 50
                        ? '#3b82f6'
                        : '#6366f1',
                }}
              />
            </div>
          </div>
        );

      case 'resources':
        return (
          <div className="flex items-center -space-x-1">
            {task.assignedResourceIds.slice(0, 3).map((resId) => {
              const resource = resourceMap.get(resId);
              if (!resource) return null;
              return (
                <div
                  key={resId}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-medium ring-1 ring-zinc-900"
                  style={{ backgroundColor: resource.avatarColor }}
                  title={resource.name}
                >
                  {resource.initials}
                </div>
              );
            })}
            {task.assignedResourceIds.length > 3 && (
              <span className="text-zinc-500 text-[10px] pl-1">
                +{task.assignedResourceIds.length - 3}
              </span>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">
      {/* Fixed header row */}
      <div
        className="flex-shrink-0 flex items-center border-b border-zinc-800 bg-zinc-900"
        style={{ height: 36, minWidth: totalWidth }}
      >
        {visibleColumns.map((col) => (
          <div
            key={col.id}
            className="flex items-center px-2 text-xs font-medium text-zinc-500 uppercase tracking-wider select-none"
            style={{ width: col.width, minWidth: col.width }}
          >
            {col.label}
          </div>
        ))}
      </div>

      {/* Scrollable task rows */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={handleScroll}
      >
        <div style={{ minWidth: totalWidth }}>
          {visibleTasks.map((task) => {
            const isSelected = selectedTaskId === task.id;

            return (
              <div
                key={task.id}
                className={`flex items-center cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                    : 'border-l-2 border-l-transparent hover:bg-zinc-800/50'
                }`}
                style={{ height: 36 }}
                onClick={() => handleRowClick(task.id)}
                onDoubleClick={handleRowDoubleClick}
              >
                {visibleColumns.map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center px-2 text-sm min-w-0"
                    style={{ width: col.width, minWidth: col.width }}
                  >
                    {renderCellContent(col, task)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
