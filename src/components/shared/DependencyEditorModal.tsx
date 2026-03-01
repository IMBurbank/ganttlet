import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Task, Dependency, DependencyType } from '../../types';
import { useGanttState, useGanttDispatch } from '../../state/GanttContext';
import { wouldCreateCycle } from '../../utils/dependencyUtils';

const DEP_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Finish \u2192 Start',
  FF: 'Finish \u2192 Finish',
  SS: 'Start \u2192 Start',
  SF: 'Start \u2192 Finish',
};

export default function DependencyEditorModal() {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const editor = state.dependencyEditor;

  const close = useCallback(() => {
    dispatch({ type: 'SET_DEPENDENCY_EDITOR', editor: null });
  }, [dispatch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  if (!editor) return null;

  const task = state.tasks.find(t => t.id === editor.taskId);
  if (!task) return null;

  const nonSummaryTasks = state.tasks.filter(t => !t.isSummary && t.id !== task.id);

  // Tasks that can be added as predecessors (not already a predecessor, no cycle)
  const availablePredecessors = nonSummaryTasks.filter(t => {
    if (task.dependencies.some(d => d.fromId === t.id)) return false;
    if (wouldCreateCycle(state.tasks, task.id, t.id)) return false;
    return true;
  });

  function handleAdd() {
    if (availablePredecessors.length === 0) return;
    const firstAvailable = availablePredecessors[0];
    const newDep: Dependency = {
      fromId: firstAvailable.id,
      toId: task!.id,
      type: 'FS',
      lag: 0,
    };
    dispatch({ type: 'ADD_DEPENDENCY', taskId: task!.id, dependency: newDep });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task!.id,
      taskName: task!.name,
      field: 'dependency',
      oldValue: '',
      newValue: `Added ${firstAvailable.id} FS`,
      user: 'You',
    });
  }

  function handleChangePredecessor(oldFromId: string, newFromId: string, dep: Dependency) {
    dispatch({ type: 'REMOVE_DEPENDENCY', taskId: task!.id, fromId: oldFromId });
    const newDep: Dependency = {
      fromId: newFromId,
      toId: task!.id,
      type: dep.type,
      lag: dep.lag,
    };
    dispatch({ type: 'ADD_DEPENDENCY', taskId: task!.id, dependency: newDep });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task!.id,
      taskName: task!.name,
      field: 'dependency',
      oldValue: `${oldFromId} ${dep.type}`,
      newValue: `${newFromId} ${dep.type}`,
      user: 'You',
    });
  }

  function handleChangeType(fromId: string, newType: DependencyType, dep: Dependency) {
    dispatch({ type: 'UPDATE_DEPENDENCY', taskId: task!.id, fromId, newType, newLag: dep.lag });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task!.id,
      taskName: task!.name,
      field: 'dependency type',
      oldValue: `${fromId} ${dep.type}`,
      newValue: `${fromId} ${newType}`,
      user: 'You',
    });
  }

  function handleChangeLag(fromId: string, newLag: number, dep: Dependency) {
    dispatch({ type: 'UPDATE_DEPENDENCY', taskId: task!.id, fromId, newType: dep.type, newLag });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task!.id,
      taskName: task!.name,
      field: 'dependency lag',
      oldValue: `${fromId} lag ${dep.lag}`,
      newValue: `${fromId} lag ${newLag}`,
      user: 'You',
    });
  }

  function handleRemove(fromId: string, dep: Dependency) {
    dispatch({ type: 'REMOVE_DEPENDENCY', taskId: task!.id, fromId });
    dispatch({
      type: 'ADD_CHANGE_RECORD',
      taskId: task!.id,
      taskName: task!.name,
      field: 'dependency',
      oldValue: `${fromId} ${dep.type}`,
      newValue: '',
      user: 'You',
    });
  }

  // Build list of valid predecessors for a given dependency row
  function getValidPredecessorsForRow(currentFromId: string) {
    return nonSummaryTasks.filter(t => {
      if (t.id === currentFromId) return true; // current selection always valid
      if (task!.dependencies.some(d => d.fromId === t.id)) return false; // already used
      if (wouldCreateCycle(state.tasks, task!.id, t.id)) return false;
      return true;
    });
  }

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--raw-backdrop)' }} />

      {/* Modal content */}
      <div className="relative bg-surface-raised border border-border-default rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">
            Dependencies — {task.name}
          </h2>
          <button
            onClick={close}
            className="text-text-secondary hover:text-text-primary transition-colors text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          {task.dependencies.length === 0 ? (
            <p className="text-text-muted text-sm">No dependencies yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary text-xs uppercase">
                  <th className="text-left pb-2 font-medium">Predecessor</th>
                  <th className="text-left pb-2 font-medium">Type</th>
                  <th className="text-left pb-2 font-medium w-20">Lag (days)</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {task.dependencies.map(dep => {
                  const isHighlighted = editor.highlightFromId === dep.fromId;
                  const validPreds = getValidPredecessorsForRow(dep.fromId);
                  return (
                    <tr
                      key={dep.fromId}
                      className={`border-t border-border-subtle ${isHighlighted ? 'bg-blue-900/30' : ''}`}
                    >
                      <td className="py-2 pr-2">
                        <select
                          value={dep.fromId}
                          onChange={e => handleChangePredecessor(dep.fromId, e.target.value, dep)}
                          className="bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs w-full cursor-pointer"
                        >
                          {validPreds.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.id} — {t.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={dep.type}
                          onChange={e => handleChangeType(dep.fromId, e.target.value as DependencyType, dep)}
                          className="bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs cursor-pointer"
                        >
                          {(Object.keys(DEP_TYPE_LABELS) as DependencyType[]).map(t => (
                            <option key={t} value={t}>
                              {DEP_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          value={dep.lag}
                          onChange={e => handleChangeLag(dep.fromId, parseInt(e.target.value, 10) || 0, dep)}
                          className="bg-surface-overlay border border-border-strong rounded px-2 py-1 text-text-primary text-xs w-16"
                        />
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => handleRemove(dep.fromId, dep)}
                          className="text-red-400 hover:text-red-300 transition-colors cursor-pointer text-xs"
                          title="Remove dependency"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-default">
          <button
            onClick={handleAdd}
            disabled={availablePredecessors.length === 0}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:text-text-muted disabled:cursor-not-allowed cursor-pointer"
          >
            + Add Dependency
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
