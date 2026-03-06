/** Pure, framework-agnostic validation functions for task fields. */

/**
 * Validates a task name. Trims whitespace before checking.
 * Returns an error message string or null if valid.
 */
export function validateTaskName(name: string): string | null {
  if (name.trim() === '') return 'Name cannot be empty';
  return null;
}

/**
 * Validates a duration value (string representation of a number).
 * Returns an error message string or null if valid.
 */
export function validateDuration(value: string): string | null {
  const n = parseInt(value, 10);
  if (isNaN(n)) return 'Duration must be a number';
  if (n < 1) return 'Duration must be at least 1 day';
  return null;
}

/**
 * Validates that endDate is on or after startDate.
 * Dates should be ISO strings (yyyy-MM-dd).
 * Returns an error message string or null if valid.
 */
export function validateEndDate(startDate: string, endDate: string): string | null {
  if (endDate < startDate) return 'End date must be on or after start date';
  return null;
}
