interface SummaryBarProps {
  x: number;
  y: number;
  width: number;
  color: string;
  done: boolean;
  taskName?: string;
  viewerName?: string;
  viewerColor?: string;
}

export default function SummaryBar({
  x,
  y,
  width,
  color,
  done,
  taskName,
  viewerName,
  viewerColor,
}: SummaryBarProps) {
  const barHeight = 8;
  const tipSize = 4;

  return (
    <g opacity={done ? 0.4 : 1}>
      {/* Viewer presence outline */}
      {viewerColor && (
        <>
          <rect
            x={x - 3}
            y={y - 3}
            width={Math.max(width, 2) + 6}
            height={barHeight + tipSize + 6}
            rx={3}
            fill="none"
            stroke={viewerColor}
            strokeWidth={2}
            opacity={0.8}
            style={{ pointerEvents: 'none' }}
          />
          {viewerName && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={x - 3}
                y={y - 18}
                width={viewerName.length * 6.5 + 8}
                height={14}
                rx={3}
                fill={viewerColor}
              />
              <text
                x={x + 1}
                y={y - 9}
                fontSize={9}
                fill="white"
                dominantBaseline="middle"
                fontWeight={600}
              >
                {viewerName}
              </text>
            </g>
          )}
        </>
      )}
      {/* Task name above bar */}
      {taskName && (
        <text
          x={x}
          y={y - 4}
          fontSize={10}
          fill="var(--raw-label-text)"
          dominantBaseline="auto"
          style={{
            pointerEvents: 'none',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {taskName}
        </text>
      )}
      {/* Main bar */}
      <rect
        x={x}
        y={y}
        width={Math.max(width, 2)}
        height={barHeight}
        fill={color}
        opacity={0.6}
        rx={1}
      />
      {/* Left tip */}
      <polygon
        points={`${x},${y + barHeight} ${x},${y + barHeight + tipSize} ${x + tipSize},${y + barHeight}`}
        fill={color}
        opacity={0.6}
      />
      {/* Right tip */}
      <polygon
        points={`${x + width},${y + barHeight} ${x + width},${y + barHeight + tipSize} ${x + width - tipSize},${y + barHeight}`}
        fill={color}
        opacity={0.6}
      />
    </g>
  );
}
