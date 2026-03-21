import type { AttemptConfig, AttemptResultType, FailureMode } from './types.js';

export type NextAction =
  | { kind: 'call'; attemptIndex: number; resume: boolean; prompt?: string }
  | { kind: 'validate_output'; attemptIndex: number }
  | { kind: 'fix_output'; attemptIndex: number; prompt: string }
  | { kind: 'done'; failed: boolean; failureMode: FailureMode };

export function nextAction(
  attempts: AttemptConfig[],
  attemptIndex: number,
  resultType: AttemptResultType,
  crashCount: number,
  maxCrashRetries: number,
  outputValid: boolean | null,
  outputFixAttempted: boolean
): NextAction {
  // Crash handling — checked first
  if (crashCount >= maxCrashRetries && maxCrashRetries > 0) {
    return { kind: 'done', failed: true, failureMode: 'crash' };
  }
  // Crash under limit — retry same attempt with session resume
  if (crashCount > 0 && crashCount < maxCrashRetries) {
    return { kind: 'call', attemptIndex, resume: true };
  }

  // Budget exhaustion — always done, never advance
  if (resultType === 'error_max_budget_usd') {
    return { kind: 'done', failed: true, failureMode: 'error_max_budget_usd' };
  }

  // Success path — output validation rules
  if (resultType === 'success') {
    if (outputValid === null) {
      return { kind: 'validate_output', attemptIndex };
    }
    if (outputValid === false && !outputFixAttempted) {
      return { kind: 'fix_output', attemptIndex, prompt: '' };
    }
    if (outputValid === false && outputFixAttempted) {
      return { kind: 'done', failed: false, failureMode: 'success' };
    }
    return { kind: 'done', failed: false, failureMode: 'success' };
  }

  // error_during_execution + fix already attempted → done (accept)
  if (resultType === 'error_during_execution' && outputFixAttempted) {
    return { kind: 'done', failed: false, failureMode: 'error_during_execution' };
  }

  // error_max_turns or error_during_execution — advance if more attempts
  const nextIdx = attemptIndex + 1;
  if (nextIdx < attempts.length) {
    const nextAttempt = attempts[nextIdx];
    return {
      kind: 'call',
      attemptIndex: nextIdx,
      resume: nextAttempt.resumePrevious,
      prompt: nextAttempt.wrapUpPrompt,
    };
  }

  // No more attempts
  return { kind: 'done', failed: true, failureMode: resultType };
}
