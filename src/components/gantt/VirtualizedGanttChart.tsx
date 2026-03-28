import {
  useState,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
} from 'react';
import type { Awareness } from 'y-protocols/awareness';
import GanttChart from './GanttChart';
import type { Task, ZoomLevel, ColorByField, Dependency, CollabUser } from '../../types';
import { ROW_HEIGHT } from '../../utils/layoutUtils';

const OVERSCAN = 5;

interface VirtualizedGanttChartProps {
  visibleTasks: Task[];
  allTasks: Task[];
  zoom: ZoomLevel;
  colorBy: ColorByField;
  collabUsers?: CollabUser[];
  isCollabConnected?: boolean;
  awareness?: Awareness | null;
  onDependencyClick?: (dep: Dependency, successorId: string) => void;
  onScroll?: () => void;
}

const VirtualizedGanttChart = forwardRef<HTMLDivElement, VirtualizedGanttChartProps>(
  function VirtualizedGanttChart({ onScroll: parentOnScroll, visibleTasks, ...rest }, ref) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);

    useImperativeHandle(ref, () => scrollRef.current!);

    // Capture initial viewport dimensions
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (el) {
        setViewportHeight(el.clientHeight);
      }
    }, []);

    // Track viewport resizes
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setViewportHeight(entry.contentRect.height);
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    const handleScroll = useCallback(() => {
      const el = scrollRef.current;
      if (el) {
        setScrollTop(el.scrollTop);
      }
      parentOnScroll?.();
    }, [parentOnScroll]);

    // Compute visible index range; render all if viewport not measured yet
    const startIndex =
      viewportHeight === 0 ? 0 : Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex =
      viewportHeight === 0
        ? visibleTasks.length
        : Math.min(
            visibleTasks.length,
            Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
          );

    return (
      <div ref={scrollRef} className="flex-1 overflow-auto min-w-0" onScroll={handleScroll}>
        <GanttChart
          visibleTasks={visibleTasks}
          virtualStartIndex={startIndex}
          virtualEndIndex={endIndex}
          {...rest}
        />
      </div>
    );
  }
);

export default VirtualizedGanttChart;
