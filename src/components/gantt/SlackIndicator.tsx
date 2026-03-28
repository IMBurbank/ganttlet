interface SlackIndicatorProps {
  earliestX: number;
  actualX: number;
  y: number;
  height: number;
}

export default function SlackIndicator({ earliestX, actualX, y, height }: SlackIndicatorProps) {
  if (actualX <= earliestX) return null;
  return (
    <rect
      x={earliestX}
      y={y + 4}
      width={actualX - earliestX}
      height={height - 8}
      rx={3}
      fill="none"
      stroke="var(--raw-text-muted)"
      strokeWidth={1}
      strokeDasharray="4 2"
      opacity={0.4}
      style={{ pointerEvents: 'none' }}
    />
  );
}
