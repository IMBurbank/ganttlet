import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import { GanttProvider, useGanttState, useGanttDispatch } from './state/GanttContext';
import WelcomeGate from './components/onboarding/WelcomeGate';
import { getVisibleTasks } from './utils/layoutUtils';
import Header from './components/layout/Header';
import Toolbar from './components/layout/Toolbar';
import TaskTable from './components/table/TaskTable';
import GanttChart from './components/gantt/GanttChart';
import ChangeHistoryPanel from './components/panels/ChangeHistoryPanel';
import ContextMenu from './components/shared/ContextMenu';
import DependencyEditorModal from './components/shared/DependencyEditorModal';
import ReparentPickerModal from './components/shared/ReparentPickerModal';

function AppContent() {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  // Sync theme class on <html> and persist to localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('ganttlet-theme', state.theme);
  }, [state.theme]);

  const taskMap = useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);

  const visibleTasks = useMemo(
    () => getVisibleTasks(state.tasks, state.searchQuery),
    [state.tasks, state.searchQuery]
  );

  const handleCloseContextMenu = useCallback(
    () => dispatch({ type: 'SET_CONTEXT_MENU', menu: null }),
    [dispatch]
  );

  // Sync vertical scroll between table and gantt
  const handleTableScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (tableScrollRef.current && ganttScrollRef.current) {
      ganttScrollRef.current.scrollTop = tableScrollRef.current.scrollTop;
    }
    isSyncing.current = false;
  }, []);

  const handleGanttScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (ganttScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollTop = ganttScrollRef.current.scrollTop;
    }
    isSyncing.current = false;
  }, []);

  const handleDependencyClick = useCallback(
    (_dep: import('./types').Dependency, successorId: string) => {
      dispatch({
        type: 'SET_DEPENDENCY_EDITOR',
        editor: { taskId: successorId, highlightFromId: _dep.fromId },
      });
    },
    [dispatch]
  );

  const contextMenuItems = useMemo(() => {
    if (!state.contextMenu) return [];
    const task = taskMap.get(state.contextMenu.taskId);
    if (!task) return [];
    // Determine if this is a project summary (top-level) or workstream summary (has parent)
    const isProjectSummary = task.isSummary && task.parentId === null;
    const isWorkstreamSummary = task.isSummary && task.parentId !== null;

    return [
      ...(task.isSummary
        ? [
            {
              label: task.isExpanded ? 'Collapse group' : 'Expand group',
              onClick: () => dispatch({ type: 'TOGGLE_EXPAND', taskId: task.id }),
            },
            {
              label: 'Add subtask',
              onClick: () => dispatch({ type: 'ADD_TASK', parentId: task.id, afterTaskId: null }),
            },
          ]
        : [
            {
              label: 'Edit dependencies',
              onClick: () =>
                dispatch({ type: 'SET_DEPENDENCY_EDITOR', editor: { taskId: task.id } }),
            },
            {
              label: 'Move to workstream...',
              onClick: () => dispatch({ type: 'SET_REPARENT_PICKER', picker: { taskId: task.id } }),
            },
          ]),
      // Recalculate options
      ...(!task.isSummary
        ? [
            {
              label: 'Recalculate to earliest',
              onClick: () => dispatch({ type: 'RECALCULATE_EARLIEST', scope: { taskId: task.id } }),
            },
          ]
        : []),
      ...(isWorkstreamSummary
        ? [
            {
              label: 'Recalculate workstream',
              onClick: () =>
                dispatch({ type: 'RECALCULATE_EARLIEST', scope: { workstream: task.workStream } }),
            },
          ]
        : []),
      ...(isProjectSummary
        ? [
            {
              label: 'Recalculate project',
              onClick: () =>
                dispatch({ type: 'RECALCULATE_EARLIEST', scope: { project: task.project } }),
            },
          ]
        : []),
      {
        label: 'Add task below',
        onClick: () =>
          dispatch({ type: 'ADD_TASK', parentId: task.parentId, afterTaskId: task.id }),
      },
      {
        label: 'Delete task',
        onClick: () => dispatch({ type: 'DELETE_TASK', taskId: task.id }),
        danger: true,
      },
    ];
  }, [state.contextMenu, taskMap, dispatch]);

  return (
    <div
      className="flex flex-col h-screen bg-surface-base text-text-primary"
      data-collab-status={state.isCollabConnected ? 'connected' : 'disconnected'}
    >
      <Header />
      <Toolbar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Task Table - left panel */}
        <div
          ref={tableScrollRef}
          className={`shrink-0 border-r border-border-default overflow-y-auto overflow-x-hidden transition-all duration-200 ${
            state.isLeftPaneCollapsed ? 'w-0 overflow-hidden' : ''
          }`}
          onScroll={handleTableScroll}
        >
          <TaskTable
            tasks={visibleTasks}
            columns={state.columns}
            colorBy={state.colorBy}
            taskMap={taskMap}
            users={state.users}
            collabUsers={state.collabUsers}
            isCollabConnected={state.isCollabConnected}
          />
        </div>
        {/* Pane divider toggle */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANE' })}
          className="shrink-0 w-5 flex items-center justify-center bg-surface-raised hover:bg-surface-overlay border-r border-border-default transition-colors cursor-pointer"
          title={state.isLeftPaneCollapsed ? 'Show table (Ctrl+B)' : 'Hide table (Ctrl+B)'}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`text-text-muted transition-transform duration-200 ${state.isLeftPaneCollapsed ? 'rotate-0' : 'rotate-180'}`}
          >
            <path d="M3 1 L8 5 L3 9 Z" />
          </svg>
        </button>
        {/* Gantt Chart - right panel */}
        <div
          ref={ganttScrollRef}
          className="flex-1 overflow-auto min-w-0"
          onScroll={handleGanttScroll}
        >
          <GanttChart
            visibleTasks={visibleTasks}
            allTasks={state.tasks}
            zoom={state.zoomLevel}
            colorBy={state.colorBy}
            users={state.users}
            collabUsers={state.collabUsers}
            isCollabConnected={state.isCollabConnected}
            onDependencyClick={handleDependencyClick}
          />
        </div>
        {/* Change History Panel */}
        {state.isHistoryPanelOpen && <ChangeHistoryPanel records={state.changeHistory} />}
      </div>

      {/* Context Menu */}
      {state.contextMenu && (
        <ContextMenu
          x={state.contextMenu.x}
          y={state.contextMenu.y}
          items={contextMenuItems}
          onClose={handleCloseContextMenu}
        />
      )}

      {/* Dependency Editor Modal */}
      {state.dependencyEditor && <DependencyEditorModal />}

      {/* Reparent Picker Modal */}
      {state.reparentPicker && <ReparentPickerModal />}
    </div>
  );
}

export default function App() {
  return (
    <GanttProvider>
      <WelcomeGate>
        <AppContent />
      </WelcomeGate>
    </GanttProvider>
  );
}
