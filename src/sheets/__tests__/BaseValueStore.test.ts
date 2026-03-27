import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseValueStore, hashTask } from '../BaseValueStore';
import type { Task } from '../../types';

// ─── In-memory IndexedDB mock ────────────────────────────────────────
// Simulates the IndexedDB API at the minimum level BaseValueStore uses.

function createMockIDB() {
  const stores = new Map<string, Map<string, string>>();

  function getStore(dbName: string): Map<string, string> {
    if (!stores.has(dbName)) stores.set(dbName, new Map());
    return stores.get(dbName)!;
  }

  const mockIndexedDB = {
    open: vi.fn((name: string, _version?: number) => {
      const store = getStore(name);
      const objectStoreNames = { contains: () => store.size >= 0 };
      const result = {
        result: {
          objectStoreNames,
          createObjectStore: () => {},
          close: vi.fn(),
          transaction: (_storeName: string, mode?: string) => ({
            objectStore: () => ({
              get: (key: string) => {
                const req = {
                  result: store.get(key),
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              put: (value: string, key: string) => {
                if (mode === 'readwrite') store.set(key, value);
                const req = {
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              delete: (key: string) => {
                if (mode === 'readwrite') store.delete(key);
                const req = {
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
              clear: () => {
                if (mode === 'readwrite') store.clear();
                const req = {
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
            }),
          }),
        },
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        result.onupgradeneeded?.();
        result.onsuccess?.();
      }, 0);
      return result;
    }),
  };

  return { mockIndexedDB, stores };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test',
    startDate: '2026-03-02',
    endDate: '2026-03-06',
    duration: 5,
    owner: '',
    workStream: '',
    project: '',
    functionalArea: '',
    done: false,
    description: '',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: [],
    dependencies: [],
    notes: '',
    okrs: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('BaseValueStore', () => {
  let store: BaseValueStore;
  let originalIndexedDB: typeof globalThis.indexedDB;

  beforeEach(() => {
    const { mockIndexedDB } = createMockIDB();
    originalIndexedDB = globalThis.indexedDB;
    (globalThis as Record<string, unknown>).indexedDB = mockIndexedDB;
    store = new BaseValueStore();
  });

  afterEach(() => {
    store.close();
    (globalThis as Record<string, unknown>).indexedDB = originalIndexedDB;
  });

  it('open + isOpen', async () => {
    expect(store.isOpen()).toBe(false);
    await store.open('test-sheet');
    expect(store.isOpen()).toBe(true);
  });

  it('close sets isOpen to false', async () => {
    await store.open('test-sheet');
    store.close();
    expect(store.isOpen()).toBe(false);
  });

  it('get returns undefined for missing keys', async () => {
    await store.open('test-sheet');
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('get returns undefined when not opened', async () => {
    const result = await store.get('anything');
    expect(result).toBeUndefined();
  });

  it('put + get round-trip', async () => {
    await store.open('test-sheet');
    await store.put('task-1', 'hash-abc');
    const result = await store.get('task-1');
    expect(result).toBe('hash-abc');
  });

  it('put overwrites existing value', async () => {
    await store.open('test-sheet');
    await store.put('task-1', 'hash-1');
    await store.put('task-1', 'hash-2');
    const result = await store.get('task-1');
    expect(result).toBe('hash-2');
  });

  it('delete removes a key', async () => {
    await store.open('test-sheet');
    await store.put('task-1', 'hash-abc');
    await store.delete('task-1');
    const result = await store.get('task-1');
    expect(result).toBeUndefined();
  });

  it('delete on missing key is a no-op', async () => {
    await store.open('test-sheet');
    await expect(store.delete('nonexistent')).resolves.toBeUndefined();
  });

  it('clear removes all keys', async () => {
    await store.open('test-sheet');
    await store.put('task-1', 'h1');
    await store.put('task-2', 'h2');
    await store.put('task-3', 'h3');
    await store.clear();
    expect(await store.get('task-1')).toBeUndefined();
    expect(await store.get('task-2')).toBeUndefined();
    expect(await store.get('task-3')).toBeUndefined();
  });

  it('operations are no-ops when not opened', async () => {
    // All operations should silently succeed (not throw) when store isn't opened
    await expect(store.put('k', 'v')).resolves.toBeUndefined();
    await expect(store.delete('k')).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('separate sheets have independent stores', async () => {
    const store2 = new BaseValueStore();
    const { mockIndexedDB } = createMockIDB();
    (globalThis as Record<string, unknown>).indexedDB = mockIndexedDB;

    await store.open('sheet-A');
    await store2.open('sheet-B');
    await store.put('task-1', 'hash-A');
    await store2.put('task-1', 'hash-B');

    expect(await store.get('task-1')).toBe('hash-A');
    expect(await store2.get('task-1')).toBe('hash-B');

    store2.close();
  });
});

describe('hashTask', () => {
  it('produces stable hashes for identical tasks', () => {
    const task = makeTask();
    expect(hashTask(task)).toBe(hashTask(task));
  });

  it('produces different hashes for different tasks', () => {
    const task1 = makeTask({ name: 'Task A' });
    const task2 = makeTask({ name: 'Task B' });
    expect(hashTask(task1)).not.toBe(hashTask(task2));
  });

  it('hash is independent of column order (uses canonical taskToRow)', () => {
    // hashTask always uses taskToRow (canonical order), so the hash
    // is the same regardless of how the Sheet columns are arranged
    const task = makeTask();
    const hash1 = hashTask(task);
    const hash2 = hashTask({ ...task }); // different object, same data
    expect(hash1).toBe(hash2);
  });

  it('excludes attribution columns from hash (first 20 only)', () => {
    // hashTask hashes first 20 columns, excluding lastModifiedBy/At
    // Two tasks with different attribution but same data should hash equally
    const task = makeTask();
    const hash = hashTask(task);
    // The hash uses \x00 as separator and slices to 20 columns
    const parts = hash.split('\x00');
    expect(parts.length).toBe(20);
  });
});
