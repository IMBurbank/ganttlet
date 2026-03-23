import { registerPolicy } from '../policy-registry.js';
import type { PolicyDefinition } from '../types.js';

// ── Prompts ──────────────────────────────────────────────────────────

const WRAP_UP = `You ran out of turns before completing the curation.

You MUST complete now. You have 20 turns remaining.

If you have already scored and filtered findings:
- Write the rewritten skill file using Bash (cat with heredoc)
- Commit with a detailed message
- End your response with: CURATION_RESULT: COMMITTED <sha>

If you have not started writing:
- Write the skill file based on findings you've already scored
- Commit and report the result

If no changes are needed:
- End your response with: CURATION_RESULT: NO_CHANGES <reason>

Do NOT ask for permission. You have write access to .claude/skills/ via Bash.`;

// ── Validation ───────────────────────────────────────────────────────

const RESULT_PATTERN = /CURATION_RESULT:\s*(COMMITTED\s+[a-f0-9]+|NO_CHANGES\s+.+)/;

const FIX_PROMPT = `Your response must end with a result marker.

If you committed changes:
  CURATION_RESULT: COMMITTED <sha>

If no changes were needed:
  CURATION_RESULT: NO_CHANGES <reason>

Check git log for your commit SHA if you already committed.
If you haven't committed yet, do so now using Bash, then report the result.`;

// ── Policy ───────────────────────────────────────────────────────────

export const curatorPolicy: PolicyDefinition = {
  attempts: [
    { maxTurns: 80, model: 'sonnet', resumePrevious: false },
    { maxTurns: 20, model: 'sonnet', resumePrevious: true, wrapUpPrompt: WRAP_UP },
  ],
  outputValidation: {
    isValid: (output: string | null): boolean => {
      if (!output) return false;
      return RESULT_PATTERN.test(output);
    },
    fixPrompt: FIX_PROMPT,
  },
};

registerPolicy('curator', curatorPolicy);
