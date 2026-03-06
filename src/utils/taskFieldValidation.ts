/**
 * Pure validation functions for task fields.
 * Each returns an error message string on failure, or null on success.
 */

export function validateTaskName(value: string): string | null {
  if (value.trim().length === 0) {
    return 'Task name cannot be empty';
  }
  return null;
}

export function validateDuration(value: string): string | null {
  const n = parseInt(value, 10);
  if (isNaN(n) || value.trim() === '') {
    return 'Duration must be a number';
  }
  if (n < 1) {
    return 'Duration must be at least 1 day';
  }
  return null;
}

export function validateEndDate(startDate: string, endDate: string): string | null {
  if (endDate < startDate) {
    return 'End date must be on or after start date';
  }
  return null;
}
