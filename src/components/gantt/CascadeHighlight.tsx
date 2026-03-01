import React, { useEffect, useState } from 'react';

interface CascadeHighlightProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function CascadeHighlight({ x, y, width, height }: CascadeHighlightProps) {
  const [opacity, setOpacity] = useState(0.5);

  useEffect(() => {
    const timer = setTimeout(() => setOpacity(0), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (opacity === 0) return null;

  return (
    <rect
      x={x - 2}
      y={y + 2}
      width={width + 4}
      height={height - 4}
      rx={5}
      fill="#f59e0b"
      opacity={opacity}
      style={{ pointerEvents: 'none', transition: 'opacity 0.5s ease-out' }}
    />
  );
}
