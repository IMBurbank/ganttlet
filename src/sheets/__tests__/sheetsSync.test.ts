import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../sheetsClient', () => ({
  updateSheet: vi.fn().mockResolvedValue(undefined),
  readSheet: vi.fn().mockResolvedValue([]),
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

import { updateSheet } from '../sheetsClient';
import { columnLetter, scheduleSave, initSync } from '../sheetsSync';
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
