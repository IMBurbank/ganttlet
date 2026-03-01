import React, { useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { useUIStore, useTaskStore, useDependencyStore, useResourceStore } from '../stores';

export const TaskDetailPanel: React.FC = () => {
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const toggleDetailPanel = useUIStore((s) => s.toggleDetailPanel);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const getTaskById = useTaskStore((s) => s.getTaskById);
  const updateTask = useTaskStore((s) => s.updateTask);
  const getPredecessors = useDependencyStore((s) => s.getPredecessors);
  const getSuccessors = useDependencyStore((s) => s.getSuccessors);
  const resources = useResourceStore((s) => s.resources);
  const tasks = useTaskStore((s) => s.tasks);
  const workstreams = useTaskStore((s) => s.workstreams);

  const task = selectedTaskId ? getTaskById(selectedTaskId) : undefined;
  const predecessors = selectedTaskId ? getPredecessors(selectedTaskId) : [];
  const successors = selectedTaskId ? getSuccessors(selectedTaskId) : [];

  const resourceMap = React.useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  const taskMap = React.useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  const workstreamMap = React.useMemo(
    () => new Map(workstreams.map((ws) => [ws.id, ws])),
    [workstreams],
  );

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && detailPanelOpen) {
        toggleDetailPanel();
      }
    },
    [detailPanelOpen, toggleDetailPanel],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const typeBadgeColor = {
    task: 'bg-blue-500/20 text-blue-400',
    summary: 'bg-amber-500/20 text-amber-400',
    milestone: 'bg-purple-500/20 text-purple-400',
  };

  const workstream = task ? workstreamMap.get(task.workstreamId) : undefined;

  return (
    <div
      className={`fixed top-0 right-0 h-full w-[380px] bg-zinc-900 border-l border-zinc-800 z-40 flex flex-col transition-transform duration-300 ease-in-out ${
        detailPanelOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {task ? (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <input
              type="text"
              className="flex-1 bg-transparent text-white text-base font-semibold border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1"
              value={task.name}
              onChange={(e) => updateTask(task.id, { name: e.target.value })}
            />
            <button
              className="ml-2 w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              onClick={toggleDetailPanel}
            >
              ✕
            </button>
          </div>

          {/* Form fields */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Type badge */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                Type
              </label>
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${typeBadgeColor[task.type]}`}
              >
                {task.type}
              </span>
            </div>

            {/* Start Date */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                Start Date
              </label>
              <span className="text-sm text-zinc-300 font-mono">
                {format(task.startDate, 'MMM d, yyyy')}
              </span>
            </div>

            {/* End Date */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                End Date
              </label>
              <span className="text-sm text-zinc-300 font-mono">
                {format(task.endDate, 'MMM d, yyyy')}
              </span>
            </div>

            {/* Duration */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                Duration
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={task.duration}
                  onChange={(e) =>
                    updateTask(task.id, { duration: parseInt(e.target.value) || 0 })
                  }
                />
                <span className="text-sm text-zinc-500">days</span>
              </div>
            </div>

            {/* Progress */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                Progress
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  className="flex-1 accent-indigo-500"
                  value={task.percentComplete}
                  onChange={(e) =>
                    updateTask(task.id, {
                      percentComplete: parseInt(e.target.value),
                    })
                  }
                />
                <span className="text-sm text-zinc-300 font-mono w-10 text-right">
                  {task.percentComplete}%
                </span>
              </div>
            </div>

            {/* WBS */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                WBS
              </label>
              <span className="text-sm text-zinc-300 font-mono">
                {task.wbsCode}
              </span>
            </div>

            {/* Workstream */}
            {workstream && (
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                  Workstream
                </label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: workstream.color }}
                  />
                  <span className="text-sm text-zinc-300">{workstream.name}</span>
                </div>
              </div>
            )}

            {/* Resources */}
            {task.assignedResourceIds.length > 0 && (
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                  Resources
                </label>
                <div className="space-y-1.5">
                  {task.assignedResourceIds.map((resId) => {
                    const resource = resourceMap.get(resId);
                    if (!resource) return null;
                    return (
                      <div key={resId} className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                          style={{ backgroundColor: resource.avatarColor }}
                        >
                          {resource.initials}
                        </div>
                        <span className="text-sm text-zinc-300">{resource.name}</span>
                        <span className="text-xs text-zinc-500 capitalize">
                          {resource.role}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1">
                Notes
              </label>
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-300 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                rows={3}
                value={task.notes}
                onChange={(e) => updateTask(task.id, { notes: e.target.value })}
                placeholder="Add notes..."
              />
            </div>

            {/* Dependencies */}
            <div className="border-t border-zinc-800 pt-4">
              {/* Predecessors */}
              <div className="mb-3">
                <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">
                  Predecessors
                </label>
                {predecessors.length > 0 ? (
                  <div className="space-y-1">
                    {predecessors.map((dep) => {
                      const predTask = taskMap.get(dep.predecessorId);
                      return (
                        <div
                          key={dep.id}
                          className="flex items-center gap-2 text-sm text-zinc-300"
                        >
                          <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-xs font-mono text-zinc-400">
                            {dep.type}
                          </span>
                          <span className="truncate">
                            {predTask?.name || dep.predecessorId}
                          </span>
                          {dep.lagDays !== 0 && (
                            <span className="text-xs text-zinc-500">
                              {dep.lagDays > 0 ? `+${dep.lagDays}d` : `${dep.lagDays}d`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-zinc-600">None</span>
                )}
              </div>

              {/* Successors */}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">
                  Successors
                </label>
                {successors.length > 0 ? (
                  <div className="space-y-1">
                    {successors.map((dep) => {
                      const succTask = taskMap.get(dep.successorId);
                      return (
                        <div
                          key={dep.id}
                          className="flex items-center gap-2 text-sm text-zinc-300"
                        >
                          <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-xs font-mono text-zinc-400">
                            {dep.type}
                          </span>
                          <span className="truncate">
                            {succTask?.name || dep.successorId}
                          </span>
                          {dep.lagDays !== 0 && (
                            <span className="text-xs text-zinc-500">
                              {dep.lagDays > 0 ? `+${dep.lagDays}d` : `${dep.lagDays}d`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-zinc-600">None</span>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
          Select a task to view details
        </div>
      )}
    </div>
  );
};
