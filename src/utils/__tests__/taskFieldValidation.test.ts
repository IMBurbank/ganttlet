import { describe, it, expect } from 'vitest';
import { validateTaskName, validateDuration, validateEndDate } from '../taskFieldValidation';

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
    expect(validateEndDate('2025-03-10', '2025-03-10')).toBeNull();
  });

  it('accepts end date after start date', () => {
    expect(validateEndDate('2025-03-10', '2025-03-20')).toBeNull();
  });
});
