// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createPolicyRegistry } from '../policy-registry.js';
import type { PolicyDefinition, AttemptContext } from '../types.js';

describe('policy-registry', () => {
  let registry: ReturnType<typeof createPolicyRegistry>;

  const testPolicy: PolicyDefinition = {
    attempts: [{ maxTurns: 80, model: 'sonnet', resumePrevious: false }],
  };

  beforeEach(() => {
    registry = createPolicyRegistry();
  });

  it('registerPolicy succeeds', () => {
    expect(() => registry.registerPolicy('test', testPolicy)).not.toThrow();
  });

  it('registerPolicy throws on duplicate', () => {
    registry.registerPolicy('test', testPolicy);
    expect(() => registry.registerPolicy('test', testPolicy)).toThrow(
      'Policy "test" is already registered'
    );
  });

  it('getPolicy returns a copy (mutating does not affect template)', () => {
    registry.registerPolicy('test', testPolicy);
    const copy = registry.getPolicy('test');
    copy.attempts[0].maxTurns = 999;
    const fresh = registry.getPolicy('test');
    expect(fresh.attempts[0].maxTurns).toBe(80);
  });

  it('getPolicy throws with helpful message for unknown policy', () => {
    registry.registerPolicy('foo', testPolicy);
    expect(() => registry.getPolicy('bar')).toThrow('Unknown policy: "bar". Available: foo');
  });

  it('listPolicies returns all names', () => {
    registry.registerPolicy('a', testPolicy);
    registry.registerPolicy('b', testPolicy);
    expect(registry.listPolicies()).toEqual(['a', 'b']);
  });

  it('applyOverrides mutates attempt 1', () => {
    registry.registerPolicy('test', testPolicy);
    const policy = registry.getPolicy('test');
    registry.applyOverrides(policy, { maxTurns: 50, model: 'opus' });
    expect(policy.attempts[0].maxTurns).toBe(50);
    expect(policy.attempts[0].model).toBe('opus');
  });

  it('applyOverrides no-op on undefined overrides', () => {
    registry.registerPolicy('test', testPolicy);
    const policy = registry.getPolicy('test');
    registry.applyOverrides(policy, {});
    expect(policy.attempts[0].maxTurns).toBe(80);
    expect(policy.attempts[0].model).toBe('sonnet');
  });

  it('applyOverrides no-op on empty attempts', () => {
    const emptyPolicy: PolicyDefinition = { attempts: [] };
    registry.registerPolicy('empty', emptyPolicy);
    const policy = registry.getPolicy('empty');
    expect(() => registry.applyOverrides(policy, { maxTurns: 10 })).not.toThrow();
  });

  it('function references survive copy (onAttemptComplete, isValid)', () => {
    const hook = (_ctx: AttemptContext) => {};
    const validator = (_output: string | null) => true;
    const policyWithFns: PolicyDefinition = {
      attempts: [{ maxTurns: 10, model: 'sonnet', resumePrevious: false }],
      onAttemptComplete: hook,
      outputValidation: { isValid: validator, fixPrompt: 'fix' },
    };
    registry.registerPolicy('fns', policyWithFns);
    const copy = registry.getPolicy('fns');
    expect(copy.onAttemptComplete).toBe(hook);
    expect(copy.outputValidation!.isValid).toBe(validator);
  });

  it('createPolicyRegistry returns isolated instance', () => {
    const r1 = createPolicyRegistry();
    const r2 = createPolicyRegistry();
    r1.registerPolicy('only-in-r1', testPolicy);
    expect(r1.listPolicies()).toContain('only-in-r1');
    expect(r2.listPolicies()).not.toContain('only-in-r1');
  });
});
