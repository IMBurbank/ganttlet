import type { PolicyDefinition } from './types.js';

export function createPolicyRegistry() {
  const registry = new Map<string, PolicyDefinition>();

  function registerPolicy(name: string, policy: PolicyDefinition): void {
    if (registry.has(name)) {
      throw new Error(`Policy "${name}" is already registered`);
    }
    registry.set(name, policy);
  }

  function getPolicy(name: string): PolicyDefinition {
    const policy = registry.get(name);
    if (!policy) {
      const available = [...registry.keys()].join(', ');
      throw new Error(`Unknown policy: "${name}". Available: ${available}`);
    }
    return { ...policy, attempts: structuredClone(policy.attempts) };
  }

  function listPolicies(): string[] {
    return [...registry.keys()];
  }

  function applyOverrides(
    policy: PolicyDefinition,
    overrides: { maxTurns?: number; model?: string }
  ): void {
    if (policy.attempts.length === 0) return;
    if (overrides.maxTurns !== undefined) {
      policy.attempts[0].maxTurns = overrides.maxTurns;
    }
    if (overrides.model !== undefined) {
      policy.attempts[0].model = overrides.model;
    }
  }

  return { registerPolicy, getPolicy, listPolicies, applyOverrides };
}

const defaultRegistry = createPolicyRegistry();
export const registerPolicy = defaultRegistry.registerPolicy;
export const getPolicy = defaultRegistry.getPolicy;
export const listPolicies = defaultRegistry.listPolicies;
export const applyOverrides = defaultRegistry.applyOverrides;
