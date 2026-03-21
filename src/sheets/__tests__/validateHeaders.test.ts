import { describe, it, expect } from 'vitest';
import { validateHeaders, SHEET_COLUMNS } from '../sheetsMapper';

describe('validateHeaders', () => {
  it('accepts exact match', () => {
    expect(validateHeaders([...SHEET_COLUMNS])).toBe(true);
  });

  it('accepts case-insensitive match', () => {
    const upper = SHEET_COLUMNS.map((c) => c.toUpperCase());
    expect(validateHeaders([...upper])).toBe(true);
  });

  it('accepts extra columns after the required 20', () => {
    const headers = [...SHEET_COLUMNS, 'extraCol1', 'extraCol2'];
    expect(validateHeaders(headers)).toBe(true);
  });

  it('rejects when too few columns', () => {
    const partial = SHEET_COLUMNS.slice(0, 10);
    expect(validateHeaders([...partial])).toBe(false);
  });

  it('rejects when column order is wrong', () => {
    const swapped = [...SHEET_COLUMNS];
    const tmp = swapped[0];
    swapped[0] = swapped[1];
    swapped[1] = tmp;
    expect(validateHeaders(swapped)).toBe(false);
  });

  it('rejects when a column name is different', () => {
    const modified = [...SHEET_COLUMNS] as string[];
    modified[5] = 'assignee'; // should be 'owner'
    expect(validateHeaders(modified)).toBe(false);
  });

  it('rejects empty header row', () => {
    expect(validateHeaders([])).toBe(false);
  });
});
