import React, { useMemo, useCallback, useRef } from 'react';
import { GanttProvider, useGanttState, useGanttDispatch } from './state/GanttContext';
import { getVisibleTasks } from './utils/layoutUtils';
import Header from './components/layout/Header';
import Toolbar from './components/layout/Toolbar';
import TaskTable from './components/table/TaskTable';
import GanttChart from './components/gantt/GanttChart';
import ChangeHistoryPanel from './components/panels/ChangeHistoryPanel';
import ContextMenu from './components/shared/ContextMenu';

function AppContent() {
  const state = useGanttState();
  const dispatch = useGanttDispatch();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const taskMap = useMemo(
    () => new Map(state.tasks.map(t => [t.id, t])),
    [state.tasks]
  );

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

  const contextMenuItems = useMemo(() => {
    if (!state.contextMenu) return [];
    const task = taskMap.get(state.contextMenu.taskId);
    if (!task) return [];
    return [
      ...(task.isSummary
        ? [{
            label: task.isExpanded ? 'Collapse group' : 'Expand group',
            onClick: () => dispatch({ type: 'TOGGLE_EXPAND', taskId: task.id }),
          }]
        : []),
      {
        label: 'Hide task',
        onClick: () => dispatch({ type: 'HIDE_TASK', taskId: task.id }),
        danger: true,
      },
    ];
  }, [state.contextMenu, taskMap, dispatch]);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      <Header />
      <Toolbar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Task Table - left panel */}
        <div
          ref={tableScrollRef}
          className="shrink-0 border-r border-gray-700 overflow-y-auto overflow-x-hidden"
          onScroll={handleTableScroll}
        >
          <TaskTable
            tasks={visibleTasks}
            columns={state.columns}
            colorBy={state.colorBy}
            taskMap={taskMap}
            users={state.users}
          />
        </div>
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
          />
        </div>
        {/* Change History Panel */}
        {state.isHistoryPanelOpen && (
          <ChangeHistoryPanel records={state.changeHistory} />
        )}
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
    </div>
  );
}

export default function App() {
  return (
    <GanttProvider>
      <AppContent />
    </GanttProvider>
  );
}
