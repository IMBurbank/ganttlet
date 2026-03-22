import { registerPolicy } from '../policy-registry.js';
import type { PolicyDefinition } from '../types.js';

export const defaultPolicy: PolicyDefinition = {
  attempts: [{ maxTurns: 80, model: 'sonnet', resumePrevious: false }],
};

registerPolicy('default', defaultPolicy);
