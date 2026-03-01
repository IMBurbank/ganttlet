import React from 'react';
import type { ColumnConfig } from '../../types';

interface ColumnHeaderProps {
  columns: ColumnConfig[];
}

export default function ColumnHeader({ columns }: ColumnHeaderProps) {
  const visibleColumns = columns.filter(c => c.visible);

  return (
    <div className="flex items-center h-[50px] bg-surface-raised border-b border-border-default text-xs font-semibold text-text-secondary uppercase tracking-wider select-none">
      {visibleColumns.map(col => (
        <div
          key={col.key}
          className="px-2 truncate shrink-0"
          style={{ width: col.width }}
        >
          {col.label}
        </div>
      ))}
    </div>
  );
}
