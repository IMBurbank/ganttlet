import type { ZoomLevel } from '../../types';
import { dateToX, formatDate, getColumnWidth } from '../../utils/dateUtils';

interface TodayLineProps {
  timelineStart: Date;
  zoom: ZoomLevel;
  totalHeight: number;
}

export default function TodayLine({ timelineStart, zoom, totalHeight }: TodayLineProps) {
  const today = new Date();
  const todayStr = formatDate(today);
  const colWidth = getColumnWidth(zoom);
  const x = dateToX(todayStr, timelineStart, colWidth, zoom);

  return (
    <g className="today-line">
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={totalHeight}
        stroke="#ef4444"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <rect x={x - 18} y={0} width={36} height={16} rx={3} fill="#ef4444" />
      <text x={x} y={12} textAnchor="middle" fontSize={9} fontWeight="bold" fill="white">
        TODAY
      </text>
    </g>
  );
}
