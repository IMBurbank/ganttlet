import React, { useEffect, useCallback, useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, useMutate, useAllTasks } from '../../hooks';
import { UIStoreContext } from '../../store/UIStore';
import { getHierarchyRole, getAllDescendantIds } from '../../utils/hierarchyUtils';
import { checkMoveConflicts } from '../../utils/dependencyValidation';

export default function ReparentPickerModal() {
  const picker = useUIStore((s) => s.reparentPicker);
  const uiStore = useContext(UIStoreContext)!;
  const mutate = useMutate();
  const allTasks = useAllTasks();

  const close = useCallback(() => {
    uiStore.setState({ reparentPicker: null });
  }, [uiStore]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  const taskMap = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);

  if (!picker) return null;

  const task = taskMap.get(picker.taskId);
  if (!task) return null;

  const descendantIds = getAllDescendantIds(task.id, taskMap);

  // Valid targets: summary tasks that aren't the task itself, its current parent, or its descendants
  const validTargets = allTasks.filter((t) => {
    if (!t.isSummary) return false;
    if (t.id === task.id) return false;
    if (t.id === task.parentId) return false;
    if (descendantIds.has(t.id)) return false;
    return true;
  });

  function handleSelect(targetId: string) {
    const conflicts = checkMoveConflicts(allTasks, task!.id, targetId);
    if (conflicts.length > 0) {
      return;
    }

    mutate({ type: 'REPARENT_TASK', taskId: task!.id, newParentId: targetId });
    close();
  }

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--raw-backdrop)' }}
        onClick={close}
      />

      {/* Modal content */}
      <div className="relative bg-surface-raised border border-border-default rounded-lg shadow-xl w-[400px] max-h-[60vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">Move "{task.name}" to...</h2>
          <button
            onClick={close}
            className="text-text-secondary hover:text-text-primary transition-colors text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          {validTargets.length === 0 ? (
            <p className="text-text-muted text-sm">No valid targets available.</p>
          ) : (
            <div className="space-y-1">
              {validTargets.map((target) => {
                const role = getHierarchyRole(target, taskMap);
                const conflicts = checkMoveConflicts(allTasks, task!.id, target.id);
                const hasConflicts = conflicts.length > 0;

                return (
                  <button
                    key={target.id}
                    onClick={() => handleSelect(target.id)}
                    disabled={hasConflicts}
                    className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                      hasConflicts
                        ? 'text-text-muted cursor-not-allowed opacity-50'
                        : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-text-muted font-medium w-16">
                        {role}
                      </span>
                      <span className="font-mono text-text-muted">{target.id}</span>
                      <span className="truncate">{target.name}</span>
                    </div>
                    {hasConflicts && (
                      <div className="mt-1 text-[10px] text-amber-400">{conflicts[0].reason}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
