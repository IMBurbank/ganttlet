import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { UIStore, UIStoreContext } from '../../store/UIStore';
import { useUIStore } from '../useUIStore';

function createWrapper(store: UIStore) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <UIStoreContext.Provider value={store}>{children}</UIStoreContext.Provider>;
  };
}

describe('useUIStore', () => {
  it('returns the selected primitive value', () => {
    const store = new UIStore({ zoomLevel: 'day' });
    const { result } = renderHook(() => useUIStore((s) => s.zoomLevel), {
      wrapper: createWrapper(store),
    });

    expect(result.current).toBe('day');
  });

  it('updates when the selected slice changes', () => {
    const store = new UIStore({ zoomLevel: 'day' });
    const { result } = renderHook(() => useUIStore((s) => s.zoomLevel), {
      wrapper: createWrapper(store),
    });

    act(() => {
      store.setState({ zoomLevel: 'month' });
    });

    expect(result.current).toBe('month');
  });

  it('returns stable value when unrelated state changes', () => {
    const store = new UIStore({ zoomLevel: 'week', searchQuery: '' });
    const renderCount = { value: 0 };

    const { result } = renderHook(
      () => {
        renderCount.value++;
        return useUIStore((s) => s.zoomLevel);
      },
      { wrapper: createWrapper(store) }
    );

    const initialRenderCount = renderCount.value;
    expect(result.current).toBe('week');

    // Change an unrelated property
    act(() => {
      store.setState({ searchQuery: 'test' });
    });

    // The value should still be 'week'
    expect(result.current).toBe('week');
    // Note: useSyncExternalStore may still re-render but the value is stable
  });

  it('reads spreadsheetId and roomId from UIStore', () => {
    const store = new UIStore({ spreadsheetId: 'sheet-abc', roomId: 'room-abc' });
    const { result: sheetResult } = renderHook(() => useUIStore((s) => s.spreadsheetId), {
      wrapper: createWrapper(store),
    });
    const { result: roomResult } = renderHook(() => useUIStore((s) => s.roomId), {
      wrapper: createWrapper(store),
    });

    expect(sheetResult.current).toBe('sheet-abc');
    expect(roomResult.current).toBe('room-abc');
  });

  it('reactively updates spreadsheetId on setState', () => {
    const store = new UIStore({ spreadsheetId: undefined });
    const { result } = renderHook(() => useUIStore((s) => s.spreadsheetId), {
      wrapper: createWrapper(store),
    });

    expect(result.current).toBeUndefined();

    act(() => {
      store.setState({
        spreadsheetId: 'promoted-sheet',
        roomId: 'promoted-sheet',
        dataSource: 'loading',
      });
    });

    expect(result.current).toBe('promoted-sheet');
  });

  it('throws when used outside UIStoreProvider', () => {
    expect(() => {
      renderHook(() => useUIStore((s) => s.theme));
    }).toThrow('useUIStore must be used within UIStoreProvider');
  });
});
