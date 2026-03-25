import { describe, it, expect, vi } from 'vitest';
import { UIStore, createDefaultUIState } from '../UIStore';

describe('UIStore', () => {
  it('initializes with default state', () => {
    const store = new UIStore();
    const state = store.getState();
    expect(state.zoomLevel).toBe('week');
    expect(state.theme).toBe('light');
    expect(state.dataSource).toBeUndefined();
    expect(state.searchQuery).toBe('');
    expect(state.expandedTasks).toBeInstanceOf(Set);
  });

  it('accepts initial state overrides', () => {
    const store = new UIStore({ theme: 'dark', zoomLevel: 'day' });
    expect(store.getState().theme).toBe('dark');
    expect(store.getState().zoomLevel).toBe('day');
  });

  it('setState merges partial updates', () => {
    const store = new UIStore();
    store.setState({ searchQuery: 'hello' });
    expect(store.getState().searchQuery).toBe('hello');
    expect(store.getState().theme).toBe('light'); // unchanged
  });

  it('setState notifies listeners', () => {
    const store = new UIStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ zoomLevel: 'month' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = new UIStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.setState({ zoomLevel: 'day' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.setState({ zoomLevel: 'month' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('handles context menu state transitions', () => {
    const store = new UIStore();
    expect(store.getState().contextMenu).toBeNull();

    store.setState({ contextMenu: { x: 100, y: 200, taskId: 'task-1' } });
    expect(store.getState().contextMenu).toEqual({ x: 100, y: 200, taskId: 'task-1' });

    store.setState({ contextMenu: null });
    expect(store.getState().contextMenu).toBeNull();
  });

  it('handles expandedTasks as a Set', () => {
    const store = new UIStore();
    const expanded = new Set(['a', 'b']);
    store.setState({ expandedTasks: expanded });
    expect(store.getState().expandedTasks).toBe(expanded);
    expect(store.getState().expandedTasks.has('a')).toBe(true);
  });

  it('handles dataSource transitions', () => {
    const store = new UIStore();
    expect(store.getState().dataSource).toBeUndefined();

    store.setState({ dataSource: 'loading' });
    expect(store.getState().dataSource).toBe('loading');

    store.setState({ dataSource: 'sheet' });
    expect(store.getState().dataSource).toBe('sheet');
  });

  it('handles pendingConflicts', () => {
    const store = new UIStore();
    expect(store.getState().pendingConflicts).toBeNull();

    const conflicts = [
      { taskId: 't1', field: 'name', localValue: 'A', remoteValue: 'B', baseValue: 'C' },
    ];
    store.setState({ pendingConflicts: conflicts });
    expect(store.getState().pendingConflicts).toEqual(conflicts);

    store.setState({ pendingConflicts: null });
    expect(store.getState().pendingConflicts).toBeNull();
  });

  it('multiple listeners all fire on setState', () => {
    const store = new UIStore();
    const l1 = vi.fn();
    const l2 = vi.fn();
    store.subscribe(l1);
    store.subscribe(l2);

    store.setState({ theme: 'dark' });
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it('createDefaultUIState returns fresh state each call', () => {
    const a = createDefaultUIState();
    const b = createDefaultUIState();
    expect(a).not.toBe(b);
    expect(a.expandedTasks).not.toBe(b.expandedTasks);
  });

  it('criticalPathScope supports all type', () => {
    const store = new UIStore();
    expect(store.getState().criticalPathScope).toEqual({ type: 'all' });

    store.setState({ criticalPathScope: { type: 'project', name: 'Alpha' } });
    expect(store.getState().criticalPathScope).toEqual({ type: 'project', name: 'Alpha' });
  });
});
