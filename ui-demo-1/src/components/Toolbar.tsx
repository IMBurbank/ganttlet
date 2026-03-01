import React, { useState, useRef, useEffect } from 'react';
import { useTimelineStore, useUIStore, useCollaborationStore } from '../stores';
import type { ZoomLevel, ColorMode } from '../types';

const ZOOM_LEVELS: { value: ZoomLevel; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'workstream', label: 'Workstream' },
  { value: 'project', label: 'Project' },
  { value: 'resource', label: 'Resource' },
  { value: 'criticality', label: 'Criticality' },
];

export const Toolbar: React.FC = () => {
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);
  const setZoomLevel = useTimelineStore((s) => s.setZoomLevel);
  const colorMode = useUIStore((s) => s.colorMode);
  const setColorMode = useUIStore((s) => s.setColorMode);
  const showCriticalPath = useUIStore((s) => s.showCriticalPath);
  const toggleCriticalPath = useUIStore((s) => s.toggleCriticalPath);
  const columns = useUIStore((s) => s.columns);
  const toggleColumn = useUIStore((s) => s.toggleColumn);
  const toggleHistoryPanel = useUIStore((s) => s.toggleHistoryPanel);
  const users = useCollaborationStore((s) => s.users);

  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Close column menu on outside click
  useEffect(() => {
    if (!columnMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnMenuOpen]);

  const onlineUsers = users.filter((u) => u.isOnline);

  return (
    <div className="flex items-center h-12 px-4 bg-zinc-900 border-b border-zinc-800 gap-3 flex-shrink-0">
      {/* Left section: App title */}
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-white tracking-tight">
          Ganttlet
        </span>
      </div>

      <div className="h-6 w-px bg-zinc-700" />

      {/* Center section */}
      <div className="flex items-center gap-2">
        {/* Zoom controls */}
        <div className="flex items-center rounded-md overflow-hidden border border-zinc-700">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level.value}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                zoomLevel === level.value
                  ? 'bg-zinc-700 text-white'
                  : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              onClick={() => setZoomLevel(level.value)}
            >
              {level.label}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-zinc-700" />

        {/* Color-by dropdown */}
        <select
          className="rounded-md px-2.5 py-1 text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition-colors appearance-none pr-6"
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as ColorMode)}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
            backgroundPosition: 'right 4px center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '16px',
          }}
        >
          {COLOR_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>

        {/* Critical path toggle */}
        <button
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            showCriticalPath
              ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50'
              : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
          onClick={toggleCriticalPath}
        >
          Critical Path
        </button>

        <div className="h-6 w-px bg-zinc-700" />

        {/* Column visibility */}
        <div className="relative" ref={columnMenuRef}>
          <button
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              columnMenuOpen
                ? 'bg-zinc-700 text-white'
                : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            onClick={() => setColumnMenuOpen(!columnMenuOpen)}
          >
            Columns
          </button>

          {columnMenuOpen && (
            <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl z-50 py-1 min-w-[160px]">
              {columns.map((col) => (
                <label
                  key={col.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => toggleColumn(col.id)}
                    className="rounded border-zinc-600 bg-zinc-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right section */}
      <div className="ml-auto flex items-center gap-2">
        {/* Change history button */}
        <button
          className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          onClick={toggleHistoryPanel}
        >
          History
        </button>

        {/* Avatar stack */}
        <div className="flex items-center pl-2">
          {onlineUsers.map((user, index) => (
            <div
              key={user.id}
              className="relative"
              style={{ marginLeft: index === 0 ? 0 : -8 }}
              title={user.isYou ? 'You' : user.name}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-medium ring-2 ring-zinc-900"
                style={{ backgroundColor: user.avatarColor }}
              >
                {user.initials}
              </div>
              {/* Online indicator */}
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-zinc-900" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
