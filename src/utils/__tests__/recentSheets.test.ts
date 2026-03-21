import { describe, it, expect, beforeEach } from 'vitest';
import { getRecentSheets, addRecentSheet, removeRecentSheet } from '../recentSheets';

describe('recentSheets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty array from empty storage', () => {
    expect(getRecentSheets()).toEqual([]);
  });

  it('adds and retrieves a sheet', () => {
    addRecentSheet({ sheetId: 'a', title: 'Sheet A', lastOpened: 1000 });
    const sheets = getRecentSheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetId).toBe('a');
  });

  it('evicts oldest entry when exceeding 10', () => {
    for (let i = 0; i < 11; i++) {
      addRecentSheet({ sheetId: `s${i}`, title: `Sheet ${i}`, lastOpened: i });
    }
    const sheets = getRecentSheets();
    expect(sheets).toHaveLength(10);
    // s0 was added first and should have been evicted
    expect(sheets.find((s) => s.sheetId === 's0')).toBeUndefined();
    // s10 (most recent) should be first
    expect(sheets[0].sheetId).toBe('s10');
  });

  it('removes a sheet by ID', () => {
    addRecentSheet({ sheetId: 'a', title: 'A', lastOpened: 1 });
    addRecentSheet({ sheetId: 'b', title: 'B', lastOpened: 2 });
    removeRecentSheet('a');
    const sheets = getRecentSheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetId).toBe('b');
  });

  it('updates existing entry by moving it to front', () => {
    addRecentSheet({ sheetId: 'a', title: 'A', lastOpened: 1 });
    addRecentSheet({ sheetId: 'b', title: 'B', lastOpened: 2 });
    addRecentSheet({ sheetId: 'a', title: 'A updated', lastOpened: 3 });
    const sheets = getRecentSheets();
    expect(sheets).toHaveLength(2);
    expect(sheets[0].sheetId).toBe('a');
    expect(sheets[0].title).toBe('A updated');
    expect(sheets[0].lastOpened).toBe(3);
  });
});
