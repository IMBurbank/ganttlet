import { useEffect, useCallback } from 'react';
import { useUIStore, useTaskStore } from '../stores';

/**
 * Keyboard navigation for the task list:
 * - Arrow up/down: move selection
 * - Enter: open detail panel
 * - Escape: close panel / deselect
 * - Space: toggle collapse on summary tasks
 */
export function useKeyboardNav() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const toggleDetailPanel = useUIStore((s) => s.toggleDetailPanel);
  const getVisibleTasks = useTaskStore((s) => s.getVisibleTasks);
  const toggleCollapse = useTaskStore((s) => s.toggleCollapse);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept if focus is in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const visibleTasks = getVisibleTasks();
      const currentIndex = visibleTasks.findIndex((t) => t.id === selectedTaskId);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(currentIndex + 1, visibleTasks.length - 1);
          if (visibleTasks[next]) setSelectedTask(visibleTasks[next].id);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(currentIndex - 1, 0);
          if (visibleTasks[prev]) setSelectedTask(visibleTasks[prev].id);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (selectedTaskId && !detailPanelOpen) {
            toggleDetailPanel();
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          if (detailPanelOpen) {
            toggleDetailPanel();
          } else {
            setSelectedTask(null);
          }
          break;
        }
        case ' ': {
          e.preventDefault();
          if (selectedTaskId) {
            const task = visibleTasks.find((t) => t.id === selectedTaskId);
            if (task?.type === 'summary') {
              toggleCollapse(selectedTaskId);
            }
          }
          break;
        }
      }
    },
    [
      selectedTaskId,
      setSelectedTask,
      detailPanelOpen,
      toggleDetailPanel,
      getVisibleTasks,
      toggleCollapse,
    ]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
