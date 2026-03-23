import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  svg?: boolean;
}

export default function Tooltip({ content, children, delay = 400, svg = false }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleMouseEnter(e: React.MouseEvent) {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    timeoutRef.current = setTimeout(() => {
      setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      setVisible(true);
    }, delay);
  }

  function handleMouseLeave() {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const tooltipPopup = visible
    ? createPortal(
        <div
          className="fixed z-50 px-3 py-2 text-xs bg-surface-overlay text-text-primary rounded-lg shadow-xl border border-border-default max-w-xs pointer-events-none fade-in"
          data-testid="tooltip"
          style={{
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {content}
        </div>,
        document.body
      )
    : null;

  if (svg) {
    return (
      <g onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {children}
        {tooltipPopup}
      </g>
    );
  }

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="inline-flex">
      {children}
      {tooltipPopup}
    </div>
  );
}
