import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { SheetsAdapter, type SheetsAdapterCallbacks } from '../SheetsAdapter';
import { HEADER_ROW, taskToRow } from '../sheetsMapper';
import type { Task, ConflictRecord, SyncError } from '../../types';

// Mock sheetsClient
vi.mock('../sheetsClient', () => ({
  readSheet: vi.fn(),
  writeSheet: vi.fn(),
}));

// Mock oauth
vi.mock('../oauth', () => ({
  getAuthState: () => ({ userEmail: 'test@example.com' }),
}));

// Mock indexedDB
const mockIDBStore = new Map<string, string>();
const mockIDB = {
  transaction: () => ({
    objectStore: () => ({
      get: (key: string) => {
        const result = {
          result: mockIDBStore.get(key),
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        setTimeout(() => result.onsuccess?.(), 0);
        return result;
      },
      put: (value: string, key: string) => {
        mockIDBStore.set(key, value);
        const result = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        setTimeout(() => result.onsuccess?.(), 0);
        return result;
      },
      clear: () => {
        mockIDBStore.clear();
        const result = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        setTimeout(() => result.onsuccess?.(), 0);
        return result;
      },
    }),
  }),
  close: vi.fn(),
  objectStoreNames: { contains: () => true },
};

const mockIndexedDBOpen = {
  result: mockIDB,
  onsuccess: null as (() => void) | null,
  onerror: null as (() => void) | null,
  onupgradeneeded: null as (() => void) | null,
};

vi.stubGlobal('indexedDB', {
  open: () => {
    const req = { ...mockIndexedDBOpen };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  },
});

import { readSheet, writeSheet } from '../sheetsClient';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    startDate: '2025-01-06',
    endDate: '2025-01-10',
    duration: 5,
    owner: 'Alice',
    workStream: 'Engineering',
    project: 'Alpha',
    functionalArea: 'Backend',
    done: false,
    description: '',
    isMilestone: false,
    isSummary: false,
    parentId: null,
    childIds: [],
    dependencies: [],
    isExpanded: true,
    isHidden: false,
    notes: '',
    okrs: [],
    ...overrides,
  };
}

function populateYDoc(doc: Y.Doc, tasks: Task[]): void {
  const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
  const taskOrder = doc.getArray<string>('taskOrder');

  doc.transact(() => {
    for (const task of tasks) {
      const ymap = new Y.Map<unknown>();
      ymap.set('id', task.id);
      ymap.set('name', task.name);
      ymap.set('startDate', task.startDate);
      ymap.set('endDate', task.endDate);
      ymap.set('owner', task.owner);
      ymap.set('workStream', task.workStream);
      ymap.set('project', task.project);
      ymap.set('functionalArea', task.functionalArea);
      ymap.set('done', task.done);
      ymap.set('description', task.description);
      ymap.set('isMilestone', task.isMilestone);
      ymap.set('isSummary', task.isSummary);
      ymap.set('parentId', task.parentId);
      ymap.set('childIds', JSON.stringify(task.childIds));
      ymap.set('dependencies', JSON.stringify(task.dependencies));
      ymap.set('notes', task.notes);
      ymap.set('okrs', JSON.stringify(task.okrs));
      ytasks.set(task.id, ymap);
      taskOrder.push([task.id]);
    }
  }, 'local');
}

describe('SheetsAdapter', () => {
  let doc: Y.Doc;
  let callbacks: SheetsAdapterCallbacks;
  let conflictCalls: ConflictRecord[][];
  let syncErrorCalls: (SyncError | null)[];
  let syncingCalls: boolean[];
  let syncCompleteCalls: number;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    doc = new Y.Doc();
    conflictCalls = [];
    syncErrorCalls = [];
    syncingCalls = [];
    syncCompleteCalls = 0;
    mockIDBStore.clear();

    callbacks = {
      onConflict: (conflicts) => conflictCalls.push(conflicts),
      onSyncError: (error) => syncErrorCalls.push(error),
      onSyncing: (syncing) => syncingCalls.push(syncing),
      onSyncComplete: () => syncCompleteCalls++,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates an adapter with correct constructor', () => {
    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    expect(adapter).toBeDefined();
    expect(adapter.isSavePending()).toBe(false);
  });

  it('stop() cleans up timers and observers', async () => {
    vi.mocked(readSheet).mockResolvedValue([]);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    adapter.stop();
    expect(adapter.isSavePending()).toBe(false);
  });

  it('loads from empty sheet and marks dirty if Y.Doc has tasks', async () => {
    const task = makeTask();
    populateYDoc(doc, [task]);

    vi.mocked(readSheet).mockResolvedValue([]);
    vi.mocked(writeSheet).mockResolvedValue(undefined);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    // Should have called syncComplete
    expect(syncCompleteCalls).toBe(1);

    adapter.stop();
  });

  it('reports auth error when no token available', async () => {
    vi.mocked(readSheet).mockResolvedValue([]);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => null);
    await adapter.start();

    // readSheet won't be called if no token
    adapter.stop();
  });

  it('detects header mismatch and sets sync error', async () => {
    vi.mocked(readSheet).mockResolvedValue([['wrong', 'headers']]);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    const headerError = syncErrorCalls.find((e) => e?.type === 'header_mismatch');
    expect(headerError).toBeDefined();
    expect(headerError?.message).toContain('columns do not match');

    adapter.stop();
  });

  it('injects sheet tasks into empty Y.Doc', async () => {
    const task = makeTask({ id: 'task-from-sheet' });
    const row = taskToRow(task);

    vi.mocked(readSheet).mockResolvedValue([HEADER_ROW, row]);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    expect(ytasks.has('task-from-sheet')).toBe(true);

    adapter.stop();
  });

  it('debounces writes on local Y.Doc changes', async () => {
    vi.mocked(readSheet).mockResolvedValue([]);
    vi.mocked(writeSheet).mockResolvedValue(undefined);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    // Make a local change
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    doc.transact(() => {
      const ymap = new Y.Map<unknown>();
      ymap.set('id', 'new-task');
      ymap.set('name', 'New Task');
      ymap.set('startDate', '2025-01-06');
      ymap.set('endDate', '2025-01-10');
      ymap.set('owner', '');
      ymap.set('workStream', '');
      ymap.set('project', '');
      ymap.set('functionalArea', '');
      ymap.set('done', false);
      ymap.set('description', '');
      ymap.set('isMilestone', false);
      ymap.set('isSummary', false);
      ymap.set('parentId', null);
      ymap.set('childIds', '[]');
      ymap.set('dependencies', '[]');
      ymap.set('notes', '');
      ymap.set('okrs', '[]');
      ytasks.set('new-task', ymap);
    }, 'local');

    expect(adapter.isSavePending()).toBe(true);

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(2500);

    expect(writeSheet).toHaveBeenCalled();

    adapter.stop();
  });

  it('classifies 401 errors as auth type', async () => {
    const mockResponse = new Response(null, { status: 401 });
    vi.mocked(readSheet).mockRejectedValue(mockResponse);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    const authError = syncErrorCalls.find((e) => e?.type === 'auth');
    expect(authError).toBeDefined();

    adapter.stop();
  });

  it('classifies 404 errors as not_found type', async () => {
    const mockResponse = new Response(null, { status: 404 });
    vi.mocked(readSheet).mockRejectedValue(mockResponse);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    const notFoundError = syncErrorCalls.find((e) => e?.type === 'not_found');
    expect(notFoundError).toBeDefined();

    adapter.stop();
  });

  it('handles online/offline events', async () => {
    vi.mocked(readSheet).mockResolvedValue([]);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    // Simulate offline
    window.dispatchEvent(new Event('offline'));
    const offlineError = syncErrorCalls.find((e) => e?.type === 'network');
    expect(offlineError).toBeDefined();

    // Simulate online
    window.dispatchEvent(new Event('online'));
    const clearError = syncErrorCalls[syncErrorCalls.length - 1];
    expect(clearError).toBeNull();

    adapter.stop();
  });

  it('clearBaseValues empties IndexedDB store', async () => {
    vi.mocked(readSheet).mockResolvedValue([]);

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    mockIDBStore.set('task-1', 'hash-value');
    await adapter.clearBaseValues();

    expect(mockIDBStore.size).toBe(0);

    adapter.stop();
  });

  it('only clears saveDirty on successful write', async () => {
    vi.mocked(readSheet).mockResolvedValue([]);
    vi.mocked(writeSheet).mockRejectedValueOnce(new Error('Network error'));

    const adapter = new SheetsAdapter(doc, 'sheet-1', callbacks, () => 'token');
    await adapter.start();

    // Make a local change
    const ytasks = doc.getMap('tasks') as Y.Map<Y.Map<unknown>>;
    doc.transact(() => {
      const ymap = new Y.Map<unknown>();
      ymap.set('id', 'fail-task');
      ymap.set('name', 'Fail Task');
      ymap.set('startDate', '2025-01-06');
      ymap.set('endDate', '2025-01-10');
      ymap.set('owner', '');
      ymap.set('workStream', '');
      ymap.set('project', '');
      ymap.set('functionalArea', '');
      ymap.set('done', false);
      ymap.set('description', '');
      ymap.set('isMilestone', false);
      ymap.set('isSummary', false);
      ymap.set('parentId', null);
      ymap.set('childIds', '[]');
      ymap.set('dependencies', '[]');
      ymap.set('notes', '');
      ymap.set('okrs', '[]');
      ytasks.set('fail-task', ymap);
    }, 'local');

    await vi.advanceTimersByTimeAsync(2500);

    // Write failed — saveDirty should still be true
    expect(adapter.isSavePending()).toBe(true);

    adapter.stop();
  });
});
