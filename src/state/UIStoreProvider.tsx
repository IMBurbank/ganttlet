import React, { useEffect, useMemo } from 'react';
import { UIStore, UIStoreContext, type UIState } from '../store/UIStore';

const STORAGE_KEY_COLLAPSED = 'ganttlet:collapsedTasks';
const STORAGE_KEY_THEME = 'ganttlet:theme';

interface UIStoreProviderProps {
  children: React.ReactNode;
  dataSource?: 'sandbox' | 'sheet' | 'loading' | 'empty';
  initialState?: Partial<UIState>;
}

/**
 * Load persisted UI state from localStorage.
 */
function loadPersistedState(): {
  collapsedTasks?: Set<string>;
  theme?: 'light' | 'dark';
} {
  const result: { collapsedTasks?: Set<string>; theme?: 'light' | 'dark' } = {};

  try {
    const expandedRaw = localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (expandedRaw) {
      const parsed = JSON.parse(expandedRaw);
      if (Array.isArray(parsed)) {
        result.collapsedTasks = new Set(parsed);
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

export function UIStoreProvider({ children, dataSource, initialState }: UIStoreProviderProps) {
  const uiStore = useMemo(() => {
    const persisted = loadPersistedState();
    return new UIStore({ ...persisted, ...initialState });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to localStorage on changes
  useEffect(() => {
    const unsubscribe = uiStore.subscribe(() => {
      const state = uiStore.getState();
      try {
        localStorage.setItem(
          STORAGE_KEY_COLLAPSED,
          JSON.stringify(Array.from(state.collapsedTasks))
        );
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
        window.dispatchEvent(new Event('ganttlet:undo'));
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'Z') {
        e.preventDefault();
        window.dispatchEvent(new Event('ganttlet:redo'));
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
