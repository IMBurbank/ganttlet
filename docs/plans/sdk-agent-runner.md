---
scope:
  modify:
    - scripts/sdk/**
    - scripts/lib/agent.sh
    - scripts/lib/config.sh
    - scripts/generate-retry-config.sh
    - scripts/lib/stage.sh
    - scripts/full-verify.sh
    - package.json
    - package-lock.json
    - tsconfig.sdk.json
    - docs/prompts/curation/curator.md
    - docs/prompts/curation/reviewer-template.md
    - docs/prompts/curation/skill-curation.yaml
    - .claude/skills/curation/SKILL.md
    - .claude/skills/multi-agent-orchestration/SKILL.md
    - docs/multi-agent-guide.md
  read_only:
    - scripts/lib/watch.sh
    - scripts/launch-phase.sh
    - scripts/lib/log.sh
    - .claude/agents/skill-reviewer.md
description: "Implement TypeScript SDK agent runner with policy registry, then restructure curation pipeline so reviewers run as first-class agents with 3-attempt fallback"
skip-plan-mode: true
---

# SDK Agent Runner + Curation Pipeline Restructure

Two deliverables:

**Part A (Steps 1-9):** A TypeScript agent runner using the Claude Agent SDK,
with an open policy registry, attempt-based fallback, and DI-testable architecture.
Replaces `claude -p` in `agent.sh`.

**Part B (Step 10):** Restructure the skill curation pipeline so reviewers are
first-class agents launched by the runner (with 3-attempt fallback), not
subagents spawned by the curator prompt. The curator reads reviewer output
from disk instead of using the Agent tool.

**FIRST**: Read `CLAUDE.md`, `.claude/skills/multi-agent-orchestration/SKILL.md`,
`scripts/lib/agent.sh`, `docs/prompts/curation/curator.md`, and
`.claude/agents/skill-reviewer.md` to understand the current system.

Do NOT enter plan mode. Execute sequentially. Commit after each logical step.

---

## Part A: SDK Agent Runner

## Step 1: Project Setup

### 1a: Dependencies

```bash
npm install @anthropic-ai/claude-agent-sdk tsx @types/node --save-dev
```

All devDependencies — not bundled with the frontend. `tsx` is required for
`npx tsx` to work reliably in CI and fresh clones without prompting for install.

**Commit both `package.json` AND `package-lock.json`** — the lock file is
essential for reproducible `npm ci` in fresh clones and containers. No
Dockerfile changes needed — these are standard project devDependencies
installed by `npm install` alongside existing deps (React, Vite, etc.).

### 1b: TypeScript config for scripts

The main `tsconfig.json` includes only `src/` and targets DOM. The runner needs
its own config targeting Node.

Create `tsconfig.sdk.json`:
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["scripts/sdk"]
}
```

### 1c: Vitest config

The current `vite.config.ts` has no explicit `test.include` — vitest uses its
default glob (`**/*.{test,spec}.{ts,tsx,...}`). The `scripts/sdk/` directory is
NOT in any exclude list, so vitest will pick up `scripts/sdk/__tests__/*.test.ts`
automatically via the default glob.

**Do NOT add an explicit `test.include` array.** Adding one would override the
default and risk silently dropping existing tests in `src/`. Instead, verify
after writing the tests that `npm test` discovers them. If the jsdom environment
causes issues for Node-only tests, add this to each SDK test file:
```typescript
// @vitest-environment node
```

### 1d: Directory structure

```
scripts/sdk/
  agent-runner.ts        # I/O layer: reads prompt, calls queryFn, writes output
  attempt-machine.ts     # Pure state machine: nextAction() decision logic
  policy-registry.ts     # Open policy registry: register, resolve, override
  prompts.ts             # stripFrontmatter() + prompt variable substitution
  metrics.ts             # Structured metrics (replaces log_agent_metrics)
  types.ts               # Core types
  policies/
    default.ts           # Default single-attempt policy
    reviewer.ts          # Reviewer 3-attempt fallback: prompts + validation
  __tests__/
    attempt-machine.test.ts   # 11b: pure state machine logic
    agent-runner.test.ts      # 11e: fake queryFn, contract tests
    policy-registry.test.ts   # 11c: register, resolve, override
    reviewer-policy.test.ts   # 11d: fixture-based validation
    cli.test.ts               # 11f: arg parsing edge cases
    prompts.test.ts           # 11g: frontmatter + variable substitution
    metrics.test.ts           # 11h: JSONL append, backward compat
    retry-context.test.ts     # 11i: buildRetryContext with git fixtures
    integration.test.ts       # 11j: bash↔TypeScript boundary
    fixtures/
      valid-accuracy-report.md
      valid-scope-report.md
      malformed-report.md
      no-report-output.md
```

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes (empty project, no errors)
- `npm install` succeeds, `@anthropic-ai/claude-agent-sdk` in `node_modules/`
- `npx tsc -b` (frontend) still passes — `scripts/sdk/` not pulled in
- Directory structure exists as specified

Commit: `feat: scaffold SDK agent runner with tsconfig and vitest integration`

---

## Step 2: Core Types

### 2a: types.ts

Types are generic. No policy-specific concepts (no "reviewer", no "report").

```typescript
// ── Generic agent result ─────────────────────────────────────────────

export interface AgentResult {
  group: string;
  phase: string;
  attempt: number;                // which attempt produced the result (1-indexed)
  totalAttempts: number;
  partial: boolean;               // true if result came from a fallback attempt
  failed: boolean;
  output: string | null;          // raw agent output (last successful text)
  sessionId: string | null;
  failureMode: FailureMode;
  totalCostUsd: number;           // cumulative spend across all attempts
}

export type FailureMode =
  | "success"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_during_execution"
  | "crash";

/** SDK result subtypes — excludes "crash" which is a thrown exception. */
export type AttemptResultType = Exclude<FailureMode, "crash">;

// ── Attempt configuration ────────────────────────────────────────────

export interface AttemptConfig {
  maxTurns: number;
  model: string;                   // alias ("sonnet", "haiku", "opus") or full ID
  resumePrevious: boolean;
  wrapUpPrompt?: string;          // prompt injected on resume (replaces original)
  effort?: "low" | "medium" | "high" | "max";  // reasoning effort (default: "high")
}

// ── Output validation ────────────────────────────────────────────────

export interface OutputValidation {
  isValid: (output: string | null) => boolean;
  fixPrompt: string;
}

// ── Attempt lifecycle hook ───────────────────────────────────────────

export interface AttemptContext {
  attemptIndex: number;
  config: AttemptConfig;
  resultType: FailureMode;
  output: string | null;
  sessionId: string | null;
  durationMs: number;
  costUsd: number;                // spend for this attempt
}

// ── Policy definition ────────────────────────────────────────────────

export interface PolicyDefinition {
  attempts: AttemptConfig[];
  outputValidation?: OutputValidation;
  onAttemptComplete?: (context: AttemptContext) => void | Promise<void>;
}

// ── Runner options ───────────────────────────────────────────────────

export interface RunnerOptions {
  group: string;
  phase: string;
  workdir: string;
  prompt: string;                 // path to prompt file (relative to workdir)
  logFile: string;
  policy: string;                 // resolved via registry
  maxTurns?: number;              // override attempt 1 maxTurns
  maxBudget?: number;             // USD budget (shared across all attempts)
  model?: string;                 // override attempt 1 model
  maxCrashRetries?: number;       // default: 2
  crashRetryDelayMs?: number;     // default: 1000, doubles each retry
  outputFile?: string;            // write AgentResult.output to this path
  promptVars?: Record<string, string>;  // {KEY: value} substituted in prompt
  agent?: string;                 // agent definition name (loaded via settingSources)
}

// ── Metrics ──────────────────────────────────────────────────────────

export interface AgentMetrics {
  // Backward-compatible fields
  timestamp: string;
  phase: string;
  group: string;
  duration_seconds: number;
  retries: number;
  exit_code: number;
  status: "success" | "failure";
  // New fields
  attempt: number;
  totalAttempts: number;
  failureMode: FailureMode;
  resumeCount: number;
  model: string;
  sessionId: string | null;
  policy: string;
  totalCostUsd: number;
}
```

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- All interfaces exported, no `any` types

Commit: `feat: add core types for SDK agent runner`

---

## Step 3: Policy Registry

### 3a: policy-registry.ts

Open registry via factory pattern. Policies self-register on import. No
closed union. Tests get isolated instances via `createPolicyRegistry()` — no
test-specific code in production builds (CLAUDE.md requirement).

```typescript
import type { PolicyDefinition, AttemptConfig } from "./types.js";

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
      const available = [...registry.keys()].join(", ");
      throw new Error(`Unknown policy: "${name}". Available: ${available}`);
    }
    // Shallow spread preserves function references (onAttemptComplete,
    // outputValidation.isValid). Only deep-clone the attempts array
    // so callers can mutate it without affecting the template.
    return { ...policy, attempts: structuredClone(policy.attempts) };
  }

  function listPolicies(): string[] {
    return [...registry.keys()];
  }

  function applyOverrides(
    policy: PolicyDefinition,
    overrides: { maxTurns?: number; model?: string },
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

// Module-level instance used by policies and the runner
const defaultRegistry = createPolicyRegistry();
export const { registerPolicy, getPolicy, listPolicies, applyOverrides } = defaultRegistry;
export { createPolicyRegistry };  // for test isolation
```

Note: `getPolicy` uses `{ ...policy, attempts: structuredClone(policy.attempts) }`
— NOT `structuredClone(policy)`. `structuredClone` throws on function values.
The shallow spread preserves `onAttemptComplete` and `outputValidation.isValid`
by reference, which is correct (they're stateless).

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- Smoke test: `import { registerPolicy, getPolicy } from "./policy-registry.js"`
  compiles — verify by running tsc

Commit: `feat: add open policy registry for agent runner`

---

## Step 4: Policies

### 4a: policies/default.ts

```typescript
import { registerPolicy } from "../policy-registry.js";
import type { PolicyDefinition } from "../types.js";

export const defaultPolicy: PolicyDefinition = {
  attempts: [
    { maxTurns: 80, model: "sonnet", resumePrevious: false },
  ],
};

registerPolicy("default", defaultPolicy);
```

### 4b: policies/reviewer.ts

Co-locates everything reviewer-specific: 3-attempt config, wrap-up prompts,
output validation, and registration.

```typescript
import { registerPolicy } from "../policy-registry.js";
import type { OutputValidation } from "../types.js";

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
  // Checks for:
  // - `## Skill Review:` header (case-insensitive)
  // - NOT inside a fenced code block
  // - At least one pipe-delimited table row after the header
  // Keep it simple — regex, not a markdown parser.
  /* ... */
}

export const reviewerValidation: OutputValidation = {
  isValid,
  fixPrompt: FORMAT_FIX,
};

// ── Registration ─────────────────────────────────────────────────────

export const reviewerPolicy: PolicyDefinition = {
  attempts: [
    { maxTurns: 30, model: "sonnet", resumePrevious: false },
    { maxTurns: 5,  model: "sonnet", resumePrevious: true,
      wrapUpPrompt: WRAP_UP },
    { maxTurns: 5,  model: "haiku",  resumePrevious: false,
      wrapUpPrompt: SYNTHESIZE, effort: "low" },
  ],
  outputValidation: reviewerValidation,
};

registerPolicy("reviewer", reviewerPolicy);
```

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- Both policies can be resolved: quick inline script that imports both,
  calls `getPolicy("default")` and `getPolicy("reviewer")`, asserts
  reviewer has 3 attempts with outputValidation defined

Commit: `feat: add default and reviewer policies for agent runner`

---

## Step 5: Prompts Utility

### 5a: prompts.ts

Two responsibilities: frontmatter stripping and prompt variable substitution.

```typescript
/**
 * Strip YAML frontmatter (---...---) from prompt file content.
 * Returns content after the closing --- delimiter.
 * If no frontmatter found, returns original content unchanged.
 */
export function stripFrontmatter(content: string): string { /* ... */ }

/**
 * Replace {KEY} placeholders in a prompt with values from a vars map.
 * Only replaces keys present in the map. Unmatched {KEY} patterns are
 * left as-is (they may be literal text or intended for runtime replacement
 * like {OUTPUT} in wrap-up prompts).
 *
 * Keys are case-sensitive. Values are inserted as-is (no escaping).
 */
export function substituteVars(
  content: string,
  vars: Record<string, string>,
): string { /* ... */ }
```

`substituteVars` is intentionally simple. Use `content.split('{' + key + '}').join(value)`
(no regex) to avoid regex injection if a key ever contains metacharacters.
It replaces `{SKILL}` with the value of `vars.SKILL`, etc. This is used for reviewer prompt templates where the
orchestration layer passes `--prompt-var SKILL=scheduling-engine --prompt-var
ANGLE=accuracy` and the template contains `{SKILL}` and `{ANGLE}`.

The runner applies substitution after stripping frontmatter: `stripFrontmatter`
→ `substituteVars` → pass to `queryFn`.

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- `substituteVars` does NOT match `${...}` or `$(...)` bash syntax —
  only `{KEY}` with no `$` prefix

Commit: `feat: add frontmatter stripping and variable substitution for agent runner`

---

## Step 6: Metrics

### 6a: metrics.ts

Replace the `log_agent_metrics` bash function with TypeScript. Write JSONL to
the metrics directory. Schema includes backward-compatible fields plus new
fields (attempt, totalAttempts, failureMode, resumeCount, model, sessionId,
policy).

```typescript
export function logMetrics(metrics: AgentMetrics): void { /* ... */ }
```

Append-only. Create parent directories if missing. Synchronous.

**Concurrent append note:** With 40 parallel processes, `fs.appendFileSync`
calls can interleave, producing occasional corrupted JSONL lines. This is
acceptable — metrics are non-critical and downstream tooling should skip
malformed lines. Per-process temp files with post-merge would eliminate the
risk but adds complexity beyond what's needed for diagnostics data.

**Metrics directory:** Respect the `LOG_METRICS_DIR` env var established by
`agent.sh` line 6 (`LOG_METRICS_DIR="${LOG_METRICS_DIR:-.claude/logs}"`).
The TypeScript equivalent: `process.env.LOG_METRICS_DIR ?? '.claude/logs'`.
Output file: `${metricsDir}/agent-metrics.jsonl`. This preserves backward
compatibility with existing metrics tooling that may override the directory.

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- Quick check: write a metrics entry to `/tmp/test-metrics.jsonl`, verify
  it's valid JSON per line and contains all AgentMetrics fields

Commit: `feat: add structured metrics for SDK agent runner`

---

## Step 7: Attempt State Machine

### 7a: attempt-machine.ts

Pure function, zero side effects, no SDK dependency.

```typescript
import type { AttemptConfig, AttemptResultType, FailureMode } from "./types.js";

export type NextAction =
  | { kind: "call"; attemptIndex: number; resume: boolean; prompt?: string }
  | { kind: "validate_output"; attemptIndex: number }
  | { kind: "fix_output"; attemptIndex: number; prompt: string }
  | { kind: "done"; failed: boolean; failureMode: FailureMode };

export function nextAction(
  attempts: AttemptConfig[],
  attemptIndex: number,
  resultType: AttemptResultType,
  crashCount: number,
  maxCrashRetries: number,
  outputValid: boolean | null,  // null = no validation configured
  outputFixAttempted: boolean,
): NextAction { /* ... */ }
```

Key rules:
- `error_max_budget_usd` → always `done` (budget is shared, no attempt advance)
- `error_max_turns` → advance attempt if more attempts exist, else `done`
- `error_during_execution` + `outputFixAttempted` → `done` (accept best output,
  same as crash-during-fix — the fix call failed, don't advance)
- `error_during_execution` + `!outputFixAttempted` → advance attempt
  (unrecoverable for that session)
Rules for `success` are evaluated in this order (precedence matters):
1. `outputValid === null` → `validate_output` (runner must call `isValid()`
   and re-enter `nextAction` with `outputValid: true/false`)
2. `outputValid === false` + `!outputFixAttempted` → `fix_output`
   The runner resumes the same session with the `fixPrompt` as the new user
   message (uses most recently captured `sessionId`). The result of this fix
   attempt is re-validated; if still invalid, the state machine returns
   `done` (accept the best output).
3. `outputValid === false` + `outputFixAttempted` → `done` (accept)
4. `outputValid === true` → `done`
- Crash handling: Crashes are thrown exceptions. The runner catches them,
  increments `crashCount`, and calls `nextAction` with the LAST non-crash
  `resultType` (or `"success"` if no prior result). `nextAction` checks
  `crashCount >= maxCrashRetries` FIRST — if exceeded, returns `done` with
  `failureMode: "crash"` regardless of `resultType`. If under the limit,
  returns `{ kind: "call", attemptIndex: current, resume: true }` to retry
  the same attempt. The `crashCount`/`maxCrashRetries` parameters are how
  crash decisions flow through the state machine — no separate `"crash"`
  `resultType` is needed.

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- `nextAction` is a pure function with no imports beyond `types.ts`

Commit: `feat: implement attempt state machine for agent runner`

---

## Step 8: Agent Runner

### 8a: agent-runner.ts

I/O layer with dependency injection:

```typescript
export type QueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;

export async function runAgent(
  options: RunnerOptions,
  queryFn: QueryFn,
): Promise<AgentResult> { /* ... */ }
```

**Key behaviors:**

1. Resolve policy from registry via `getPolicy(options.policy)`
2. Apply CLI overrides to attempt 1 via `applyOverrides()`
3. Determine `persistSession`: `true` if any attempt has `resumePrevious: true`
   OR if `policy.outputValidation` is defined (the `fix_output` flow resumes
   the session to send the correction prompt). `false` only when neither
   condition applies (single-attempt, no validation).
4. Read prompt file, strip frontmatter, substitute prompt vars
5. Iterate the `queryFn()` async generator, capturing `session_id` from the
   first `{ type: "system", subtype: "init" }` message and reading
   `total_cost_usd`, `subtype`, and output text from the `{ type: "result" }`
   message.
6. Enter attempt loop driven by `nextAction()`. The runner dispatches on
   `nextAction`'s return: `call` → invoke queryFn, `validate_output` → call
   `isValid()` and re-enter `nextAction` with `outputValid: true/false`,
   `fix_output` → resume session with fixPrompt, `done` → exit loop.
7. For each `call` action:
   - If the action has a `prompt` (wrapUpPrompt from attempt config), use it
     as the task prompt instead of the original. Run `substituteVars` on it
     with `{ OUTPUT: lastNonNullOutput ?? "" }` so the `{OUTPUT}` placeholder
     in SYNTHESIZE gets the most recent non-null output from any prior
     attempt (not just the immediately preceding one — if attempt 2
     produced no text, fall back to attempt 1's output).
   - If the action says `resume: true` AND a sessionId was captured, resume
     the previous session (the wrapUpPrompt becomes the new user message).
   - If the action says `resume: true` but no sessionId exists, start fresh
     with the wrapUpPrompt as the full task prompt.
   - Invoke `queryFn()` with:
   - `permissionMode: "bypassPermissions"`
   - `allowDangerouslySkipPermissions: true`
   - `settingSources: ["project"]`
   - `persistSession`: `true` when the policy has multi-attempt resume
     (`resumePrevious: true` on any attempt) OR has `outputValidation`
     defined (the `fix_output` flow resumes the session). `false` only
     when neither applies. Session resume requires the JSONL file on disk —
     each `query()` call spawns a separate subprocess, so there is no
     in-memory state to carry over. The JSONL files are written to
     `~/.claude/projects/<encoded-cwd>/` and accumulate across runs;
     consider periodic cleanup in long-running environments.
   - `cwd: options.workdir`
   - `agent: options.agent` (if set — loads agent definition as main thread)
   - `resume: sessionId` if action says `resume: true`
   - `maxTurns`, `model`, and `effort` from the attempt config
   - `maxBudgetUsd: remainingBudget` (see budget tracking below)

**Permissions parity with current system:** The current system uses a
three-layer approach to let curators edit `.claude/skills/**` files:

1. `--dangerously-skip-permissions` on the CLI (agent.sh line 106)
2. `permissions.allow` in `.claude/settings.json` with `Edit(.claude/skills/**)`,
   `Write(.claude/skills/**)` (settings.json lines 6-11)
3. **WATCH mode only**: a tmux watcher in `watch.sh` (lines 124-136) that
   monitors for the "edit its own settings" permission dialog and auto-sends
   "2" (allow for session). This was needed because `.claude/` has hardcoded
   Claude Code protection that `--dangerously-skip-permissions` doesn't fully
   bypass in interactive mode (commit c3ffcbc). The settings.json allowlist
   works in fresh sessions but not within the same interactive session.

**The SDK runner eliminates the need for layer 3.** The watcher exists because
interactive mode shows permission dialogs even with `--dangerously-skip-permissions`.
The SDK `query()` is non-interactive (programmatic, equivalent to pipe mode) —
there's no UI to present dialogs to. `permissionMode: "bypassPermissions"` +
`allowDangerouslySkipPermissions: true` fully bypasses all permission checks
in the SDK context. Additionally, `settingSources: ["project"]` loads the
settings.json allowlist (layer 2) and project hooks (guard binary, verify.sh).

This is a concrete improvement over the current system: one clean programmatic
flag replaces three fragile layers (CLI flag + JSON allowlist + tmux keystroke
automation). Reviewers remain read-only via `disallowedTools: Write, Edit` in
their agent definition, which the SDK enforces regardless of `bypassPermissions`.

**`bypassPermissions` inheritance:** This mode is inherited by all subagents
and cannot be overridden. Curators spawn scorers (haiku) and validators
(codebase-explorer, rust-scheduler, verify-and-diagnose) via the Agent tool —
those subagents will also run with `bypassPermissions`. This is acceptable
because scorers only read and produce text, and validators are already
`disallowedTools`-constrained by their agent definitions. Document this as a
known constraint: if a future subagent needs tighter permissions, the curator
must use `disallowedTools` in the agent definition (deny rules apply even
under `bypassPermissions`).

**WATCH mode is unaffected.** The WATCH code path (tmux-based interactive
sessions) is not touched by this change — it still uses `claude` interactive
mode with the watcher. The SDK runner only replaces the `-p` (pipe) code path
in `run_agent()` (guarded by `SDK_RUNNER=1`). The WATCH mode check in
`run_parallel_stage()` (stage.sh line 85) happens BEFORE `run_agent()`, so
SDK_RUNNER agents always run in pipe mode.

**maxTurns precedence — confirmed:** Query-level `maxTurns` overrides agent
definition `maxTurns`. The SDK docs state "Programmatic options always override
filesystem settings," and [anthropics/claude-code#32732](https://github.com/anthropics/claude-code/issues/32732)
confirms the model parameter follows the same rule (tool-call/query-level wins
over agent definition frontmatter). This means the reviewer policy's attempt 2
(`maxTurns: 5`) correctly caps the resumed session at 5 turns even though the
`skill-reviewer` agent definition has `maxTurns: 35`. The fallback model works
as designed: attempt 1 gets the full budget, attempts 2-3 get tight caps to
force structured output or graceful failure.

**Budget tracking across attempts:** The SDK's `maxBudgetUsd` is per-`query()`
call — it does not track cumulative spend across calls. The runner must track
spend manually:
- After each `query()` call, read `total_cost_usd` from the `result` message
- Subtract from `options.maxBudget` to get `remainingBudget`
- Pass `remainingBudget` as `maxBudgetUsd` to the next attempt
- If `remainingBudget <= 0`, return `done` with `error_max_budget_usd`
  (do not call `nextAction` — budget exhaustion is checked before the state machine)

Add `costUsd` to `AttemptContext` so `onAttemptComplete` hooks can observe
per-attempt spend. Add `totalCostUsd` to `AgentResult` for metrics.

8. Fire `onAttemptComplete` hook after each attempt (non-blocking, errors swallowed)
9. On crash: catch exception, increment crashCount, exponential backoff,
   call `nextAction()` which decides retry-vs-done (see state machine rules)
10. On final `done`: log metrics, write output file if `--output-file` set
11. Return `AgentResult`, write as JSON to stdout

**Output file writing:** When `options.outputFile` is set AND the agent
produced output (`AgentResult.output !== null`), write the text output (not
the full JSON) to that path. Create parent directories if needed. Do NOT
write the output file when the agent failed with no output — downstream
curators handle missing report files gracefully. This is how reviewers make
their reports available to downstream curators.

**Edge case handling:**
- **No result message from query():** If the async generator closes without
  yielding a `result`-type message, treat as a crash (increment crashCount).
  Output is `null`, sessionId is whatever was captured from `init`, costUsd
  is 0.
- **Prompt file missing:** Validate the prompt file exists before entering the
  attempt loop. If missing, return immediately with `failed: true`,
  `failureMode: "crash"`. Do NOT enter the crash retry loop — retrying a
  missing file is wasteful.
- **Crash during fix_output:** Treat like any other crash — increment
  crashCount and retry the fix call (not the original attempt). Set
  `outputFixAttempted: true` BEFORE calling `queryFn` for the fix, so that
  if the fix crashes and exhausts crash retries, the state machine returns
  `done` (accept best output) rather than re-entering the fix loop.
- **Output file mkdir failure:** Log a warning and continue — do not treat
  I/O errors on the output file as agent failures. The agent's work is done;
  the output file is a convenience for downstream consumers.

**Crash retry context:** On crash retry with `resume: true`, if a session ID
was captured, the SDK resumes the session (the agent gets its full prior
context). On crash retry with `resume: false` (no session captured), append
a retry context section to the prompt:

```typescript
export function buildRetryContext(workdir: string, previousOutput: string | null): string {
  // Read last 5 git commits from worktree
  // Read .agent-status.json if it exists
  // Include last 200 chars of previous output if available
  // Return formatted context string
}
```

This mirrors the bash `build_retry_context()` function but is simpler because
most crash retries will use session resume (which preserves full context).
The retry context is only needed when no session ID was captured (early crash).

**CLI entry point:**

```typescript
if (import.meta.url === `file://${process.argv[1]}`) {
  await import("./policies/default.js");
  await import("./policies/reviewer.js");

  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const opts = parseCliArgs(process.argv.slice(2));
  const result = await runAgent(opts, sdk.query);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.failed ? 1 : 0);
}
```

**CLI flags:**
- `--group` (required): group ID
- `--workdir` (required): absolute path to worktree
- `--prompt` (required): prompt file path, resolved relative to `--workdir`
- `--log` (required): log file path
- `--phase` (required): phase name for metrics
- `--policy` (default: `"default"`): policy name
- `--max-turns` (optional): override attempt 1 maxTurns
- `--max-budget` (optional): USD budget cap
- `--model` (optional): override attempt 1 model
- `--max-crash-retries` (optional, default: 2)
- `--crash-retry-delay` (optional, default: 1000): initial backoff ms
- `--output-file` (optional): write agent output text to this path
- `--prompt-var KEY=VALUE` (optional, repeatable): substitute `{KEY}` in prompt
- `--agent` (optional): agent definition name (loaded from `.claude/agents/` via settingSources)

**Exit criteria:**
- `npx tsc -p tsconfig.sdk.json --noEmit` passes
- `npx tsx scripts/sdk/agent-runner.ts --help` prints usage and exits 0
- All required flags documented in `--help` output
- `parseCliArgs` throws on missing required flags (quick manual test)

Commit: `feat: implement SDK agent runner with policy registry and DI`

---

## Step 9: Integration with agent.sh

### 9a: Update run_agent()

When `SDK_RUNNER=1`, call the TypeScript runner instead of `claude -p`.
The naming convention (from Step 10b) and runner invocation are shown here
as a unified block for readability — this is what `run_agent()` looks like
after both Part A and Part B are applied. **Commit boundary:** Step 9a
commits only the SDK_RUNNER gating, shared locals, generic prompt_vars
defaults, CLI arg building, and runner invocation. The reviewer angle
detection block (lines starting with `_REVIEW_ANGLES`) is committed in
Step 10 as part of the curation restructure.

```bash
if [[ "${SDK_RUNNER:-}" == "1" ]]; then

  # ── Shared locals ────────────────────────────────────────────────
  # These mirror the retry loop's locals but are defined here because
  # the SDK path skips the retry loop entirely.
  local max_turns="${MAX_TURNS:-$DEFAULT_MAX_TURNS}"
  local max_budget="${MAX_BUDGET:-$DEFAULT_MAX_BUDGET}"
  local prompt_file=""  # set by naming convention or fallback below
  local exit_code=0

  # ── Naming convention (Step 10b) ──────────────────────────────────
  # Prompt vars as an array — safe for values with spaces.
  local -a prompt_vars=("SKILL=${group}")
  [[ -n "${LOG_DIR:-}" ]] && prompt_vars+=("LOG_DIR=${LOG_DIR}")

  # Reviewer angle detection (angles defined as variable, not buried in regex)
  local -r _REVIEW_ANGLES="accuracy|structure|scope|history|adversarial"
  if [[ "$group" =~ ^(.+)-(${_REVIEW_ANGLES})$ ]]; then
    local skill="${BASH_REMATCH[1]}"
    local angle="${BASH_REMATCH[2]}"
    : "${SDK_POLICY:=reviewer}"
    : "${SDK_AGENT:=skill-reviewer}"
    : "${SDK_OUTPUT_FILE:=${LOG_DIR}/reviews/${skill}/${angle}.md}"
    prompt_vars=("SKILL=${skill}" "ANGLE=${angle}")
    [[ -n "${LOG_DIR:-}" ]] && prompt_vars+=("LOG_DIR=${LOG_DIR}")
    : "${prompt_file:=docs/prompts/curation/reviewer-template.md}"
  fi

  # ── Build CLI args (Step 9a) ──────────────────────────────────────
  local policy="${SDK_POLICY:-default}"
  local -a extra_args=()
  [[ -n "${SDK_OUTPUT_FILE:-}" ]] && extra_args+=(--output-file "$SDK_OUTPUT_FILE")
  [[ -n "${SDK_AGENT:-}" ]] && extra_args+=(--agent "$SDK_AGENT")

  for var in "${prompt_vars[@]}"; do
    extra_args+=(--prompt-var "$var")
  done

  # prompt_file: set by naming convention above, or falls back to per-group prompt.
  : "${prompt_file:=${PROMPTS_DIR}/${group}.md}"

  # ── Invoke runner ─────────────────────────────────────────────────
  local result
  set +e
  result=$(npx tsx scripts/sdk/agent-runner.ts \
    --group "$group" \
    --workdir "$workdir" \
    --prompt "$prompt_file" \
    --log "$logfile" \
    --phase "${PHASE:-unknown}" \
    --policy "$policy" \
    ${max_turns:+--max-turns "${max_turns}"} \
    ${max_budget:+--max-budget "${max_budget}"} \
    ${MAX_RETRIES:+--max-crash-retries "${MAX_RETRIES}"} \
    ${MODEL:+--model "${MODEL}"} \
    "${extra_args[@]}" \
    2>>"$logfile")
  exit_code=$?
  set -e

  if [[ $exit_code -eq 0 ]]; then
    ok "${group}: completed successfully"
    log "${group}: result: ${result}"
    return 0
  else
    err "${group}: failed. Result: ${result}"
    return 1
  fi
else
  # existing claude -p invocation with retry loop (unchanged)
  ...
fi
```

**Critical:** When `SDK_RUNNER=1`, the bash retry loop is SKIPPED entirely.
The TypeScript runner handles its own crash retries and attempt fallbacks.

**`monitor_agent` interaction:** Unchanged. The monitor watches the log file
for stalls. The runner writes to the same log file. Harmless.

Do NOT remove the existing `claude -p` code path.

**Preflight check update (`stage.sh`):** The `preflight_check()` function
(stage.sh lines 29-36) validates that `${PROMPTS_DIR}/${group}.md` exists
for every group. Reviewer groups use a shared template
(`reviewer-template.md`) resolved by the naming convention in `run_agent()`,
so per-group prompt files don't exist for them. When `SDK_RUNNER=1`, skip
the per-group prompt file check — the runner handles prompt resolution:

```bash
  # Skip per-group prompt check when SDK_RUNNER handles prompt resolution
  if [[ "${SDK_RUNNER:-}" != "1" ]]; then
    local prompts_exist=true
    for group in "$@"; do
      if [[ ! -f "${PROMPTS_DIR}/${group}.md" ]]; then
        err "Missing prompt file: ${PROMPTS_DIR}/${group}.md"
        prompts_exist=false
      fi
    done
    $prompts_exist || return 1
  fi
```

**Exit criteria:**
- `bash -n scripts/lib/agent.sh` passes (no syntax errors)
- `bash -n scripts/lib/stage.sh` passes (no syntax errors)
- The existing `claude -p` code path is unchanged and still reachable
  when `SDK_RUNNER` is unset
- Preflight passes with `SDK_RUNNER=1` even without per-group prompt files
- `max_turns`, `max_budget` defined before use in SDK path
- `shellcheck scripts/lib/agent.sh` passes (or only pre-existing warnings)

Commit: `feat: integrate SDK runner into agent.sh behind SDK_RUNNER flag`

### 9b: LOG_DIR env var override

Make `LOG_DIR` respect an existing env var so reruns can target the same
output directory as the original run. Two one-line changes:

**config.sh line 86-87** — update the comment and assignment:
```bash
# Derived values — run_suffix is stable across stage/merge/validate invocations.
# LOG_DIR respects env override for cross-run output sharing (see Step 9b).
LOG_DIR="${LOG_DIR:-/tmp/ganttlet-logs/${PHASE}-${run_suffix}}"
```

**generate-retry-config.sh line 20** — same pattern:
```bash
LOG_DIR="${LOG_DIR:-/tmp/ganttlet-logs/${PHASE}-${run_suffix}}"
```

Also add a line to generate-retry-config.sh output that prints the
original LOG_DIR for easy copy-paste:
```bash
echo "[retry] Original LOG_DIR: $LOG_DIR"
```

This enables curation reruns where failed reviewers write output to
the same directory as succeeded reviewers. Without this, the operator
would need to manually match `_LAUNCH_BASE_REF` and phase names.

**Exit criteria:**
- `bash -n scripts/lib/config.sh` passes
- `bash -n scripts/generate-retry-config.sh` passes
- Quick test: `LOG_DIR=/tmp/test-override source scripts/lib/config.sh`
  then `echo $LOG_DIR` → `/tmp/test-override` (not derived)
- Without LOG_DIR set, derives as before

Commit: `feat: allow LOG_DIR override for cross-run output sharing`

### 9c: Update orchestration docs for SDK runner

Update docs as the behavior changes — agents reading these docs mid-pipeline
must see accurate information, not stale descriptions of the old system.

**`docs/multi-agent-guide.md`** — Add a section after "Claude CLI Reference":

```markdown
## SDK Agent Runner

When `SDK_RUNNER=1` is set, `run_agent()` uses the TypeScript SDK runner
(`scripts/sdk/agent-runner.ts`) instead of `claude -p`. The runner provides:

- **Policy-based attempt fallback**: Configurable via `--policy`. The
  `reviewer` policy has 3 attempts (sonnet 30 turns → resume 5 turns →
  haiku fresh 5 turns). The `default` policy is single-attempt.
- **Output validation**: Policies can define `isValid()` checks. Invalid
  output triggers a fix attempt (resume with correction prompt) before
  advancing to the next attempt.
- **Cumulative budget tracking**: `--max-budget` is shared across all
  attempts. The runner tracks spend and passes remaining budget to each call.
- **Structured metrics**: JSONL with attempt count, failure mode, cost,
  session ID, policy name.

### CLI flags

`--group`, `--workdir`, `--prompt`, `--log`, `--phase` (required).
`--policy`, `--max-turns`, `--max-budget`, `--model`, `--agent`,
`--output-file`, `--prompt-var KEY=VALUE` (optional).

### Naming convention

Group IDs ending in a reviewer angle (`-accuracy`, `-structure`, `-scope`,
`-history`, `-adversarial`) automatically set `--policy reviewer`,
`--agent skill-reviewer`, and `--output-file` to the correct path. No
YAML changes needed — detection is in `run_agent()`.

### Existing `claude -p` path

Unchanged. When `SDK_RUNNER` is unset, `run_agent()` uses the existing
bash retry loop with `claude -p`. Both code paths coexist.
```

**`.claude/skills/multi-agent-orchestration/SKILL.md`** — Add an
"SDK Agent Runner" subsection under the agent execution section. Cover:
- `SDK_RUNNER=1` env var enables the TypeScript path
- Policy registry: `default` (single attempt) and `reviewer` (3-attempt fallback)
- Naming convention for reviewer angle detection
- `--agent` flag loads `.claude/agents/*.md` via `settingSources: ['project']`
- How it differs from `claude -p`: programmatic permissions, no tmux watcher
  needed, attempt-based fallback replaces bash retry loop

Keep additions concise — reference `docs/multi-agent-guide.md` for full details.

**Exit criteria:**
- `docs/multi-agent-guide.md` contains "SDK Agent Runner" section
- `.claude/skills/multi-agent-orchestration/SKILL.md` references SDK runner
- No references to "subagent spawning" for reviewers in updated sections

Commit: `docs: add SDK runner to orchestration guide and skill`

---

## Part B: Curation Pipeline Restructure

## Step 10: Move Reviewers to Orchestration Layer

Currently, the curator spawns 5 reviewers via the Agent tool (Claude Code
subagents). This means the SDK runner never touches reviewers — the 3-attempt
fallback policy can't apply. The curator has a prompt-level workaround
(Step 2b synthesis pass on `fix/orchestrator-prompts`).

This step moves reviewer spawning into the orchestration layer so each
reviewer runs as a first-class agent via the SDK runner with the `reviewer`
policy. The curator reads their output from disk.

### 10a: Reviewer prompt template

Create `docs/prompts/curation/reviewer-template.md`:

```markdown
---
description: "Skill reviewer — {ANGLE} angle for {SKILL}"
skip-plan-mode: true
---

Review angle: {ANGLE}

Target skill: .claude/skills/{SKILL}/SKILL.md

Feedback reports:
Run `find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" | sort | head -20`

Other skills (for cross-skill context):
Run `ls .claude/skills/*/SKILL.md`
```

That's the entire file. Only `{SKILL}` and `{ANGLE}` need prompt-var
substitution — the feedback/other-skills paths are discovered at runtime
by the reviewer agent executing the bash commands in its worktree. This
avoids quoting/escaping issues with multiline values in prompt vars and
ensures the reviewer sees the current state of the worktree.

The reviewer agent definition (`.claude/agents/skill-reviewer.md`) provides
the detailed instructions, angles, output format, and constraints.

**SDK agent definition loading — resolved:**

The SDK's `query()` has two relevant options:

- **`agent: string`** — names the agent definition to use as the main thread.
  The agent's `prompt` field becomes the system prompt; the `query()` `prompt`
  parameter becomes the task prompt. This is exactly the separation we need.
- **`agents: Record<string, AgentDefinition>`** — programmatic agent
  definitions, merged with filesystem agents from `settingSources`.
- **`settingSources: ['project']`** — loads `.claude/agents/*.md`,
  `.claude/settings.json`, `CLAUDE.md`, hooks, etc. from the `cwd`.

Two viable approaches:

1. **Filesystem agent + `agent` option (chosen):**
   `settingSources: ['project']` loads `.claude/agents/skill-reviewer.md`.
   `agent: 'skill-reviewer'` makes it the main thread agent. The reviewer
   template is the task prompt. The agent definition provides system
   instructions, output format, constraints, `disallowedTools`, `model`.

2. **Programmatic agent (not chosen):** Read `.md` at startup, parse
   frontmatter into `AgentDefinition`, pass via `agents` option. More
   control, more isolation from project settings, but unnecessary parsing.

We use approach 1 because reviewers SHOULD inherit project settings — they
need CLAUDE.md conventions, project hooks, and tool access. The agent
definition already exists at `.claude/agents/skill-reviewer.md` with the
right config (`maxTurns: 35`, `model: sonnet`, `disallowedTools`). No new
parsing code needed.

**Runner changes for `--agent` flag:**

Add `--agent` CLI flag to the runner. When set, pass `agent: name` in the
`query()` options. The reviewer naming convention sets it:

```bash
: "${SDK_AGENT:=skill-reviewer}"   # in the reviewer if-block
```

And the runner invocation adds:
```bash
[[ -n "${SDK_AGENT:-}" ]] && extra_args+=(--agent "$SDK_AGENT")
```

For non-reviewer agents, `--agent` is not set — they run as plain `query()`
calls with just the task prompt (current behavior for all phases).

### 10b: Two-stage YAML config

Update `docs/prompts/curation/skill-curation.yaml` to have two stages:
a review stage and a curate stage.

```yaml
phase: skill-curation
stages:
  # ── Stage 1: Review ──────────────────────────────────────────────
  # 5 reviewers per skill, all running in parallel (40 groups total).
  # Group IDs ending in an angle name trigger the reviewer convention
  # in run_agent(): policy=reviewer, output-file derived, template prompt.
  # Each reviewer gets a unique branch (git worktrees require it).
  - name: "Review"
    groups:
      # scheduling-engine (5 angles)
      # Each reviewer gets a unique branch — git worktrees require it.
      # Reviewers are read-only so these branches get no commits, but
      # setup_worktree() needs distinct branch names per group.
      - id: scheduling-engine-accuracy
        branch: curation/scheduling-engine-accuracy
      - id: scheduling-engine-structure
        branch: curation/scheduling-engine-structure
      - id: scheduling-engine-scope
        branch: curation/scheduling-engine-scope
      - id: scheduling-engine-history
        branch: curation/scheduling-engine-history
      - id: scheduling-engine-adversarial
        branch: curation/scheduling-engine-adversarial
      # hooks (5 angles)
      - id: hooks-accuracy
        branch: curation/hooks-accuracy
      - id: hooks-structure
        branch: curation/hooks-structure
      - id: hooks-scope
        branch: curation/hooks-scope
      - id: hooks-history
        branch: curation/hooks-history
      - id: hooks-adversarial
        branch: curation/hooks-adversarial
      # ... same pattern for remaining 6 skills
      # Convention: branch = curation/${group_id}
  # ── Stage 2: Curate ─────────────────────────────────────────────
  # 1 curator per skill. Reads reviewer output from disk.
  # Scores findings, validates, rewrites, commits.
  - name: "Curate"
    groups:
      - id: scheduling-engine
        branch: curation/scheduling-engine
        merge_message: "docs: curate scheduling-engine skill"
      - id: hooks
        branch: curation/hooks
        merge_message: "docs: curate hooks skill"
      # ... repeat for all 8 skills
```

**Config derivation via naming convention:** `config.sh` only parses `id`,
`branch`, and `merge_message` from YAML groups (the only change to config.sh
is the LOG_DIR override in Step 9b). The
reviewer-specific config (policy, output file, prompt vars) is derived from
the group ID pattern in `run_agent()` — see the unified code block in
**Step 9a** which shows both the naming convention and the runner invocation
together.

Design rationale for the naming convention:

- **Angles in a variable** (`_REVIEW_ANGLES`), not buried in a regex. One
  place to update when adding new angles.
- **All defaults overridable** via `: "${VAR:=default}"` — callers can set
  `SDK_POLICY`, `SDK_OUTPUT_FILE`, `prompt_file` before calling `run_agent()`
  to customize without touching the convention code.
- **Generic path is truly generic.** Every agent gets `SKILL=${group}` and
  `LOG_DIR`. No curation-specific behavior leaks into the generic path —
  `SKILL=deploy-staging` is harmless (unused if the prompt has no `{SKILL}`
  placeholder), and `LOG_DIR` is always useful for locating pipeline artifacts.
- **Reviewer detection overrides the defaults.** When the regex matches,
  `SKILL` is refined from the group ID to the extracted skill name, and
  angle-specific config is added.

The YAML config only needs standard fields (`id`, `branch`, `merge_message`).
No changes to `config.sh` or `stage.sh` required.

**Reviewer worktrees:** Each reviewer group gets its own branch
(`curation/${group_id}`, e.g. `curation/scheduling-engine-accuracy`).
Git worktrees require unique branch names — two worktrees cannot check out the
same branch simultaneously. Since reviewers are read-only these branches get
no commits; they exist solely to satisfy `setup_worktree()`. All branches
fork from `MERGE_TARGET` (which itself forks from `_LAUNCH_BASE_REF` — the
HEAD of wherever `launch-phase.sh` was invoked, never hardcoded to `main`).
Every reviewer sees identical code — the state of `MERGE_TARGET` at worktree
creation time.

**Review stage merge — skip it.** The review stage produces output files to
`LOG_DIR`, not git commits. The orchestrator simply doesn't invoke `merge:1`.
The pipeline supports this: `launch-phase.sh` can run individual steps
(`stage 1`, then `stage 2`, then `merge 2`, `validate`, `create-pr`) — it
doesn't have to run the full auto-generated pipeline sequence. The orchestrator
script (or the operator) calls:

```bash
launch-phase.sh config.yaml stage 1      # run 40 reviewers (output to LOG_DIR)
launch-phase.sh config.yaml stage 2      # run 8 curators (read from LOG_DIR, commit to branches)
launch-phase.sh config.yaml merge 2      # merge curator branches
launch-phase.sh config.yaml validate     # verify merged result
launch-phase.sh config.yaml create-pr    # open PR
```

No merge step for the review stage. No empty-branch edge cases to handle.

**LOG_DIR flow between stages:** `LOG_DIR` is set once by `config.sh` when
`launch-phase.sh` loads its config. All steps invoked in the same
`launch-phase.sh` process share the same `LOG_DIR` (it's a shell variable
that persists across function calls). This means:
- **`all` mode** (full pipeline): `LOG_DIR` is set once and flows from
  stage 1 → stage 2 → merge → validate → create-pr automatically.
- **Individual steps** (`stage 1`, then `stage 2` separately): Each
  invocation of `launch-phase.sh` re-derives `LOG_DIR` from
  `PHASE + run_suffix`. To ensure stage 2 reads from stage 1's output,
  either: (a) use the same `_LAUNCH_BASE_REF` (which produces the same
  `run_suffix` and thus the same `LOG_DIR`), or (b) export `LOG_DIR`
  explicitly: `LOG_DIR=/tmp/ganttlet-logs/skill-curation-a1b2c3d4
  launch-phase.sh config.yaml stage 2`.
- **The LOG_DIR override (Step 9b)** makes option (b) work — `config.sh`
  respects an existing `LOG_DIR` env var instead of deriving a new one.

### 10c: Simplified curator prompt

Update `docs/prompts/curation/curator.md`. The curator no longer spawns
reviewers or does synthesis. It reads their output from disk.

Key changes:
- **Remove** Step 2 (spawn 5 reviewers via Agent tool)
- **Remove** Step 2b (report synthesis pass)
- **Remove** any orphaned reviewer-context text (e.g. "For the scope
  reviewer, list other skill paths" in Step 2 — reviewers now discover
  this themselves via bash commands in their worktree)
- **Replace** with: "Read reviewer reports from `{LOG_DIR}/reviews/{SKILL}/`"
- **Step 3 (Score)** becomes Step 2
- **Step 4 (Filter)** becomes Step 3
- **Step 5 (Rewrite)** becomes Step 4
- **Step 6 (Commit)** becomes Step 5
- **Step 7 (Debrief)** becomes Step 6

New Step 1:

```markdown
## Step 1: Context

**Your target skill** is specified in the wrapper prompt that launched you.

Read:
- `.claude/skills/{SKILL}/SKILL.md` — your target
- `docs/prompts/curation/threshold.txt` — the scoring threshold
- Feedback reports: `find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" | sort | head -20`

**Reviewer reports** (produced by the review stage — do NOT spawn reviewers):
```bash
ls {LOG_DIR}/reviews/{SKILL}/
```

Read all 5 reviewer reports. Each contains a structured findings table with
claims, classifications, evidence, and evidence levels. If any report file
is missing, note it in your debrief and proceed with the reports you have.

For each finding across all reports, proceed to scoring.
```

The curator still uses the Agent tool for **scorers** (haiku, no subagent_type)
and **validators** (codebase-explorer, rust-scheduler, verify-and-diagnose).
Only reviewer spawning moves to the orchestration layer — scorers and
validators are lightweight, don't have truncation issues, and don't need
fallback policies.

**Note on the non-SDK path:** The curator prompt changes (removing Step 2
reviewer spawning) apply regardless of `SDK_RUNNER`. The old single-stage
YAML with curator-spawned reviewers is replaced by the two-stage YAML.
Without `SDK_RUNNER=1`, reviewers still run via `claude -p` with the default
policy (single attempt, no fallback). This means the 3-attempt fallback
that replaces the curator's Step 2b synthesis pass is only active with
`SDK_RUNNER=1`. For the non-SDK path, reviewers that hit max turns will
produce partial output with no synthesis recovery. This is an accepted
tradeoff — the SDK runner is the intended path forward, and the `claude -p`
path is preserved for backward compatibility, not feature parity.

**{SKILL} and {LOG_DIR} substitution:** The curator prompt uses `{SKILL}` and
`{LOG_DIR}`. These are supplied automatically by the generic defaults in the
naming convention — every SDK_RUNNER agent gets `SKILL=${group}` and
`LOG_DIR=${LOG_DIR}`. No special YAML fields or caller-side setup needed.

### 10d: Reviewer template only needs {SKILL} and {ANGLE}

Feedback reports and other-skills paths are discovered at runtime by the
reviewer agent executing bash commands in its worktree (see template above).
This avoids quoting/escaping issues with multiline prompt vars and ensures
the reviewer sees the current state. Only `{SKILL}` and `{ANGLE}` need
substitution via `--prompt-var`.

**Exit criteria:**
- `reviewer-template.md` exists, contains only `{SKILL}` and `{ANGLE}`
  placeholders (no `{FEEDBACK_PATHS}`, `{OTHER_SKILLS}`, or `{LOG_DIR}`)
- `skill-curation.yaml` parses with `yq`: `yq '.stages | length' < yaml` → 2
- Stage 1 has 40 groups (8 skills × 5 angles), stage 2 has 8 groups
- Each stage-1 group ID matches `^.+-(accuracy|structure|scope|history|adversarial)$`
- Each stage-1 branch is unique
- Curator prompt no longer references Agent tool for reviewers
- Curator prompt reads from `{LOG_DIR}/reviews/{SKILL}/`

Commit: `feat: restructure curation pipeline — reviewers as first-class agents`

### 10e: Update curation skill docs

The curation SKILL.md must reflect the new pipeline architecture immediately
so any agent reading it during or after this work sees the correct flow.

**`.claude/skills/curation/SKILL.md`** — Update the following sections:

1. **Pipeline flow diagram**: Change from
   `Orchestrator → curators → 5 skill-review subagents`
   to
   `Orchestrator → Stage 1: 40 reviewers (SDK runner, reviewer policy) →
   Stage 2: 8 curators (read reviewer output from disk)`

2. **How reviewers run**: Remove references to "subagent spawned by curator
   via Agent tool". Replace with: "Reviewers are first-class agents launched
   by `launch-phase.sh` stage 1 via the SDK runner with `--policy reviewer`
   and `--agent skill-reviewer`. Each reviewer gets its own worktree and
   writes output to `${LOG_DIR}/reviews/${skill}/${angle}.md`."

3. **3-attempt fallback**: Add description of the reviewer policy's attempt
   sequence (sonnet 30 turns → resume wrap-up 5 turns → haiku synthesize 5
   turns). This replaces the curator's prompt-level synthesis workaround.

4. **Curator changes**: Note that curators now read reviewer reports from
   disk (`{LOG_DIR}/reviews/{SKILL}/`) instead of spawning reviewers. They
   still spawn scorers (haiku) and validators via the Agent tool.

5. **Two-stage YAML**: Note that `skill-curation.yaml` now has two stages:
   Review (40 groups) and Curate (8 groups). The review stage has no merge
   step — output goes to `LOG_DIR`, not git commits.

6. **File layout**: Add `reviewer-template.md` to the file listing.

Do NOT rewrite sections unrelated to this change. Keep edits surgical.

**Exit criteria:**
- Curation SKILL.md pipeline flow matches the two-stage architecture
- No references to "curator spawns reviewers" or "Agent tool for reviewers"
- `reviewer-template.md` listed in file layout
- SDK runner / reviewer policy mentioned

Commit: `docs: update curation skill for two-stage reviewer pipeline`

---

## Step 11: Tests

### 11a: Fixtures

Create `scripts/sdk/__tests__/fixtures/` with real report examples from
`.claude/agents/skill-reviewer.md` (lines 158-193, the Output Format section):

- `valid-accuracy-report.md` — complete report with header + findings table
- `valid-scope-report.md` — includes cross-skill observations
- `malformed-report.md` — findings text but missing required header/table
- `no-report-output.md` — investigation notes without any report

### 11b: attempt-machine.test.ts — Pure Logic

```typescript
// @vitest-environment node
```

**State transitions (3-attempt):**
- Attempt 1 success, no validation → done
- Attempt 1 success, validation present → validate_output
- Re-enter with outputValid: true → done (success)
- Re-enter with outputValid: false, no fix attempted → fix_output
- Re-enter with outputValid: false, fix attempted → done (accept)
- Attempt 1 error_max_turns → call attemptIndex 1 (resume)
- Attempt 1 error_during_execution → call attemptIndex 1 (advance)
- Attempt 2 error_max_turns → call attemptIndex 2 (fresh)
- Attempt 3 error_max_turns → done (failed)
- ANY attempt error_max_budget_usd → done (never advances)

**State transitions (single-attempt):**
- Success → done
- error_max_turns → done (no fallback)
- error_during_execution → done (no fallback)

**Crash handling:**
- < maxCrashRetries → retry same attempt
- >= maxCrashRetries → done (crash)

**Property-based invariants** (exhaustive input generation, no library needed):
- error_max_budget_usd never advances attempt (all configs × all result types)
- Call count never exceeds totalAttempts
- Resume flag matches attempt config

Use raw `AttemptConfig[]` arrays, NOT registered policies.

### 11c: policy-registry.test.ts

- `registerPolicy` succeeds / throws on duplicate
- `getPolicy` returns copy (mutating doesn't affect template)
- `getPolicy` throws with helpful message for unknown policy
- `listPolicies` returns all names
- `applyOverrides` mutates attempt 1 / no-op on undefined / empty
- Function references survive copy (onAttemptComplete, isValid)
- `createPolicyRegistry` returns isolated instance (no cross-test leakage)

### 11d: reviewer-policy.test.ts — Fixture-Based

Import `isValid` from `policies/reviewer.ts`. Test with fixtures:
- valid reports → true
- malformed/missing → false
- null/empty → false
- header in code block → false
- minimal valid (header + 1 row) → true
- case variations → true

Also verify registration: `getPolicy("reviewer")` returns 3 attempts,
outputValidation defined, attempt 2 wrapUpPrompt non-empty.

### 11e: agent-runner.test.ts — Fake queryFn

```typescript
// @vitest-environment node

function fakeQuery(responses: FakeResponse[]) {
  let callIndex = 0;
  const calls: Array<Record<string, unknown>> = [];
  const fn = async function* (opts: Record<string, unknown>) {
    calls.push(opts);
    const idx = callIndex;
    const response = responses[callIndex++];
    if (response.throw) throw response.throw;
    const sid = response.sessionId ?? `sess-${idx}`;
    yield { type: "system", subtype: "init", session_id: sid };
    yield { type: "result", subtype: response.subtype, result: response.result,
            total_cost_usd: response.costUsd ?? 0, session_id: sid };
  };
  return { queryFn: fn as unknown as QueryFn, calls };
}
```

**Contract tests:** queryFn called with correct permissionMode, cwd,
settingSources, maxTurns, resume, model, agent for each attempt.
Specific assertions:
- `permissionMode` always `"bypassPermissions"`
- `allowDangerouslySkipPermissions` always `true`
- `settingSources` always `["project"]`
- `cwd` equals `options.workdir`
- `agent` forwarded when `options.agent` is set, absent when not
- `maxTurns` matches the attempt config (not the agent definition default)
- `model` matches the attempt config
- `persistSession` is `true` when policy has `resumePrevious` or `outputValidation`, `false` otherwise
- `maxBudgetUsd` equals remaining budget (initial minus cumulative spend)
- `effort` forwarded from attempt config when set
- `resume` is the session ID from previous attempt when `resumePrevious: true`

**Attempt transitions:** default success, default fail, reviewer all-succeed,
reviewer fallback, reviewer all-fail, error_max_budget_usd never advances.

**Budget tracking:** Verify remaining budget decreases across attempts.
Attempt 1 costs $1.50 of $5.00 budget → attempt 2 gets `maxBudgetUsd: 3.50`.
If cumulative spend exceeds budget between attempts → done without calling
next attempt.

**Crash retry:** throw then succeed, throw all retries, crash on attempt 2
retries attempt 2 not 1, exponential backoff delay.

**Output file:** Written when --output-file set. Contains agent text output
(not JSON). Parent dirs created. Not written on failure.

**Prompt vars:** `{KEY}` replaced in prompt before passing to queryFn.

**wrapUpPrompt substitution:** When attempt 3 uses SYNTHESIZE prompt with
`{OUTPUT}`, the runner substitutes the most recent captured output.
Verify: fakeQuery returns "some findings" on attempt 1 (error_max_turns),
"partial report" on attempt 2 (error_max_turns), then attempt 3 (haiku
fresh) receives a prompt where `{OUTPUT}` is replaced with "partial report"
(the most recent output, not attempt 1's) — NOT the literal `{OUTPUT}`.

**fix_output flow:** When outputValidation returns false after attempt 1
success, verify: the runner resumes the same session with fixPrompt as
the new user message, the fix attempt result is re-validated, and if
still invalid the runner accepts the best output (done, not failed).

**Hook tests:** onAttemptComplete called with correct context, errors swallowed.

Create isolated registries per test via `createPolicyRegistry()` in `beforeEach`.
For integrated reviewer policy tests: import `reviewerPolicy` from
`policies/reviewer.ts` and register it into the test registry via
`testRegistry.registerPolicy("reviewer", reviewerPolicy)`. This verifies
the actual policy definition without relying on module-level side effects
(which register on the default module-level registry, not the test instance).

### 11f: cli.test.ts — Arg Parsing

```typescript
// @vitest-environment node
```

- Missing required flag (--group, --workdir, --prompt, --log, --phase) → throw
  with usage message listing all required flags
- Unknown flag → throw with "unknown flag" and the flag name
- `--prompt-var KEY=VALUE` repeated → accumulates into `promptVars` map
- `--prompt-var` with `=` in value → splits on first `=` only
  (`FOO=bar=baz` → `{ FOO: "bar=baz" }`)
- `--max-turns` / `--max-budget` / `--max-crash-retries` / `--crash-retry-delay`
  → parsed as numbers, NaN → throw
- `--policy` default → `"default"` when not provided
- `--agent` optional → undefined when not provided, string when provided
- All flags present → full RunnerOptions object with correct types

### 11g: prompts.test.ts

- `stripFrontmatter`: with/without frontmatter, edge cases, real curator.md
- `substituteVars`: single var, multiple vars, unmatched left alone, empty map
- `substituteVars` with reviewer template: `{SKILL}` and `{ANGLE}` replaced,
  bash commands in template left untouched (no false-positive substitution on
  `${...}` or `$(...)`)

### 11h: metrics.test.ts

- Valid JSONL, backward-compatible fields, new fields, append-only, mkdir

### 11i: retry-context.test.ts — buildRetryContext

```typescript
// @vitest-environment node
```

- Worktree with git commits → includes last 5 commit lines
- Worktree with `.agent-status.json` → includes JSON content
- Previous output provided → includes last 200 chars
- No git repo (empty dir) → graceful fallback (no crash)
- No `.agent-status.json` → omits that section
- Null previous output → omits that section
- Uses `tmp` dir fixture, NOT a real git repo (create with
  `execSync("git init && git commit --allow-empty -m test")` in tmpdir)

### 11j: integration.test.ts — Bash↔TypeScript boundary

Smoke test that verifies `agent.sh` assembles CLI args correctly without
invoking a real agent. Approach: create a mock `agent-runner.ts` that
prints its received args as JSON to stdout, then source `agent.sh` functions
in a bash subshell and call `run_agent()` with `SDK_RUNNER=1`.

```typescript
// @vitest-environment node
import { execSync } from "child_process";

// Test: reviewer naming convention produces correct CLI args
//   - group "hooks-adversarial" → --policy reviewer --agent skill-reviewer
//     --output-file .../reviews/hooks/adversarial.md
//     --prompt-var SKILL=hooks --prompt-var ANGLE=adversarial
// Test: curator group produces correct CLI args (SKILL=${group}, LOG_DIR)
// Test: non-reviewer group → no --agent, no --output-file, generic SKILL=${group}
// Test: prompt_file override from naming convention reaches --prompt
// Test: SDK_PROMPT_VARS with spaces in values are quoted correctly
// Test: SDK_POLICY/SDK_OUTPUT_FILE env var overrides naming convention defaults
// Test: agent option forwarded → --agent flag present in args
// Test: LOG_DIR env var override → config.sh respects pre-set LOG_DIR
//   - Set LOG_DIR=/tmp/test-override before sourcing config.sh
//   - Verify LOG_DIR stays /tmp/test-override (not derived from PHASE+suffix)
// Test: LOG_DIR unset → config.sh derives from PHASE and run_suffix as before
```

This test catches quoting bugs, variable scoping issues, and arg ordering
problems at the bash→TypeScript boundary — the most likely failure point
that unit tests on either side alone can't cover.

**Approach for config.sh LOG_DIR tests:** Source config.sh in a bash
subshell with a minimal YAML fixture. Verify `$LOG_DIR` is the pre-set
value when exported, and the derived value when unset. These are pure
bash tests wrapped in vitest via `execSync`.

**Exit criteria:**
- `npm test` discovers and runs all 9 test files in `scripts/sdk/__tests__/`
- All tests pass — zero failures, zero skipped
- `@vitest-environment node` override confirmed: no jsdom errors in SDK tests
- Coverage of every exported function: `nextAction`, `registerPolicy`,
  `getPolicy`, `listPolicies`, `applyOverrides`, `createPolicyRegistry`,
  `runAgent`, `parseCliArgs`, `stripFrontmatter`, `substituteVars`,
  `logMetrics`, `buildRetryContext`, `isValid`
- Integration test (11j) passes — bash shell invocation succeeds

Commit: `test: add tests for SDK agent runner`

---

## Step 12: Update full-verify.sh

Add the SDK type check to `scripts/full-verify.sh` after the existing
`npx tsc --noEmit` line:

```bash
echo ""
echo "=== SDK type check ==="
npx tsc -p tsconfig.sdk.json --noEmit
```

This ensures the SDK code is always checked by the standard verification
pipeline — not just when someone remembers to run it manually.

**Exit criteria:**
- `./scripts/full-verify.sh` runs the SDK tsc check (grep output for
  "SDK type check")
- `./scripts/full-verify.sh` still passes end-to-end

Commit: `feat: add SDK type check to full-verify.sh`

---

## Step 13: Verify

Run `./scripts/full-verify.sh`. All existing tests must still pass.
Also run `npx tsx scripts/sdk/agent-runner.ts --help` to verify the CLI works.

Verify:
- `npm test` picks up the new tests in `scripts/sdk/__tests__/`
- `npx tsc -p tsconfig.sdk.json` passes with no errors (now in full-verify)
- Regular `npx tsc --noEmit` (frontend) still passes and ignores `scripts/sdk/`
- `@vitest-environment node` override works (vitest default is `jsdom` from
  vite.config.ts — the comment override in each test file must take effect)
- `getPolicy("default")` and `getPolicy("reviewer")` resolve correctly
- Function references survive the shallow-spread copy in `getPolicy()`
- The reviewer template + prompt vars produce the expected prompt text
- The curator prompt references the correct review output paths
- `LOG_DIR` override works: `LOG_DIR=/tmp/test ./scripts/full-verify.sh`
  doesn't break anything (config.sh respects existing value)
- Integration test (11j) passes — bash sources correctly, args assembled right
- E2E tests still pass (SDK changes don't affect frontend)

Do NOT skip verification. Fix any issues before declaring done.

Commit: only if verify required fixes.

---

## Constraints

- Do NOT modify files outside scope (see frontmatter)
- Do NOT add features beyond what's specified
- Do NOT remove the existing `claude -p` code path in agent.sh
- Do NOT modify `launch-phase.sh` or `monitor_agent()`
- `stage.sh`: ONLY the preflight check change (skip prompt validation when SDK_RUNNER=1)
- `config.sh` and `generate-retry-config.sh`: ONLY the LOG_DIR override (Step 9b)
- Keep dependencies minimal — `@anthropic-ai/claude-agent-sdk`, `tsx`, `@types/node`
- The runner must work with `npx tsx` (no build step)
- All tests mockable without a real API key
- Agent output goes to stderr/logfile; only AgentResult JSON goes to stdout

---

## Adding a New Policy

1. Create `scripts/sdk/policies/{name}.ts`
2. Define attempt configs, prompts, optional validation inline
3. Call `registerPolicy("{name}", { ... })` at module scope
4. Add `await import("./policies/{name}.js")` to the CLI entry point
5. Use `--policy {name}` from bash

No core files need modification.

---

## Adding a New Pipeline Configuration

The YAML config is general-purpose. Any combination of stages, groups, policies,
and output collection works. Examples:

**Single-skill curation (retry after partial failure):**
```yaml
phase: skill-curation
stages:
  - name: "Review"
    groups:
      - id: hooks-accuracy
        branch: curation/hooks-accuracy
      # ... only the failed skill's reviewers
  - name: "Curate"
    groups:
      - id: hooks
        branch: curation/hooks
```

**Phase implementation (no reviewers, default policy):**
```yaml
phase: phase18
stages:
  - name: "Implementation"
    groups:
      - id: onboarding-flow
        branch: feature/phase18-onboarding
      - id: schedule-wizard
        branch: feature/phase18-wizard
```

**Mixed policies (some agents need fallback, others don't):**
Per-group policy overrides via naming convention or YAML fields, same
mechanism as the review stage.

---

## Failure Handling and Reruns

The SDK runner integrates cleanly with the existing failure infrastructure.
No changes needed to `stage.sh`, `merge.sh`, or `generate-retry-config.sh`.

### How failures flow through the system

1. **Agent-level** (SDK runner): The 3-attempt policy replaces the bash
   MAX_RETRIES loop. If all attempts fail, `runAgent()` returns
   `{ failed: true }` and the process exits with code 1.

2. **Stage-level** (stage.sh, unchanged): `run_parallel_stage()` collects
   exit codes. Groups with exit 0 → `stage-succeeded.txt`. Groups with
   exit 1 → `stage-failed.txt`. Partial success continues to merge.

3. **Merge-level** (merge.sh, unchanged): `do_merge()` reads
   `stage-succeeded.txt` and skips failed groups.

4. **Retry config** (generate-retry-config.sh, unchanged): Reads
   `stage-failed.txt`, generates a new YAML with only failed groups.

### Rerunning failed groups in a regular phase

```bash
# Original run — 2 of 5 agents fail
./scripts/launch-phase.sh docs/prompts/phase18/config.yaml all

# Generate retry config with only failed groups
./scripts/generate-retry-config.sh docs/prompts/phase18/config.yaml /tmp/retry.yaml

# Rerun — same _LAUNCH_BASE_REF is preserved in env
./scripts/launch-phase.sh /tmp/retry.yaml all
```

This works identically with the SDK runner — exit codes are the contract
between the runner and the orchestration layer.

### Rerunning failed reviewers in the curation pipeline

Reviewer output files go to `${LOG_DIR}/reviews/${skill}/${angle}.md`,
and curators read from the same LOG_DIR. For reruns to work, failed
reviewers must write to the same LOG_DIR as the succeeded ones.

This works because of the LOG_DIR env var override added in **Step 9b**:
config.sh respects `LOG_DIR` if already set in the environment. The
retry workflow:

```bash
# Original run — 3 of 40 reviewers fail
./scripts/launch-phase.sh docs/prompts/curation/skill-curation.yaml stage 1
# LOG_DIR was e.g. /tmp/ganttlet-logs/skill-curation-a1b2c3d4

# Generate retry config (only failed groups)
./scripts/generate-retry-config.sh \
  docs/prompts/curation/skill-curation.yaml /tmp/retry-reviewers.yaml

# Rerun with explicit LOG_DIR → outputs land alongside succeeded ones
LOG_DIR=/tmp/ganttlet-logs/skill-curation-a1b2c3d4 \
  ./scripts/launch-phase.sh /tmp/retry-reviewers.yaml stage 1

# All 40 reviewer outputs now in the same LOG_DIR
# Proceed to curators
./scripts/launch-phase.sh docs/prompts/curation/skill-curation.yaml stage 2
```

`generate-retry-config.sh` also prints the original LOG_DIR in its
output so the operator can copy-paste it.

### What the SDK runner improves for failure recovery

The SDK runner's attempt-based fallback reduces the need for reruns:

- **Current system**: Agent crashes → retry same config (bash retry loop).
  If the agent hits max turns, it fails — the only recovery is a full rerun.

- **SDK runner**: Agent hits max turns → attempt 2 resumes with a wrap-up
  prompt asking for structured output in 5 turns. If that fails → attempt 3
  uses haiku fresh with a synthesize prompt. The agent has 3 chances to
  produce useful output before being marked as failed.

For reviewers specifically, this means the reviewer policy's 3 attempts
(sonnet 30 turns → resume 5 turns → haiku fresh 5 turns) should
drastically reduce the failure rate that caused the truncation problem in
the first place. Most reviewers that would have been "failures" under the
current system will now produce at least a partial report.

---

## Completeness Proof

### Requirements → Steps → Tests

| Requirement | Step | Test | Exit criteria |
|---|---|---|---|
| SDK runner replaces `claude -p` | 8, 9a | 11e, 11j | CLI works, bash integration passes |
| Open policy registry | 3 | 11c | register/resolve/override all tested |
| Attempt-based fallback (reviewer) | 4b, 7 | 11b, 11d, 11e | State machine exhaustive, policy validated |
| DI-testable (no vi.mock) | 8 | 11e | fakeQuery pattern, zero mocks |
| Curation restructure (reviewers) | 10a-10d | 11j | Template, YAML, curator prompt updated |
| Curators read from disk | 10c | 11j | `{LOG_DIR}/reviews/{SKILL}/` in curator |
| No hardcoded `main`/`/workspace` | 9a, 10b | 11j | All paths from MERGE_TARGET |
| maxTurns precedence | 8a (note) | 11e | query-level maxTurns in contract tests |
| Curator file permissions | 8a (note) | 11e | bypassPermissions in contract tests |
| WATCH mode unaffected | 9a | — | SDK path guarded by SDK_RUNNER=1 |
| Existing `claude -p` preserved | 9a | 11j | Constraint: else branch unchanged |
| LOG_DIR override for reruns | 9b | 11j | config.sh respects pre-set LOG_DIR |
| Failure/rerun procedures | (docs) | 11j | Exit code contract verified |
| `{OUTPUT}` in wrapUpPrompt | 8a | 11e | Substitution tested with fakeQuery |
| Cumulative budget tracking | 8a | 11e | Remaining budget decreases across attempts |
| `persistSession` conditional | 8a | 11e | true when resume or outputValidation needed |
| `bypassPermissions` inheritance | 8a (note) | — | Documented constraint |
| `effort` per attempt | 4b, 8a | 11e | effort forwarded in contract tests |
| Output validation + fix flow | 4b, 7 | 11b, 11e | fix_output → resume → re-validate |
| Crash retry context | 8a | 11i | buildRetryContext with git fixtures |
| Metrics backward compat | 6 | 11h | JSONL fields match existing schema |
| CLI arg parsing | 8a | 11f | Required flags, edge cases |
| Prompt var substitution | 5 | 11g | {SKILL}/{ANGLE} + bash-safe |
| full-verify.sh covers SDK | 12 | 13 | SDK tsc check in pipeline |
| Docs updated with behavior | 9c, 10e | — | No stale subagent refs in updated docs |

### File Coverage

| Modify-scope file | Step | Verified by |
|---|---|---|
| `scripts/sdk/**` | 1-8, 11 | tsc + vitest + full-verify |
| `scripts/lib/agent.sh` | 9a | 11j integration, bash -n, shellcheck |
| `scripts/lib/stage.sh` | 9a | bash -n, preflight passes with SDK_RUNNER=1 |
| `scripts/lib/config.sh` | 9b | 11j integration (LOG_DIR override) |
| `scripts/generate-retry-config.sh` | 9b | bash -n |
| `scripts/full-verify.sh` | 12 | Step 13 runs it end-to-end |
| `package.json` | 1a | npm install succeeds |
| `tsconfig.sdk.json` | 1b | tsc -p passes every step |
| `vite.config.ts` | 1c | Only if needed (likely untouched) |
| `docs/prompts/curation/curator.md` | 10c | yq parse, no Agent reviewer refs |
| `docs/prompts/curation/reviewer-template.md` | 10a | Placeholder check in exit criteria |
| `docs/prompts/curation/skill-curation.yaml` | 10b | yq: 2 stages, 40+8 groups |
| `.claude/skills/curation/SKILL.md` | 10e | No stale subagent refs, pipeline flow updated |
| `.claude/skills/multi-agent-orchestration/SKILL.md` | 9c | SDK runner section present |
| `docs/multi-agent-guide.md` | 9c | SDK Agent Runner section present |

### Exported Function Coverage

Every exported function has a dedicated test:

| Function | Module | Test file |
|---|---|---|
| `nextAction` | attempt-machine.ts | 11b |
| `registerPolicy` | policy-registry.ts | 11c |
| `getPolicy` | policy-registry.ts | 11c |
| `listPolicies` | policy-registry.ts | 11c |
| `applyOverrides` | policy-registry.ts | 11c |
| `createPolicyRegistry` | policy-registry.ts | 11c |
| `isValid` | policies/reviewer.ts | 11d |
| `runAgent` | agent-runner.ts | 11e |
| `parseCliArgs` | agent-runner.ts | 11f |
| `stripFrontmatter` | prompts.ts | 11g |
| `substituteVars` | prompts.ts | 11g |
| `logMetrics` | metrics.ts | 11h |
| `buildRetryContext` | agent-runner.ts | 11i |

### Invariants Verified

- error_max_budget_usd never advances attempt (11b property-based)
- Call count never exceeds totalAttempts (11b property-based)
- Resume flag matches attempt config (11b + 11e contract)
- Function references survive structuredClone avoidance (11c)
- `substituteVars` ignores `${...}` and `$(...)` bash syntax (11g)
- Reviewer naming convention produces correct CLI args (11j)
- LOG_DIR override is respected when set (11j)
