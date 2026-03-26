import React, { useState, useRef, useEffect, useMemo, useContext } from 'react';
import { useUIStore, useMutate } from '../../hooks';
import { UIStoreContext } from '../../store/UIStore';
import { TaskStoreContext } from '../../store/TaskStore';
import type { ColorByField, ZoomLevel } from '../../types';
import { getPaletteEntries } from '../../data/colorPalettes';
import UndoRedoButtons from '../shared/UndoRedoButtons';

const colorByOptions: { value: ColorByField; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'workStream', label: 'Work Stream' },
  { value: 'project', label: 'Project' },
  { value: 'functionalArea', label: 'Area' },
];

const zoomOptions: { value: ZoomLevel; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export default function Toolbar() {
  const colorBy = useUIStore((s) => s.colorBy);
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const collapseWeekends = useUIStore((s) => s.collapseWeekends);
  const showOwnerOnBar = useUIStore((s) => s.showOwnerOnBar);
  const showAreaOnBar = useUIStore((s) => s.showAreaOnBar);
  const showOkrsOnBar = useUIStore((s) => s.showOkrsOnBar);
  const showCriticalPath = useUIStore((s) => s.showCriticalPath);
  const criticalPathScope = useUIStore((s) => s.criticalPathScope);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const columns = useUIStore((s) => s.columns);

  const uiStore = useContext(UIStoreContext)!;
  const taskStore = useContext(TaskStoreContext)!;
  const mutate = useMutate();

  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [showColorLegend, setShowColorLegend] = useState(false);
  const [showCpScopeMenu, setShowCpScopeMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const cpScopeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
        setShowColorLegend(false);
      }
      if (cpScopeRef.current && !cpScopeRef.current.contains(e.target as Node)) {
        setShowCpScopeMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const legendEntries = getPaletteEntries(colorBy);

  const allTasks = taskStore.getAllTasksArray();
  const projectNames = useMemo(
    () => [...new Set(allTasks.map((t) => t.project).filter(Boolean))],
    [allTasks]
  );
  const workstreamNames = useMemo(
    () => allTasks.filter((t) => t.isSummary && t.parentId !== null).map((t) => t.name),
    [allTasks]
  );

  return (
    <div className="flex items-center gap-2 px-4 h-10 bg-surface-raised/50 border-b border-border-subtle shrink-0 text-xs">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => uiStore.setState({ searchQuery: e.target.value })}
          className="w-44 pl-7 pr-2 py-1 bg-surface-overlay border border-border-default rounded text-text-secondary text-xs placeholder-text-muted focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => uiStore.setState({ searchQuery: '' })}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-border-default" />

      {/* Zoom */}
      <span className="text-text-muted">Zoom:</span>
      <div className="flex bg-surface-overlay rounded overflow-hidden border border-border-default">
        {zoomOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => uiStore.setState({ zoomLevel: opt.value })}
            className={`px-2.5 py-0.5 transition-colors ${
              zoomLevel === opt.value
                ? 'bg-blue-600 text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-sunken'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Collapse weekends */}
      {zoomLevel === 'day' && (
        <button
          onClick={() => uiStore.setState({ collapseWeekends: !collapseWeekends })}
          className={`px-2 py-0.5 rounded transition-colors ${
            collapseWeekends
              ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'
          }`}
        >
          Hide Weekends
        </button>
      )}

      <div className="w-px h-5 bg-border-default" />

      {/* Color by */}
      <div className="relative" ref={legendRef}>
        <span className="text-text-muted mr-1">Color:</span>
        <select
          value={colorBy}
          onChange={(e) => uiStore.setState({ colorBy: e.target.value as ColorByField })}
          className="bg-surface-overlay border border-border-default rounded px-2 py-0.5 text-text-secondary text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {colorByOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowColorLegend(!showColorLegend)}
          className="ml-1 text-text-muted hover:text-text-secondary"
          title="Show legend"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
        {showColorLegend && (
          <div className="absolute top-full left-0 mt-1 bg-surface-overlay border border-border-default rounded-lg shadow-xl p-2 z-40 min-w-[150px] fade-in">
            {legendEntries.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 py-0.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                <span className="text-text-secondary text-xs">{entry.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-border-default" />

      {/* Column visibility */}
      <div className="relative" ref={columnMenuRef}>
        <button
          onClick={() => setShowColumnMenu(!showColumnMenu)}
          className="flex items-center gap-1 px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 3h7a2 2 0 012 2v14a2 2 0 01-2 2h-7m0-18H5a2 2 0 00-2 2v14a2 2 0 002 2h7m0-18v18" />
          </svg>
          Columns
        </button>
        {showColumnMenu && (
          <div className="absolute top-full left-0 mt-1 bg-surface-overlay border border-border-default rounded-lg shadow-xl p-2 z-40 min-w-[160px] fade-in">
            {columns.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-surface-sunken/50 px-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={col.visible}
                  onChange={() => {
                    const newCols = columns.map((c) =>
                      c.key === col.key ? { ...c, visible: !c.visible } : c
                    );
                    uiStore.setState({ columns: newCols });
                  }}
                  disabled={col.key === 'name'}
                  className="rounded border-border-strong bg-surface-sunken text-blue-500 focus:ring-blue-500/30"
                />
                <span className="text-text-secondary text-xs">{col.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-border-default" />

      {/* Bar label toggles */}
      <span className="text-text-muted">Bar labels:</span>
      <button
        onClick={() => uiStore.setState({ showOwnerOnBar: !showOwnerOnBar })}
        className={`px-2 py-0.5 rounded transition-colors ${
          showOwnerOnBar
            ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
            : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'
        }`}
      >
        Owner
      </button>
      <button
        onClick={() => uiStore.setState({ showAreaOnBar: !showAreaOnBar })}
        className={`px-2 py-0.5 rounded transition-colors ${
          showAreaOnBar
            ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
            : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'
        }`}
      >
        Area
      </button>
      <button
        onClick={() => uiStore.setState({ showOkrsOnBar: !showOkrsOnBar })}
        className={`px-2 py-0.5 rounded transition-colors ${
          showOkrsOnBar
            ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
            : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'
        }`}
      >
        OKRs
      </button>

      <div className="w-px h-5 bg-border-default" />

      {/* Critical path toggle + scope */}
      <div className="relative flex items-center" ref={cpScopeRef}>
        <button
          onClick={() => uiStore.setState({ showCriticalPath: !showCriticalPath })}
          className={`px-2 py-0.5 rounded-l transition-colors ${
            showCriticalPath
              ? 'bg-red-600/30 text-red-400 border border-red-500/40'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'
          }`}
        >
          Critical Path
        </button>
        {showCriticalPath && (
          <button
            onClick={() => setShowCpScopeMenu(!showCpScopeMenu)}
            className="px-1.5 py-0.5 rounded-r bg-red-600/30 text-red-400 border border-l-0 border-red-500/40 hover:bg-red-600/50 transition-colors"
            title="Scope"
            aria-label="Scope"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>
        )}
        {showCpScopeMenu && showCriticalPath && (
          <div className="absolute top-full left-0 mt-1 bg-surface-overlay border border-border-default rounded-lg shadow-xl p-1 z-40 min-w-[160px] fade-in">
            {projectNames.length > 0 && (
              <>
                <div className="text-text-muted text-[10px] uppercase px-2 pt-1">Projects</div>
                {projectNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      uiStore.setState({
                        criticalPathScope: { type: 'project', name },
                      });
                      setShowCpScopeMenu(false);
                    }}
                    className={`block w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                      criticalPathScope.type === 'project' &&
                      'name' in criticalPathScope &&
                      criticalPathScope.name === name
                        ? 'bg-red-600/20 text-red-400'
                        : 'text-text-secondary hover:bg-surface-sunken'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </>
            )}
            {workstreamNames.length > 0 && (
              <>
                <div className="text-text-muted text-[10px] uppercase px-2 pt-1">Workstreams</div>
                {workstreamNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      uiStore.setState({
                        criticalPathScope: { type: 'workstream', name },
                      });
                      setShowCpScopeMenu(false);
                    }}
                    className={`block w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                      criticalPathScope.type === 'workstream' &&
                      'name' in criticalPathScope &&
                      criticalPathScope.name === name
                        ? 'bg-red-600/20 text-red-400'
                        : 'text-text-secondary hover:bg-surface-sunken'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-border-default" />

      {/* Add task */}
      <button
        onClick={() => mutate({ type: 'ADD_TASK', task: { parentId: null } })}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors"
      >
        + Add Task
      </button>

      {/* Recalculate All */}
      <button
        onClick={() => {
          const allIds = taskStore.getTaskOrder();
          mutate({ type: 'RECALCULATE_EARLIEST', taskIds: allIds });
        }}
        className="px-2 py-0.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded transition-colors"
        title="Recalculate all tasks to their earliest possible dates"
      >
        Recalculate All
      </button>

      {/* Undo/Redo */}
      <UndoRedoButtons />

      <div className="flex-1" />
    </div>
  );
}
