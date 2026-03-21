import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../sheetsClient', () => ({
  readSheet: vi.fn(),
  updateSheet: vi.fn(),
}));

vi.mock('../sheetsMapper', () => ({
  rowsToTasks: vi.fn().mockReturnValue([]),
  tasksToRows: vi.fn().mockReturnValue([]),
  validateHeaders: vi.fn().mockReturnValue(true),
  SHEET_COLUMNS: ['id', 'name'],
}));

vi.mock('../oauth', () => ({
  isSignedIn: vi.fn().mockReturnValue(true),
}));

vi.mock('../../collab/yjsBinding', () => ({
  applyTasksToYjs: vi.fn(),
}));

vi.mock('../../collab/yjsProvider', () => ({
  getDoc: vi.fn().mockReturnValue(null),
}));

import { readSheet } from '../sheetsClient';
import { initSync, startPolling, stopPolling, BASE_POLL_INTERVAL_MS } from '../sheetsSync';
import type { GanttAction } from '../../state/actions';

const mockedReadSheet = vi.mocked(readSheet);

describe('polling backoff', () => {
  let dispatchSpy: ReturnType<typeof vi.fn<(action: GanttAction) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    dispatchSpy = vi.fn<(action: GanttAction) => void>();
    initSync('test-sheet', dispatchSpy);
  });

  afterEach(() => {
    stopPolling();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('polls at base interval on success', async () => {
    mockedReadSheet.mockResolvedValue([]);
    startPolling();

    // First poll fires after BASE_POLL_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(1);

    // Second poll after another BASE_POLL_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(2);
  });

  it('doubles interval after 3 consecutive errors', async () => {
    const networkError = new TypeError('Failed to fetch');
    mockedReadSheet.mockRejectedValue(networkError);

    startPolling();

    // Errors 1-2: still at base interval
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(2);

    // Error 3: triggers backoff — next poll at 60s
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(3);

    // Should NOT fire at base interval
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(3);

    // Should fire at doubled interval (60s)
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(4);
  });

  it('caps backoff at 300 seconds', async () => {
    const networkError = new TypeError('Failed to fetch');
    mockedReadSheet.mockRejectedValue(networkError);

    startPolling();

    // Run enough errors to exceed max: 30s, 30s, 30s (backoff starts), 60s, 120s, 240s, 300s (capped)
    // Errors 1-3 at 30s each
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    }
    expect(mockedReadSheet).toHaveBeenCalledTimes(3);

    // Error 4 at 60s
    await vi.advanceTimersByTimeAsync(60000);
    expect(mockedReadSheet).toHaveBeenCalledTimes(4);

    // Error 5 at 120s
    await vi.advanceTimersByTimeAsync(120000);
    expect(mockedReadSheet).toHaveBeenCalledTimes(5);

    // Error 6 at 240s
    await vi.advanceTimersByTimeAsync(240000);
    expect(mockedReadSheet).toHaveBeenCalledTimes(6);

    // Error 7 should be at 300s (capped, not 480s)
    await vi.advanceTimersByTimeAsync(300000);
    expect(mockedReadSheet).toHaveBeenCalledTimes(7);
  });

  it('resets to base interval on success after backoff', async () => {
    const networkError = new TypeError('Failed to fetch');
    mockedReadSheet.mockRejectedValue(networkError);

    startPolling();

    // 3 errors to trigger backoff
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    }
    expect(mockedReadSheet).toHaveBeenCalledTimes(3);

    // Now succeed on next call
    mockedReadSheet.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(60000); // doubled interval
    expect(mockedReadSheet).toHaveBeenCalledTimes(4);

    // Should be back to base interval
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(5);
  });

  it('hard-stops on 404 (not_found) — no reschedule', async () => {
    const response404 = new Response(null, { status: 404 });
    mockedReadSheet.mockRejectedValue(response404);

    startPolling();
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(1);

    // Dispatches SET_SYNC_ERROR
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_SYNC_ERROR',
        error: expect.objectContaining({ type: 'not_found' }),
      })
    );

    // Should NOT poll again
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS * 10);
    expect(mockedReadSheet).toHaveBeenCalledTimes(1);
  });

  it('hard-stops on 403 (forbidden) — no reschedule', async () => {
    const response403 = new Response(null, { status: 403 });
    mockedReadSheet.mockRejectedValue(response403);

    startPolling();
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    expect(mockedReadSheet).toHaveBeenCalledTimes(1);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_SYNC_ERROR',
        error: expect.objectContaining({ type: 'forbidden' }),
      })
    );

    // Should NOT poll again
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS * 10);
    expect(mockedReadSheet).toHaveBeenCalledTimes(1);
  });

  it('dispatches SET_SYNC_ERROR only once per error sequence', async () => {
    const networkError = new TypeError('Failed to fetch');
    mockedReadSheet.mockRejectedValue(networkError);

    startPolling();

    // First error dispatches
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    const syncErrorCalls = dispatchSpy.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'SET_SYNC_ERROR'
    );
    expect(syncErrorCalls).toHaveLength(1);

    // Second error does NOT dispatch again
    await vi.advanceTimersByTimeAsync(BASE_POLL_INTERVAL_MS);
    const syncErrorCalls2 = dispatchSpy.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'SET_SYNC_ERROR'
    );
    expect(syncErrorCalls2).toHaveLength(1);
  });
});
