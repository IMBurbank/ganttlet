import React, { useEffect, useRef, useCallback } from 'react';

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Store onClose in a ref so the document listener doesn't re-attach
  // when the parent re-renders with a new function reference.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleItemClick = useCallback((item: MenuItem) => {
    item.onClick();
    onCloseRef.current();
  }, []);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface-overlay border border-border-default rounded-lg shadow-2xl py-1 min-w-[160px] fade-in"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => handleItemClick(item)}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-sunken transition-colors ${
            item.danger
              ? 'text-red-400 hover:text-red-300'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
