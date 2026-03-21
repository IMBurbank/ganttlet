// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValid, reviewerPolicy } from '../policies/reviewer.js';
import { createPolicyRegistry } from '../policy-registry.js';

const fixturesDir = path.join(import.meta.dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
}

describe('isValid — fixture-based', () => {
  it('valid accuracy report → true', () => {
    expect(isValid(readFixture('valid-accuracy-report.md'))).toBe(true);
  });

  it('valid scope report → true', () => {
    expect(isValid(readFixture('valid-scope-report.md'))).toBe(true);
  });

  it('malformed report → false', () => {
    expect(isValid(readFixture('malformed-report.md'))).toBe(false);
  });

  it('no report output → false', () => {
    expect(isValid(readFixture('no-report-output.md'))).toBe(false);
  });

  it('null → false', () => {
    expect(isValid(null)).toBe(false);
  });

  it('empty string → false', () => {
    expect(isValid('')).toBe(false);
  });

  it('header inside code block → false', () => {
    const content =
      '```\n## Skill Review: test — accuracy\n| # | Claim | Classification | Evidence | Evidence level |\n```';
    expect(isValid(content)).toBe(false);
  });

  it('minimal valid (header + 1 row) → true', () => {
    const content = '## Skill Review: test — accuracy\n| 1 | claim | keep | evidence | source |';
    expect(isValid(content)).toBe(true);
  });

  it('case variations in header → true', () => {
    const content = '## skill review: Test — Accuracy\n| 1 | claim | keep | evidence | source |';
    expect(isValid(content)).toBe(true);
  });
});

describe('reviewer policy registration', () => {
  let registry: ReturnType<typeof createPolicyRegistry>;

  beforeEach(() => {
    registry = createPolicyRegistry();
    registry.registerPolicy('reviewer', reviewerPolicy);
  });

  it('resolves with 3 attempts', () => {
    const policy = registry.getPolicy('reviewer');
    expect(policy.attempts).toHaveLength(3);
  });

  it('has outputValidation defined', () => {
    const policy = registry.getPolicy('reviewer');
    expect(policy.outputValidation).toBeDefined();
    expect(policy.outputValidation!.isValid).toBe(isValid);
  });

  it('attempt 2 has wrapUpPrompt', () => {
    const policy = registry.getPolicy('reviewer');
    expect(policy.attempts[1].wrapUpPrompt).toBeTruthy();
  });

  it('attempt 3 has effort low', () => {
    const policy = registry.getPolicy('reviewer');
    expect(policy.attempts[2].effort).toBe('low');
  });
});
