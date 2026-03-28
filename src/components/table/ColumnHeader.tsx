import type { ColumnConfig } from '../../types';
import { useContext } from 'react';
import { UIStoreContext } from '../../store/UIStore';

interface ColumnHeaderProps {
  columns: ColumnConfig[];
}

export default function ColumnHeader({ columns }: ColumnHeaderProps) {
  const uiStore = useContext(UIStoreContext)!;
  const visibleColumns = columns.filter((c) => c.visible);

  return (
    <div className="flex items-center h-[50px] bg-surface-raised border-b border-border-default text-xs font-semibold text-text-secondary uppercase tracking-wider select-none">
      {visibleColumns.map((col) => (
        <div
          key={col.key}
          className="px-2 truncate shrink-0 flex items-center justify-between group"
          style={{ width: col.width }}
        >
          <span>{col.label}</span>
          {col.key !== 'name' && (
            <button
              onClick={() => {
                const cols = uiStore.getState().columns;
                uiStore.setState({
                  columns: cols.map((c) => (c.key === col.key ? { ...c, visible: !c.visible } : c)),
                });
              }}
              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary ml-1 transition-opacity cursor-pointer"
              title={`Hide ${col.label}`}
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
