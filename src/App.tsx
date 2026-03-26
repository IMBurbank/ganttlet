import { useMemo, useCallback, useRef, useEffect, useContext } from 'react';
import { UIStoreProvider } from './state/UIStoreProvider';
import { TaskStoreProvider } from './state/TaskStoreProvider';
import { useUIStore, useMutate, useTaskOrder } from './hooks';
import { UIStoreContext } from './store/UIStore';
import { TaskStoreContext } from './store/TaskStore';
import WelcomeGate from './components/onboarding/WelcomeGate';
import { getVisibleTasks } from './utils/layoutUtils';
import Header from './components/layout/Header';
import Toolbar from './components/layout/Toolbar';
import TaskTable from './components/table/TaskTable';
import VirtualizedGanttChart from './components/gantt/VirtualizedGanttChart';
import ContextMenu from './components/shared/ContextMenu';
import DependencyEditorModal from './components/shared/DependencyEditorModal';
import ReparentPickerModal from './components/shared/ReparentPickerModal';
import EmptyState from './components/onboarding/EmptyState';
import ConflictResolutionModal from './components/onboarding/ConflictResolutionModal';
import { DataSafeErrorBoundary } from './components/shared/DataSafeErrorBoundary';
import { AwarenessProvider, useAwareness } from './collab/AwarenessContext';
import { getAuthState } from './sheets/oauth';

function AppContent() {
  const theme = useUIStore((s) => s.theme);
  const dataSource = useUIStore((s) => s.dataSource);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const columns = useUIStore((s) => s.columns);
  const colorBy = useUIStore((s) => s.colorBy);
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const isLeftPaneCollapsed = useUIStore((s) => s.isLeftPaneCollapsed);
  const contextMenu = useUIStore((s) => s.contextMenu);
  const dependencyEditor = useUIStore((s) => s.dependencyEditor);
  const reparentPicker = useUIStore((s) => s.reparentPicker);

  const uiStore = useContext(UIStoreContext)!;
  const taskStore = useContext(TaskStoreContext)!;
  const mutate = useMutate();
  const { collabUsers, isCollabConnected, awareness } = useAwareness();

  // Subscribe to global task changes to trigger re-renders
  useTaskOrder();

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  // Sync theme class on <html> and persist to localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('ganttlet-theme', theme);
  }, [theme]);

  const allTasks = taskStore.getAllTasksArray();
  const taskMap = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);

  const visibleTasks = useMemo(
    () => getVisibleTasks(allTasks, searchQuery),
    [allTasks, searchQuery]
  );

  const handleCloseContextMenu = useCallback(
    () => uiStore.setState({ contextMenu: null }),
    [uiStore]
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
      uiStore.setState({
        dependencyEditor: { taskId: successorId, highlightFromId: _dep.fromId },
      });
    },
    [uiStore]
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const task = taskMap.get(contextMenu.taskId);
    if (!task) return [];
    const isProjectSummary = task.isSummary && task.parentId === null;
    const isWorkstreamSummary = task.isSummary && task.parentId !== null;

    return [
      ...(task.isSummary
        ? [
            {
              label: task.isExpanded ? 'Collapse group' : 'Expand group',
              onClick: () => {
                const expanded = new Set(uiStore.getState().expandedTasks);
                if (expanded.has(task.id)) {
                  expanded.delete(task.id);
                } else {
                  expanded.add(task.id);
                }
                uiStore.setState({ expandedTasks: expanded });
              },
            },
            {
              label: 'Add subtask',
              onClick: () => mutate({ type: 'ADD_TASK', task: { parentId: task.id } }),
            },
          ]
        : [
            {
              label: 'Edit dependencies',
              onClick: () => uiStore.setState({ dependencyEditor: { taskId: task.id } }),
            },
            {
              label: 'Move to workstream...',
              onClick: () => uiStore.setState({ reparentPicker: { taskId: task.id } }),
            },
          ]),
      // Recalculate options — placeholder until mutation function added
      ...(!task.isSummary
        ? [
            {
              label: 'Recalculate to earliest',
              onClick: () => {
                // TODO: Implement per-task recalculate
              },
            },
          ]
        : []),
      ...(isWorkstreamSummary
        ? [
            {
              label: 'Recalculate workstream',
              onClick: () => {
                // TODO: Implement workstream recalculate
              },
            },
          ]
        : []),
      ...(isProjectSummary
        ? [
            {
              label: 'Recalculate project',
              onClick: () => {
                // TODO: Implement project recalculate
              },
            },
          ]
        : []),
      {
        label: 'Add task below',
        onClick: () =>
          mutate({ type: 'ADD_TASK', task: { parentId: task.parentId }, afterTaskId: task.id }),
      },
      {
        label: 'Delete task',
        onClick: () => mutate({ type: 'DELETE_TASK', taskId: task.id }),
        danger: true,
      },
    ];
  }, [contextMenu, taskMap, uiStore, mutate]);

  if (dataSource === 'empty') {
    return (
      <div className="flex flex-col h-screen bg-surface-base text-text-primary">
        <Header />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-base text-text-primary">
      <Header />
      <Toolbar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Task Table - left panel */}
        <div
          ref={tableScrollRef}
          className={`shrink-0 border-r border-border-default overflow-y-auto overflow-x-hidden transition-all duration-200 ${
            isLeftPaneCollapsed ? 'w-0 overflow-hidden' : ''
          }`}
          onScroll={handleTableScroll}
        >
          <DataSafeErrorBoundary panelName="table">
            <TaskTable
              tasks={visibleTasks}
              columns={columns}
              colorBy={colorBy}
              taskMap={taskMap}
              users={[]}
              collabUsers={collabUsers}
              isCollabConnected={isCollabConnected}
            />
          </DataSafeErrorBoundary>
        </div>
        {/* Pane divider toggle */}
        <button
          onClick={() => uiStore.setState({ isLeftPaneCollapsed: !isLeftPaneCollapsed })}
          className="shrink-0 w-5 flex items-center justify-center bg-surface-raised hover:bg-surface-overlay border-r border-border-default transition-colors cursor-pointer"
          title={isLeftPaneCollapsed ? 'Show table (Ctrl+B)' : 'Hide table (Ctrl+B)'}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`text-text-muted transition-transform duration-200 ${isLeftPaneCollapsed ? 'rotate-0' : 'rotate-180'}`}
          >
            <path d="M3 1 L8 5 L3 9 Z" />
          </svg>
        </button>
        {/* Gantt Chart - right panel (virtualized) */}
        <DataSafeErrorBoundary panelName="chart">
          <VirtualizedGanttChart
            ref={ganttScrollRef}
            visibleTasks={visibleTasks}
            allTasks={allTasks}
            zoom={zoomLevel}
            colorBy={colorBy}
            users={[]}
            collabUsers={collabUsers}
            isCollabConnected={isCollabConnected}
            awareness={awareness}
            onDependencyClick={handleDependencyClick}
            onScroll={handleGanttScroll}
          />
        </DataSafeErrorBoundary>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={handleCloseContextMenu}
        />
      )}

      {/* Dependency Editor Modal */}
      {dependencyEditor && <DependencyEditorModal />}

      {/* Reparent Picker Modal */}
      {reparentPicker && <ReparentPickerModal />}

      {/* Conflict Resolution Modal */}
      <ConflictResolutionModal />
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const sheetId = params.get('sheet') || undefined;
  const roomId = params.get('room') || sheetId;
  const auth = getAuthState();

  return (
    <UIStoreProvider>
      <TaskStoreProvider spreadsheetId={sheetId} roomId={roomId}>
        <AwarenessProvider
          roomId={roomId}
          userName={auth.userName ?? undefined}
          userEmail={auth.userEmail ?? undefined}
        >
          <DataSafeErrorBoundary>
            <WelcomeGate>
              <AppContent />
            </WelcomeGate>
          </DataSafeErrorBoundary>
        </AwarenessProvider>
      </TaskStoreProvider>
    </UIStoreProvider>
  );
}
