import { describe, it, expect } from 'vitest';
import {
  validateTaskName,
  validateDuration,
  validateEndDate,
  validateStartDate,
} from '../taskFieldValidation';

describe('validateTaskName', () => {
  it('rejects empty string', () => {
    expect(validateTaskName('')).not.toBeNull();
  });

  it('rejects whitespace-only string', () => {
    expect(validateTaskName('   ')).not.toBeNull();
  });

  it('accepts valid task name', () => {
    expect(validateTaskName('My Task')).toBeNull();
  });

  it('accepts name with surrounding whitespace (trim check)', () => {
    expect(validateTaskName('  Task  ')).toBeNull();
  });
});

describe('validateDuration', () => {
  it('rejects zero duration', () => {
    expect(validateDuration('0')).not.toBeNull();
  });

  it('rejects negative duration', () => {
    expect(validateDuration('-5')).not.toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(validateDuration('abc')).not.toBeNull();
  });

  it('accepts minimum valid duration of 1', () => {
    expect(validateDuration('1')).toBeNull();
  });

  it('accepts positive duration', () => {
    expect(validateDuration('10')).toBeNull();
  });
});

describe('validateEndDate', () => {
  it('rejects end date before start date', () => {
    expect(validateEndDate('2025-03-10', '2025-03-05')).not.toBeNull();
  });

  it('accepts end date equal to start date', () => {
    // 2025-03-10 is Monday — weekday OK
    expect(validateEndDate('2025-03-10', '2025-03-10')).toBeNull();
  });

  it('accepts end date after start date', () => {
    // 2025-03-20 is Thursday — weekday OK
    expect(validateEndDate('2025-03-10', '2025-03-20')).toBeNull();
  });

  it('rejects end date that is a Saturday', () => {
    // 2026-03-07 is Saturday
    expect(validateEndDate('2026-03-02', '2026-03-07')).not.toBeNull();
  });

  it('rejects end date that is a Sunday', () => {
    // 2026-03-08 is Sunday
    expect(validateEndDate('2026-03-02', '2026-03-08')).not.toBeNull();
  });
});

describe('validateStartDate', () => {
  it('rejects start date that is a Saturday', () => {
    // 2026-03-07 is Saturday
    expect(validateStartDate('2026-03-07', '2026-03-20')).not.toBeNull();
  });

  it('rejects start date that is a Sunday', () => {
    // 2026-03-08 is Sunday
    expect(validateStartDate('2026-03-08', '2026-03-20')).not.toBeNull();
  });

  it('rejects start date after end date', () => {
    expect(validateStartDate('2026-03-20', '2026-03-10')).not.toBeNull();
  });

  it('accepts valid start date before end date', () => {
    // 2026-03-09 is Monday
    expect(validateStartDate('2026-03-09', '2026-03-20')).toBeNull();
  });

  it('accepts start date equal to end date on a weekday', () => {
    // 2026-03-09 is Monday
    expect(validateStartDate('2026-03-09', '2026-03-09')).toBeNull();
  });
});
