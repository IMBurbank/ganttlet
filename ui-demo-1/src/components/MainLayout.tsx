import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTaskStore } from '../stores';
import { TaskListPanel } from './TaskListPanel';
import { TimelinePanel } from './TimelinePanel';

const MIN_LEFT_WIDTH = 250;
const MAX_LEFT_WIDTH = 700;
const DEFAULT_LEFT_WIDTH = 450;

export const MainLayout: React.FC = () => {
  const getVisibleTasks = useTaskStore((s) => s.getVisibleTasks);
  const visibleTasks = getVisibleTasks();

  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_LEFT_WIDTH);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = leftWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [leftWidth],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(
        MAX_LEFT_WIDTH,
        Math.max(MIN_LEFT_WIDTH, startWidth.current + delta),
      );
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="flex-1 flex flex-row overflow-hidden">
      {/* Left: Task List Panel */}
      <div style={{ width: leftWidth, minWidth: leftWidth }} className="flex-shrink-0">
        <TaskListPanel visibleTasks={visibleTasks} />
      </div>

      {/* Resize handle */}
      <div
        className="w-1 cursor-col-resize bg-zinc-800 hover:bg-indigo-500 transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
      />

      {/* Right: Timeline Panel */}
      <TimelinePanel visibleTasks={visibleTasks} />
    </div>
  );
};
