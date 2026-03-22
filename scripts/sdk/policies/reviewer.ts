import { registerPolicy } from '../policy-registry.js';
import type { OutputValidation, PolicyDefinition } from '../types.js';

// ── Prompts ──────────────────────────────────────────────────────────

const WRAP_UP = `You ran out of turns before writing your report.

Write your findings report NOW in the required format. You have 5 turns.

Rules:
- Use ONLY the evidence you already gathered — do NOT investigate further.
- Classify unverified claims as "keep" with evidence level "reasoning".
- Include every finding you have, even if incomplete.
- A partial report with real findings is valuable. No report is not.

Output the report immediately.`;

const SYNTHESIZE = `Reformat the following partial findings into the
required Skill Review report format.

The original reviewer ran out of turns. Extract whatever findings,
classifications, and evidence exist in the text below and produce a
well-formed report table.

If findings lack evidence levels, mark them as "reasoning".
If classifications are unclear, default to "keep".

## Raw findings to reformat:

{OUTPUT}`;

const FORMAT_FIX = `Your output does not match the required report format.

The report MUST contain:
1. A header: "## Skill Review: {skill} — {angle}"
2. At least one findings table with columns:
   | # | Claim | Classification | Evidence | Evidence level |

Rewrite your findings in the correct format. Do not re-investigate.`;

// ── Output validation ────────────────────────────────────────────────

export function isValid(output: string | null): boolean {
  if (!output) return false;

  const lines = output.split('\n');
  let foundHeader = false;
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (!foundHeader && /^##\s+skill\s+review:/i.test(line)) {
      foundHeader = true;
      continue;
    }

    if (foundHeader && /^\|.+\|.+\|/.test(line)) {
      return true;
    }
  }

  return false;
}

export const reviewerValidation: OutputValidation = {
  isValid,
  fixPrompt: FORMAT_FIX,
};

// ── Registration ─────────────────────────────────────────────────────

export const reviewerPolicy: PolicyDefinition = {
  attempts: [
    { maxTurns: 30, model: 'sonnet', resumePrevious: false },
    {
      maxTurns: 5,
      model: 'sonnet',
      resumePrevious: true,
      wrapUpPrompt: WRAP_UP,
    },
    {
      maxTurns: 5,
      model: 'haiku',
      resumePrevious: false,
      wrapUpPrompt: SYNTHESIZE,
      effort: 'low',
    },
  ],
  outputValidation: reviewerValidation,
};

registerPolicy('reviewer', reviewerPolicy);
