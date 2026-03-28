import { useEffect, useState, useId } from 'react';

interface CascadeHighlightProps {
  originalX: number;
  currentX: number;
  y: number;
  originalWidth: number;
  currentWidth: number;
  height: number;
}

export default function CascadeHighlight({
  originalX,
  currentX,
  y,
  originalWidth,
  currentWidth,
  height,
}: CascadeHighlightProps) {
  const [opacity, setOpacity] = useState(0.5);
  const gradientId = useId();

  useEffect(() => {
    // Reset opacity when props change (new cascade/recalculate)
    setOpacity(0.5);
    const timer = setTimeout(() => setOpacity(0), 10000);
    return () => clearTimeout(timer);
  }, [originalX, currentX, originalWidth, currentWidth]);

  if (opacity === 0) return null;

  // Compute the shadow trail spanning from original to current position
  const leftEdge = Math.min(originalX, currentX);
  const rightEdge = Math.max(originalX + originalWidth, currentX + currentWidth);
  const trailWidth = Math.max(rightEdge - leftEdge, 0);

  // Determine gradient direction: if task moved right, fade from left (original) to right (current)
  const movedRight = currentX >= originalX;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <linearGradient
          id={gradientId}
          x1={movedRight ? '0%' : '100%'}
          y1="0%"
          x2={movedRight ? '100%' : '0%'}
          y2="0%"
        >
          <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect
        x={leftEdge}
        y={y + 4}
        width={trailWidth}
        height={height - 8}
        rx={4}
        fill={`url(#${CSS.escape(gradientId)})`}
        opacity={opacity}
        style={{ transition: 'opacity 3s ease-out' }}
      />
    </g>
  );
}
