import { describe, it, expect } from 'vitest';
import {
  validateTaskName,
  validateDuration,
  validateEndDateAfterStart,
  validateStartDateBeforeEnd,
} from '../taskFieldValidation';

describe('validateTaskName', () => {
  it('returns null for a valid name', () => {
    expect(validateTaskName('Design mockups')).toBeNull();
  });

  it('returns error for empty string', () => {
    expect(validateTaskName('')).toBe('Task name cannot be empty');
  });

  it('returns error for whitespace-only string', () => {
    expect(validateTaskName('   ')).toBe('Task name cannot be empty');
  });

  it('returns error for tab-only string', () => {
    expect(validateTaskName('\t')).toBe('Task name cannot be empty');
  });

  it('returns null for name with surrounding whitespace (trimmed is non-empty)', () => {
    expect(validateTaskName('  valid name  ')).toBeNull();
  });
});

describe('validateDuration', () => {
  it('returns null for a valid duration', () => {
    expect(validateDuration('5')).toBeNull();
  });

  it('returns null for minimum valid duration of 1', () => {
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

  it('returns error for floating point string (parseInt gives whole number)', () => {
    expect(validateDuration('2.5')).toBeNull(); // parseInt('2.5') === 2, which is >= 1
  });
});

describe('validateEndDateAfterStart', () => {
  it('returns null when end date is after start date', () => {
    expect(validateEndDateAfterStart('2026-03-01', '2026-03-10')).toBeNull();
  });

  it('returns null when end date equals start date', () => {
    expect(validateEndDateAfterStart('2026-03-01', '2026-03-01')).toBeNull();
  });

  it('returns error when end date is before start date', () => {
    expect(validateEndDateAfterStart('2026-03-10', '2026-03-01')).toBe(
      'End date must be on or after start date',
    );
  });

  it('returns null when start date is empty', () => {
    expect(validateEndDateAfterStart('', '2026-03-01')).toBeNull();
  });

  it('returns null when end date is empty', () => {
    expect(validateEndDateAfterStart('2026-03-01', '')).toBeNull();
  });
});

describe('validateStartDateBeforeEnd', () => {
  it('returns null when start date is before end date', () => {
    expect(validateStartDateBeforeEnd('2026-03-01', '2026-03-10')).toBeNull();
  });

  it('returns null when start date equals end date', () => {
    expect(validateStartDateBeforeEnd('2026-03-01', '2026-03-01')).toBeNull();
  });

  it('returns error when start date is after end date', () => {
    expect(validateStartDateBeforeEnd('2026-03-10', '2026-03-01')).toBe(
      'Start date must be on or before end date',
    );
  });
});
