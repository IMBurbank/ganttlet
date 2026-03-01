import React from 'react';
import type { ChangeRecord } from '../../types';
import { useGanttDispatch } from '../../state/GanttContext';
import { format, parseISO } from 'date-fns';

interface ChangeHistoryPanelProps {
  records: ChangeRecord[];
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    done: 'Done',
    description: 'Description',
    startDate: 'Start Date',
    endDate: 'End Date',
    name: 'Name',
    owner: 'Owner',
    duration: 'Duration',
    notes: 'Notes',
  };
  return labels[field] ?? field;
}

export default function ChangeHistoryPanel({ records }: ChangeHistoryPanelProps) {
  const dispatch = useGanttDispatch();

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-700 flex flex-col h-full slide-in-right shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-white">Change History</h2>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_HISTORY_PANEL' })}
          className="text-gray-500 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {records.map(record => (
          <div
            key={record.id}
            className="px-4 py-2.5 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-blue-400">{record.user}</span>
              <span className="text-[10px] text-gray-600">
                {format(parseISO(record.timestamp), 'MMM d, h:mm a')}
              </span>
            </div>
            <div className="text-xs text-gray-300">
              Changed <span className="font-medium text-gray-200">{fieldLabel(record.field)}</span>
              {' '}on{' '}
              <span className="font-medium text-gray-200">{record.taskName}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px]">
              <span className="text-red-400/70 line-through truncate max-w-[100px]">{record.oldValue}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600 shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-green-400/70 truncate max-w-[100px]">{record.newValue}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
