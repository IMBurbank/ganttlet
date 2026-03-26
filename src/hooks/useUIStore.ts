import { useContext, useCallback, useSyncExternalStore, useRef } from 'react';
import { UIStoreContext } from '../store/UIStore';
import type { UIState } from '../store/UIStore';

export function useUIStore<T>(selector: (s: UIState) => T): T {
  const store = useContext(UIStoreContext);
  if (!store) throw new Error('useUIStore must be used within UIStoreProvider');

  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const prevRef = useRef<{ value: T } | null>(null);

  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);

  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getState());
    // Preserve reference identity when value hasn't changed
    if (prevRef.current !== null && Object.is(next, prevRef.current.value)) {
      return prevRef.current.value;
    }
    prevRef.current = { value: next };
    return next;
  }, [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
