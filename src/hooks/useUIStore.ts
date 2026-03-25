import { useContext, useCallback, useSyncExternalStore, useRef } from 'react';
import { UIStoreContext } from '../store/UIStore';
import type { UIState } from '../store/UIStore';

export function useUIStore<T>(selector: (s: UIState) => T): T {
  const store = useContext(UIStoreContext);
  if (!store) throw new Error('useUIStore must be used within UIStoreProvider');

  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
