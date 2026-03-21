// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { nextAction } from '../attempt-machine.js';
import type { AttemptConfig, AttemptResultType } from '../types.js';

const single: AttemptConfig[] = [{ maxTurns: 80, model: 'sonnet', resumePrevious: false }];

const triple: AttemptConfig[] = [
  { maxTurns: 30, model: 'sonnet', resumePrevious: false },
  { maxTurns: 5, model: 'sonnet', resumePrevious: true, wrapUpPrompt: 'WRAP' },
  { maxTurns: 5, model: 'haiku', resumePrevious: false, wrapUpPrompt: 'SYNTH', effort: 'low' },
];

describe('nextAction — 3-attempt policy', () => {
  it('attempt 1 success, no validation → done', () => {
    const result = nextAction(triple, 0, 'success', 0, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: false, failureMode: 'success' });
  });

  it('attempt 1 success, validation present → validate_output', () => {
    const result = nextAction(triple, 0, 'success', 0, 2, null, false);
    expect(result).toEqual({ kind: 'validate_output', attemptIndex: 0 });
  });

  it('re-enter with outputValid: true → done', () => {
    const result = nextAction(triple, 0, 'success', 0, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: false, failureMode: 'success' });
  });

  it('re-enter with outputValid: false, no fix → fix_output', () => {
    const result = nextAction(triple, 0, 'success', 0, 2, false, false);
    expect(result).toEqual({ kind: 'fix_output', attemptIndex: 0, prompt: '' });
  });

  it('re-enter with outputValid: false, fix attempted → done (accept)', () => {
    const result = nextAction(triple, 0, 'success', 0, 2, false, true);
    expect(result).toEqual({ kind: 'done', failed: false, failureMode: 'success' });
  });

  it('attempt 1 error_max_turns → call attemptIndex 1 (resume)', () => {
    const result = nextAction(triple, 0, 'error_max_turns', 0, 2, true, false);
    expect(result).toEqual({
      kind: 'call',
      attemptIndex: 1,
      resume: true,
      prompt: 'WRAP',
    });
  });

  it('attempt 1 error_during_execution → call attemptIndex 1', () => {
    const result = nextAction(triple, 0, 'error_during_execution', 0, 2, true, false);
    expect(result).toEqual({
      kind: 'call',
      attemptIndex: 1,
      resume: true,
      prompt: 'WRAP',
    });
  });

  it('attempt 2 error_max_turns → call attemptIndex 2 (fresh)', () => {
    const result = nextAction(triple, 1, 'error_max_turns', 0, 2, true, false);
    expect(result).toEqual({
      kind: 'call',
      attemptIndex: 2,
      resume: false,
      prompt: 'SYNTH',
    });
  });

  it('attempt 3 error_max_turns → done (failed)', () => {
    const result = nextAction(triple, 2, 'error_max_turns', 0, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: true, failureMode: 'error_max_turns' });
  });

  it('ANY attempt error_max_budget_usd → done (never advances)', () => {
    for (let idx = 0; idx < 3; idx++) {
      const result = nextAction(triple, idx, 'error_max_budget_usd', 0, 2, true, false);
      expect(result).toEqual({
        kind: 'done',
        failed: true,
        failureMode: 'error_max_budget_usd',
      });
    }
  });
});

describe('nextAction — single-attempt policy', () => {
  it('success → done', () => {
    const result = nextAction(single, 0, 'success', 0, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: false, failureMode: 'success' });
  });

  it('error_max_turns → done (no fallback)', () => {
    const result = nextAction(single, 0, 'error_max_turns', 0, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: true, failureMode: 'error_max_turns' });
  });

  it('error_during_execution → done (no fallback)', () => {
    const result = nextAction(single, 0, 'error_during_execution', 0, 2, true, false);
    expect(result).toEqual({
      kind: 'done',
      failed: true,
      failureMode: 'error_during_execution',
    });
  });
});

describe('nextAction — crash handling', () => {
  it('below maxCrashRetries retries same attempt', () => {
    const result = nextAction(triple, 0, 'success', 1, 2, true, false);
    expect(result.kind).toBe('call');
    expect((result as { attemptIndex: number }).attemptIndex).toBe(0);
    expect((result as { resume: boolean }).resume).toBe(true);
  });

  it('at maxCrashRetries → done (crash)', () => {
    const result = nextAction(triple, 0, 'success', 2, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: true, failureMode: 'crash' });
  });

  it('above maxCrashRetries → done (crash)', () => {
    const result = nextAction(triple, 0, 'success', 3, 2, true, false);
    expect(result).toEqual({ kind: 'done', failed: true, failureMode: 'crash' });
  });
});

describe('nextAction — error_during_execution + outputFixAttempted', () => {
  it('returns done (accept) without advancing', () => {
    const result = nextAction(triple, 0, 'error_during_execution', 0, 2, true, true);
    expect(result).toEqual({
      kind: 'done',
      failed: false,
      failureMode: 'error_during_execution',
    });
  });
});

describe('nextAction — property-based invariants', () => {
  const resultTypes: AttemptResultType[] = [
    'success',
    'error_max_turns',
    'error_max_budget_usd',
    'error_during_execution',
  ];

  it('error_max_budget_usd never advances attempt', () => {
    for (const config of [single, triple]) {
      for (let idx = 0; idx < config.length; idx++) {
        const result = nextAction(config, idx, 'error_max_budget_usd', 0, 2, true, false);
        expect(result.kind).toBe('done');
      }
    }
  });

  it('call count never exceeds totalAttempts', () => {
    for (const config of [single, triple]) {
      for (const rt of resultTypes) {
        for (let idx = 0; idx < config.length; idx++) {
          const result = nextAction(config, idx, rt, 0, 2, true, false);
          if (result.kind === 'call') {
            expect(result.attemptIndex).toBeLessThan(config.length);
          }
        }
      }
    }
  });

  it('resume flag matches attempt config', () => {
    for (const config of [single, triple]) {
      for (const rt of resultTypes) {
        for (let idx = 0; idx < config.length; idx++) {
          const result = nextAction(config, idx, rt, 0, 2, true, false);
          if (result.kind === 'call') {
            expect(result.resume).toBe(config[result.attemptIndex].resumePrevious);
          }
        }
      }
    }
  });
});
