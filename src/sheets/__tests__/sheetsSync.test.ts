import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../sheetsClient', () => ({
  updateSheet: vi.fn().mockResolvedValue(undefined),
  readSheet: vi.fn().mockResolvedValue([]),
  clearSheet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sheetsMapper', async () => {
  const actual = await vi.importActual<typeof import('../sheetsMapper')>('../sheetsMapper');
  return actual;
});

vi.mock('../oauth', () => ({
  isSignedIn: vi.fn().mockReturnValue(true),
}));

vi.mock('../../collab/yjsBinding', () => ({
  applyTasksToYjs: vi.fn(),
}));

vi.mock('../../collab/yjsProvider', () => ({
  getDoc: vi.fn().mockReturnValue(null),
}));

import { updateSheet, readSheet, clearSheet } from '../sheetsClient';
import {
  columnLetter,
  scheduleSave,
  initSync,
  cancelPendingSave,
  startPolling,
  stopPolling,
  isSavePending,
} from '../sheetsSync';
import { SHEET_COLUMNS } from '../sheetsMapper';
import type { Task } from '../../types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Design Review',
    startDate: '2026-03-11',
    endDate: '2026-03-13',
    duration: 3,
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

describe('columnLetter', () => {
  it('returns A for 1', () => {
    expect(columnLetter(1)).toBe('A');
  });

  it('returns R for 18', () => {
    expect(columnLetter(18)).toBe('R');
  });

  it('returns T for 20 (current SHEET_COLUMNS length)', () => {
    expect(columnLetter(20)).toBe('T');
  });

  it('returns Z for 26', () => {
    expect(columnLetter(26)).toBe('Z');
  });

  it('returns AA for 27', () => {
    expect(columnLetter(27)).toBe('AA');
  });
});

describe('scheduleSave write range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    initSync('spreadsheet-id-123', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('write range ends at column derived from SHEET_COLUMNS.length', async () => {
    const tasks = [makeTask()];
    const expectedEndCol = columnLetter(SHEET_COLUMNS.length); // 'T' for 20 columns

    scheduleSave(tasks);
    await vi.runAllTimersAsync();

    expect(updateSheet).toHaveBeenCalledTimes(1);
    const [, range] = (updateSheet as ReturnType<typeof vi.fn>).mock.calls[0];
    // Range should be Sheet1!A1:T{rowCount}
    expect(range).toMatch(new RegExp(`^Sheet1!A1:${expectedEndCol}\\d+$`));
  });

  it('write range does NOT use hardcoded R', async () => {
    // Use a distinct task so the hash differs from other tests
    const tasks = [makeTask({ id: 'unique-no-R', name: 'No R Check' })];

    scheduleSave(tasks);
    await vi.runAllTimersAsync();

    expect(updateSheet).toHaveBeenCalledTimes(1);
    const [, range] = (updateSheet as ReturnType<typeof vi.fn>).mock.calls[0];
    // Range must not end at column R (the old broken value)
    expect(range).not.toMatch(/^Sheet1!A1:R\d+$/);
  });

  it('write range row count equals number of tasks plus header', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })];

    scheduleSave(tasks);
    await vi.runAllTimersAsync();

    expect(updateSheet).toHaveBeenCalledTimes(1);
    const [, range] = (updateSheet as ReturnType<typeof vi.fn>).mock.calls[0];
    // header row + 3 tasks = 4 rows
    const match = range.match(/(\d+)$/);
    expect(Number(match?.[1])).toBe(4);
  });
});

describe('cancelPendingSave (T2.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    initSync('spreadsheet-id-123', vi.fn());
  });

  afterEach(() => {
    cancelPendingSave();
    vi.useRealTimers();
  });

  it('clears pending write timer so save never fires', async () => {
    scheduleSave([makeTask({ id: 'cancel-1', name: 'Will Be Cancelled' })]);
    // Timer is pending but hasn't fired yet
    cancelPendingSave();
    await vi.runAllTimersAsync();

    expect(updateSheet).not.toHaveBeenCalled();
  });

  it('resets saveDirty flag', () => {
    scheduleSave([makeTask({ id: 'cancel-2', name: 'Dirty Check' })]);
    expect(isSavePending()).toBe(true);
    cancelPendingSave();
    expect(isSavePending()).toBe(false);
  });
});

describe('T1.1 — clear orphaned rows after save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    initSync('spreadsheet-id-123', vi.fn());
  });

  afterEach(() => {
    cancelPendingSave();
    vi.useRealTimers();
  });

  it('calls clearSheet after updateSheet with range below data', async () => {
    const tasks = [makeTask({ id: 'orphan-1' }), makeTask({ id: 'orphan-2' })];

    scheduleSave(tasks);
    await vi.runAllTimersAsync();

    expect(updateSheet).toHaveBeenCalledTimes(1);
    expect(clearSheet).toHaveBeenCalledTimes(1);
    // 1 header + 2 tasks = 3 rows → clear from row 4
    const [, clearRange] = (clearSheet as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(clearRange).toBe('Sheet1!A4:T');
  });

  it('save succeeds even if clearSheet throws', async () => {
    (clearSheet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('clear failed'));
    const mockDispatch = vi.fn();
    initSync('spreadsheet-id-123', mockDispatch as any);

    scheduleSave([makeTask({ id: 'orphan-robust', name: 'Robust Save' })]);
    await vi.runAllTimersAsync();

    expect(updateSheet).toHaveBeenCalledTimes(1);
    // COMPLETE_SYNC should still fire even though clearSheet failed
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'COMPLETE_SYNC' });
  });
});

describe('T2.1 — hashTasks covers all persisted fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    initSync('spreadsheet-id-123', vi.fn());
  });

  afterEach(() => {
    cancelPendingSave();
    vi.useRealTimers();
  });

  it('hash changes when description is modified', async () => {
    const tasks1 = [makeTask({ id: 'hash-1', description: 'original' })];
    scheduleSave(tasks1);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);

    // Same task with different description should trigger a new save
    const tasks2 = [makeTask({ id: 'hash-1', description: 'updated' })];
    scheduleSave(tasks2);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(2);
  });

  it('hash is stable across different array orderings', async () => {
    const taskA = makeTask({ id: 'aaa', name: 'A' });
    const taskB = makeTask({ id: 'bbb', name: 'B' });

    // First save: [A, B]
    scheduleSave([taskA, taskB]);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);

    // Second save: [B, A] — same tasks, different order. Hash should match.
    scheduleSave([taskB, taskA]);
    await vi.runAllTimersAsync();
    // Should NOT have called updateSheet again since hash is the same
    expect(updateSheet).toHaveBeenCalledTimes(1);
  });

  it('hash does NOT change when isExpanded changes', async () => {
    const tasks1 = [makeTask({ id: 'expand-1', isExpanded: true })];
    scheduleSave(tasks1);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);

    // Same task with different isExpanded should NOT trigger save
    const tasks2 = [makeTask({ id: 'expand-1', isExpanded: false })];
    scheduleSave(tasks2);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);
  });

  it('hash does NOT change when isHidden changes', async () => {
    const tasks1 = [makeTask({ id: 'hidden-1', isHidden: false })];
    scheduleSave(tasks1);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);

    const tasks2 = [makeTask({ id: 'hidden-1', isHidden: true })];
    scheduleSave(tasks2);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);
  });

  it('hash changes when workStream is modified', async () => {
    const tasks1 = [makeTask({ id: 'ws-1', workStream: 'Frontend' })];
    scheduleSave(tasks1);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(1);

    const tasks2 = [makeTask({ id: 'ws-1', workStream: 'Backend' })];
    scheduleSave(tasks2);
    await vi.runAllTimersAsync();
    expect(updateSheet).toHaveBeenCalledTimes(2);
  });
});

describe('T2.2 — saveDirty + saveInFlight poll guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    initSync('spreadsheet-id-123', vi.fn() as any);
  });

  afterEach(() => {
    stopPolling();
    cancelPendingSave();
    vi.useRealTimers();
  });

  it('pollOnce skips when saveDirty (debounce pending)', async () => {
    // Make updateSheet hang so saveDirty stays true through the poll
    (updateSheet as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    // Schedule a save (sets saveDirty), then start polling
    scheduleSave([makeTask({ id: 'poll-dirty', name: 'Dirty Task' })]);
    expect(isSavePending()).toBe(true);

    startPolling();

    // Advance past the save debounce (2s) so the save starts (saveInFlight=true)
    // then advance to the poll interval (30s). Save never resolves so flags stay set.
    await vi.advanceTimersByTimeAsync(30000);

    // readSheet should NOT have been called because poll was skipped
    expect(readSheet).not.toHaveBeenCalled();

    // Restore default mock for cleanup
    (updateSheet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('pollOnce skips when saveInFlight (API call active)', async () => {
    // Make updateSheet hang so saveInFlight stays true, then advance past debounce
    let resolveUpdate!: () => void;
    (updateSheet as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        })
    );

    scheduleSave([makeTask({ id: 'inflight-1', name: 'In Flight' })]);

    // Advance past debounce (2s) to start the API call (saveInFlight=true)
    await vi.advanceTimersByTimeAsync(2100);
    // At this point, saveDirty is still true and saveInFlight is true (API in progress)

    startPolling();
    await vi.advanceTimersByTimeAsync(30000);

    // readSheet should NOT have been called
    expect(readSheet).not.toHaveBeenCalled();

    // Resolve the update to clean up
    resolveUpdate();
    await vi.advanceTimersByTimeAsync(0);

    // Restore default mock
    (updateSheet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('saveDirty and saveInFlight reset to false even when updateSheet throws', async () => {
    (updateSheet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

    scheduleSave([makeTask({ id: 'error-1', name: 'Error Task' })]);
    expect(isSavePending()).toBe(true);

    await vi.runAllTimersAsync();
    expect(isSavePending()).toBe(false);
  });
});

describe('scheduleSave error dispatches SET_SYNC_ERROR (T3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelPendingSave();
    vi.useRealTimers();
  });

  it('dispatches SET_SYNC_ERROR when updateSheet rejects', async () => {
    (updateSheet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );
    const mockDispatch = vi.fn();
    initSync('spreadsheet-id-123', mockDispatch as any);

    scheduleSave([makeTask({ id: 'err-save', name: 'Error Save' })]);
    await vi.runAllTimersAsync();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_SYNC_ERROR',
        error: expect.objectContaining({ type: 'network' }),
      })
    );
    // RESET_SYNC should also fire
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'RESET_SYNC' });
  });
});
