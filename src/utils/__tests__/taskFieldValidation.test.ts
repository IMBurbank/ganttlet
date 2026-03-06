import { describe, it, expect } from 'vitest';
import { validateTaskName, validateDuration, validateEndDate } from '../taskFieldValidation';

describe('validateTaskName', () => {
  it('returns null for a valid name', () => {
    expect(validateTaskName('Build MVP')).toBeNull();
  });

  it('returns error for empty string', () => {
    expect(validateTaskName('')).toBe('Name cannot be empty');
  });

  it('returns error for whitespace-only string', () => {
    expect(validateTaskName('   ')).toBe('Name cannot be empty');
  });

  it('returns error for tab-only string', () => {
    expect(validateTaskName('\t')).toBe('Name cannot be empty');
  });

  it('returns null for name with leading/trailing whitespace (trims internally)', () => {
    expect(validateTaskName('  Valid Name  ')).toBeNull();
  });
});

describe('validateDuration', () => {
  it('returns null for a valid duration', () => {
    expect(validateDuration('5')).toBeNull();
  });

  it('returns null for duration of 1 (minimum)', () => {
    expect(validateDuration('1')).toBeNull();
  });

  it('returns error for zero duration', () => {
    expect(validateDuration('0')).toBe('Duration must be at least 1 day');
  });

  it('returns error for negative duration', () => {
    expect(validateDuration('-3')).toBe('Duration must be at least 1 day');
  });

  it('returns error for non-numeric input', () => {
    expect(validateDuration('abc')).toBe('Duration must be a number');
  });

  it('returns error for empty string', () => {
    expect(validateDuration('')).toBe('Duration must be a number');
  });
});

describe('validateEndDate', () => {
  it('returns null when end date equals start date', () => {
    expect(validateEndDate('2026-03-01', '2026-03-01')).toBeNull();
  });

  it('returns null when end date is after start date', () => {
    expect(validateEndDate('2026-03-01', '2026-03-15')).toBeNull();
  });

  it('returns error when end date is before start date', () => {
    expect(validateEndDate('2026-03-15', '2026-03-01')).toBe(
      'End date must be on or after start date'
    );
  });

  it('returns error when end date is one day before start date', () => {
    expect(validateEndDate('2026-03-02', '2026-03-01')).toBe(
      'End date must be on or after start date'
    );
  });

  it('returns null for dates spanning year boundary', () => {
    expect(validateEndDate('2025-12-31', '2026-01-01')).toBeNull();
  });
});
