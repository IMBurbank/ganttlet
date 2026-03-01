import React from 'react';
import { useUIStore } from '../stores';
import { Toolbar } from './Toolbar';
import { MainLayout } from './MainLayout';
import { TaskDetailPanel } from './TaskDetailPanel';
import { ChangeHistoryPanel } from './ChangeHistoryPanel';

export const AppShell: React.FC = () => {
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const historyPanelOpen = useUIStore((s) => s.historyPanelOpen);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
      {/* Top toolbar */}
      <Toolbar />

      {/* Main content area */}
      <MainLayout />

      {/* Slide-out panels */}
      <TaskDetailPanel />
      <ChangeHistoryPanel />

      {/* Backdrop overlay when a panel is open */}
      {(detailPanelOpen || historyPanelOpen) && (
        <div className="fixed inset-0 bg-black/20 z-30 pointer-events-none" />
      )}
    </div>
  );
};
