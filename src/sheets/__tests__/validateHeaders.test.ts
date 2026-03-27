import { describe, it, expect } from 'vitest';
import { validateHeaders, buildHeaderMap, SHEET_COLUMNS, HEADER_ROW } from '../sheetsMapper';

describe('validateHeaders (returns HeaderMap | null)', () => {
  it('accepts exact match', () => {
    const result = validateHeaders([...SHEET_COLUMNS]);
    expect(result).not.toBeNull();
    expect(result!.get('id')).toBe(0);
    expect(result!.get('name')).toBe(1);
  });

  it('accepts case-insensitive match', () => {
    const upper = SHEET_COLUMNS.map((c) => c.toUpperCase());
    expect(validateHeaders([...upper])).not.toBeNull();
  });

  it('accepts extra columns after the required ones', () => {
    const headers = [...SHEET_COLUMNS, 'extraCol1', 'extraCol2'];
    expect(validateHeaders(headers)).not.toBeNull();
  });

  it('rejects when required columns are missing', () => {
    const partial = SHEET_COLUMNS.slice(0, 10);
    expect(validateHeaders([...partial])).toBeNull();
  });

  it('accepts reordered columns (header map resolves correct indices)', () => {
    // Swap id and name — should still work with header-based lookup
    const reordered = [...SHEET_COLUMNS] as string[];
    const tmp = reordered[0];
    reordered[0] = reordered[1];
    reordered[1] = tmp;

    const result = validateHeaders(reordered);
    expect(result).not.toBeNull();
    // id is now at index 1, name at index 0
    expect(result!.get('id')).toBe(1);
    expect(result!.get('name')).toBe(0);
  });

  it('rejects when a required column name is replaced with unknown', () => {
    const modified = [...SHEET_COLUMNS] as string[];
    modified[5] = 'assignee'; // 'owner' is missing
    expect(validateHeaders(modified)).toBeNull();
  });

  it('rejects empty header row', () => {
    expect(validateHeaders([])).toBeNull();
  });
});

describe('buildHeaderMap', () => {
  it('builds correct index map from canonical header', () => {
    const map = buildHeaderMap(HEADER_ROW)!;
    expect(map.get('id')).toBe(0);
    expect(map.get('name')).toBe(1);
    expect(map.get('startdate')).toBe(2); // case-insensitive
    expect(map.get('enddate')).toBe(3);
    expect(map.get('constraintdate')).toBe(19);
    expect(map.get('lastmodifiedby')).toBe(20);
  });

  it('returns null if required column is missing', () => {
    const headers = HEADER_ROW.filter((h) => h !== 'owner');
    expect(buildHeaderMap(headers)).toBeNull();
  });

  it('handles columns in any order', () => {
    // Reverse the columns
    const reversed = [...HEADER_ROW].reverse();
    const map = buildHeaderMap(reversed)!;
    expect(map).not.toBeNull();
    expect(map.get('id')).toBe(reversed.indexOf('id'));
    expect(map.get('owner')).toBe(reversed.indexOf('owner'));
  });

  it('ignores empty column names', () => {
    const headers = [...HEADER_ROW, '', '  '];
    const map = buildHeaderMap(headers)!;
    // Empty strings are not added to the map
    expect(map.has('')).toBe(false);
  });
});
