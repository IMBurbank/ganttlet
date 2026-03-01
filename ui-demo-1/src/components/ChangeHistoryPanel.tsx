import React, { useEffect, useCallback, useMemo } from 'react';
import { format, startOfDay } from 'date-fns';
import { useUIStore, useHistoryStore, useResourceStore } from '../stores';
import type { ChangeType } from '../types';

const CHANGE_TYPE_COLORS: Record<ChangeType, string> = {
  create: 'text-green-400',
  update: 'text-blue-400',
  delete: 'text-red-400',
  move: 'text-yellow-400',
  link: 'text-purple-400',
  unlink: 'text-zinc-400',
};

const CHANGE_TYPE_DOT_COLORS: Record<ChangeType, string> = {
  create: 'bg-green-500',
  update: 'bg-blue-500',
  delete: 'bg-red-500',
  move: 'bg-yellow-500',
  link: 'bg-purple-500',
  unlink: 'bg-zinc-500',
};

export const ChangeHistoryPanel: React.FC = () => {
  const historyPanelOpen = useUIStore((s) => s.historyPanelOpen);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);
  const records = useHistoryStore((s) => s.records);
  const resources = useResourceStore((s) => s.resources);

  const resourceMap = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && historyPanelOpen) {
        toggleHistoryPanel();
      }
    },
    [historyPanelOpen, toggleHistoryPanel],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Sort records newest first and group by date
  const groupedRecords = useMemo(() => {
    const sorted = [...records].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    const groups: { date: string; dateLabel: string; items: typeof sorted }[] = [];
    let currentDateKey = '';

    for (const record of sorted) {
      const dateKey = startOfDay(record.timestamp).toISOString();
      if (dateKey !== currentDateKey) {
        currentDateKey = dateKey;
        groups.push({
          date: dateKey,
          dateLabel: format(record.timestamp, 'EEEE, MMM d'),
          items: [],
        });
      }
      groups[groups.length - 1].items.push(record);
    }

    return groups;
  }, [records]);

  return (
    <div
      className={`fixed top-0 right-0 h-full w-[350px] bg-zinc-900 border-l border-zinc-800 z-40 flex flex-col transition-transform duration-300 ease-in-out ${
        historyPanelOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-sm font-semibold text-white">Change History</h2>
        <button
          className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          onClick={toggleHistoryPanel}
        >
          ✕
        </button>
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-y-auto">
        {groupedRecords.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            No changes recorded
          </div>
        ) : (
          groupedRecords.map((group) => (
            <div key={group.date}>
              {/* Date header */}
              <div className="sticky top-0 px-4 py-2 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/50">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  {group.dateLabel}
                </span>
              </div>

              {/* Records for this date */}
              <div className="px-4 py-1">
                {group.items.map((record) => {
                  const user = resourceMap.get(record.userId);

                  return (
                    <div
                      key={record.id}
                      className="flex items-start gap-2.5 py-2.5 border-b border-zinc-800/30 last:border-b-0"
                    >
                      {/* Change type dot */}
                      <div className="flex-shrink-0 mt-1.5">
                        <div
                          className={`w-2 h-2 rounded-full ${CHANGE_TYPE_DOT_COLORS[record.changeType]}`}
                        />
                      </div>

                      {/* User avatar */}
                      {user ? (
                        <div
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-medium"
                          style={{ backgroundColor: user.avatarColor }}
                          title={user.name}
                        >
                          {user.initials}
                        </div>
                      ) : (
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-400 text-[9px] font-medium">
                          ?
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-xs leading-relaxed ${CHANGE_TYPE_COLORS[record.changeType]}`}
                        >
                          {record.description}
                        </p>

                        {/* Old/new value diff */}
                        {record.oldValue != null && record.newValue != null && record.field && (
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            <span className="text-zinc-600">{record.field}:</span>{' '}
                            <span className="line-through text-zinc-600">
                              {record.oldValue}
                            </span>{' '}
                            <span className="text-zinc-500">&rarr;</span>{' '}
                            <span>{record.newValue}</span>
                          </p>
                        )}

                        {/* Timestamp */}
                        <span className="text-[10px] text-zinc-600 mt-0.5 block">
                          {format(record.timestamp, 'h:mm a')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
