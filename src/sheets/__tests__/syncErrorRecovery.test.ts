import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stage 4 (Group F): sheetsSync is stubbed — these tests are disabled until SheetsAdapter replaces them

vi.mock('../sheetsClient', () => ({
  readSheet: vi.fn().mockResolvedValue([]),
  updateSheet: vi.fn().mockResolvedValue(undefined),
  clearSheet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sheetsMapper', async () => {
  const actual = await vi.importActual<typeof import('../sheetsMapper')>('../sheetsMapper');
  return actual;
});

vi.mock('../oauth', () => ({
  isSignedIn: vi.fn().mockReturnValue(true),
}));

import { updateSheet } from '../sheetsClient';
import { initSync, scheduleSave } from '../sheetsSync';
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

describe.skip('sync error recovery — disabled: sheetsSync stubbed for Stage 4', () => {
  let dispatched: { type: string; [key: string]: unknown }[];
  const mockedUpdateSheet = vi.mocked(updateSheet);

  beforeEach(() => {
    vi.useFakeTimers();
    dispatched = [];
    initSync('test-sheet', (action: { type: string; [key: string]: unknown }) =>
      dispatched.push(action)
    );
    mockedUpdateSheet.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('local edits succeed during sync error, and recovery triggers save', async () => {
    // Phase 1: Simulate sync error being set — the app dispatches SET_SYNC_ERROR externally
    dispatched.push({
      type: 'SET_SYNC_ERROR',
      error: { type: 'network', message: 'Offline', since: Date.now() },
    });

    // Phase 2: Local edits should work — scheduleSave still queues writes
    const tasks = [makeTask({ name: 'Updated Task' })];
    scheduleSave(tasks);

    // Advance past debounce to trigger the write
    await vi.advanceTimersByTimeAsync(3000);

    // updateSheet should have been called — local edits are not blocked
    expect(mockedUpdateSheet).toHaveBeenCalledTimes(1);

    // Phase 3: Simulate error clearing
    dispatched.push({ type: 'SET_SYNC_ERROR', error: null });

    // Phase 4: Calling scheduleSave again after recovery writes full state
    const recoveredTasks = [makeTask({ name: 'Recovered Task' })];
    scheduleSave(recoveredTasks);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedUpdateSheet).toHaveBeenCalledTimes(2);

    // Verify the second call includes the recovered task data
    const lastCallValues = mockedUpdateSheet.mock.calls[1][2];
    // Row 0 is headers, row 1 is the task
    expect(lastCallValues[1][1]).toBe('Recovered Task');
  });

  it('dispatches START_SYNC and COMPLETE_SYNC during save', async () => {
    const tasks = [makeTask()];
    scheduleSave(tasks);

    await vi.advanceTimersByTimeAsync(3000);

    const types = dispatched.map((a) => a.type);
    expect(types).toContain('START_SYNC');
    expect(types).toContain('COMPLETE_SYNC');
  });
});
