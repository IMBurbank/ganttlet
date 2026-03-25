import React, { useEffect, useMemo } from 'react';
import { UIStore, UIStoreContext } from '../store/UIStore';

const STORAGE_KEY_EXPANDED = 'ganttlet:expandedTasks';
const STORAGE_KEY_THEME = 'ganttlet:theme';

interface UIStoreProviderProps {
  children: React.ReactNode;
  dataSource?: 'sandbox' | 'sheet' | 'loading' | 'empty';
}

/**
 * Load persisted UI state from localStorage.
 */
function loadPersistedState(): {
  expandedTasks?: Set<string>;
  theme?: 'light' | 'dark';
} {
  const result: { expandedTasks?: Set<string>; theme?: 'light' | 'dark' } = {};

  try {
    const expandedRaw = localStorage.getItem(STORAGE_KEY_EXPANDED);
    if (expandedRaw) {
      const parsed = JSON.parse(expandedRaw);
      if (Array.isArray(parsed)) {
        result.expandedTasks = new Set(parsed);
      }
    }
  } catch {
    /* ignore corrupt localStorage */
  }

  try {
    const themeRaw = localStorage.getItem(STORAGE_KEY_THEME);
    if (themeRaw === 'light' || themeRaw === 'dark') {
      result.theme = themeRaw;
    }
  } catch {
    /* ignore */
  }

  return result;
}

export function UIStoreProvider({ children, dataSource }: UIStoreProviderProps) {
  const uiStore = useMemo(() => {
    const persisted = loadPersistedState();
    return new UIStore(persisted);
  }, []);

  // Persist to localStorage on changes
  useEffect(() => {
    const unsubscribe = uiStore.subscribe(() => {
      const state = uiStore.getState();
      try {
        localStorage.setItem(STORAGE_KEY_EXPANDED, JSON.stringify(Array.from(state.expandedTasks)));
        localStorage.setItem(STORAGE_KEY_THEME, state.theme);
      } catch {
        /* localStorage full or unavailable */
      }
    });
    return unsubscribe;
  }, [uiStore]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        // TODO Phase 4: Y.UndoManager.undo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'Z') {
        e.preventDefault();
        // TODO Phase 4: Y.UndoManager.redo()
      } else if (e.key === 'b') {
        e.preventDefault();
        const state = uiStore.getState();
        uiStore.setState({ isLeftPaneCollapsed: !state.isLeftPaneCollapsed });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [uiStore]);

  // Sandbox beforeunload guard
  useEffect(() => {
    if (dataSource !== 'sandbox') return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dataSource]);

  return <UIStoreContext.Provider value={uiStore}>{children}</UIStoreContext.Provider>;
}
