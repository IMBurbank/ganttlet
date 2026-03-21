import { describe, it, expect } from 'vitest';
import { parseSheetUrl } from '../parseSheetUrl';

describe('parseSheetUrl', () => {
  it('extracts ID from standard URL with /edit', () => {
    expect(
      parseSheetUrl(
        'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit'
      )
    ).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  });

  it('extracts ID from URL with #gid=0', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/abc123_-XY/edit#gid=0')).toBe(
      'abc123_-XY'
    );
  });

  it('extracts ID from URL with query params', () => {
    expect(
      parseSheetUrl('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing&ouid=123')
    ).toBe('abc123');
  });

  it('returns null for non-Sheets URL', () => {
    expect(parseSheetUrl('https://docs.google.com/document/d/abc123/edit')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSheetUrl('')).toBeNull();
  });

  it('returns null for bare spreadsheet ID (no URL)', () => {
    expect(parseSheetUrl('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms')).toBeNull();
  });
});
