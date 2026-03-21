---
phase: 19
group: A
stage: 1
agent_count: 1
scope:
  create:
    - scripts/sdk/types.ts
    - scripts/sdk/policy-registry.ts
    - scripts/sdk/attempt-machine.ts
    - scripts/sdk/agent-runner.ts
    - scripts/sdk/prompts.ts
    - scripts/sdk/metrics.ts
    - scripts/sdk/policies/default.ts
    - scripts/sdk/policies/reviewer.ts
    - scripts/sdk/__tests__/attempt-machine.test.ts
    - scripts/sdk/__tests__/agent-runner.test.ts
    - scripts/sdk/__tests__/policy-registry.test.ts
    - scripts/sdk/__tests__/reviewer-policy.test.ts
    - scripts/sdk/__tests__/cli.test.ts
    - scripts/sdk/__tests__/prompts.test.ts
    - scripts/sdk/__tests__/metrics.test.ts
    - scripts/sdk/__tests__/retry-context.test.ts
    - scripts/sdk/__tests__/fixtures/valid-accuracy-report.md
    - scripts/sdk/__tests__/fixtures/valid-scope-report.md
    - scripts/sdk/__tests__/fixtures/malformed-report.md
    - scripts/sdk/__tests__/fixtures/no-report-output.md
    - tsconfig.sdk.json
  modify:
    - package.json
    - package-lock.json
  read_only:
    - .claude/agents/skill-reviewer.md
    - docs/plans/sdk-agent-runner.md
depends_on: []
tasks:
  - id: A1
    summary: "Install deps, create tsconfig.sdk.json, directory structure"
  - id: A2
    summary: "Core types — AgentResult, FailureMode, AttemptResultType, AttemptConfig, PolicyDefinition, RunnerOptions, AgentMetrics"
  - id: A3
    summary: "Policy registry — createPolicyRegistry factory + module singleton"
  - id: A4
    summary: "Default + reviewer policies with exported PolicyDefinition objects"
  - id: A5
    summary: "Prompts utility — stripFrontmatter + substituteVars (split/join)"
  - id: A6
    summary: "Metrics — JSONL append, LOG_METRICS_DIR env var"
  - id: A7
    summary: "Attempt state machine — nextAction() pure function"
  - id: A8
    summary: "Agent runner — runAgent + parseCliArgs + buildRetryContext + CLI entry"
  - id: A9
    summary: "All unit tests (T1-T9) — 8 test files + 4 fixtures"
---

# Phase 19 Group A — SDK Agent Runner Core

You are implementing Phase 19 Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/sdk-agent-runner.md` for the detailed design specification (Steps 1-8, 11).

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Context

The current agent runner (`scripts/lib/agent.sh`) uses `claude -p` with a bash retry loop.
When a reviewer hits max turns, it fails with no recovery. This group builds the TypeScript
replacement: a programmatic SDK runner with attempt-based fallback via an open policy registry.

Group B (parallel) restructures the curation pipeline prompts/YAML. Group C (parallel) updates
orchestration docs and config.sh. Group D (Stage 2) integrates the runner into agent.sh after
this group's code is merged.

## Your files (ONLY create/modify these):

**Create (entire new directory tree):**
- `scripts/sdk/types.ts` — Core types
- `scripts/sdk/policy-registry.ts` — Factory + singleton registry
- `scripts/sdk/attempt-machine.ts` — Pure state machine
- `scripts/sdk/agent-runner.ts` — I/O layer with DI + CLI entry
- `scripts/sdk/prompts.ts` — Frontmatter stripping + variable substitution
- `scripts/sdk/metrics.ts` — JSONL metrics writer
- `scripts/sdk/policies/default.ts` — Single-attempt policy
- `scripts/sdk/policies/reviewer.ts` — 3-attempt fallback policy
- `scripts/sdk/__tests__/*.test.ts` — 8 test files (integration.test.ts is Group D)
- `scripts/sdk/__tests__/fixtures/*.md` — 4 report fixtures
- `tsconfig.sdk.json` — Node-targeting TypeScript config

**Modify:**
- `package.json` + `package-lock.json` — Add devDependencies

**Read-only:**
- `.claude/agents/skill-reviewer.md` — Output format for fixtures (lines 158-193)
- `docs/plans/sdk-agent-runner.md` — Full design spec

## Success Criteria (you're done when ALL of these are true):

1. `npx tsc -p tsconfig.sdk.json --noEmit` passes
2. `npx tsc --noEmit` (frontend) still passes — scripts/sdk/ not pulled in
3. `npm test` discovers and runs all 8 test files in scripts/sdk/__tests__/
4. All tests pass — zero failures, zero skipped
5. `npx tsx scripts/sdk/agent-runner.ts --help` prints usage and exits 0
6. `getPolicy("default")` returns 1 attempt, `getPolicy("reviewer")` returns 3 attempts
7. `isValid` correctly identifies valid/invalid reviewer reports via fixtures
8. `substituteVars` uses split/join (no regex), doesn't match `${...}` or `$(...)`
9. All changes committed with conventional commit messages

## Failure Criteria (keep working if any of these are true):

- Any exported function without a test
- `@vitest-environment node` not set in test files (jsdom causes Node-only test failures)
- `_resetForTesting` exported (CLAUDE.md forbids test-specific code in production)
- `structuredClone(policy)` used instead of `{ ...policy, attempts: structuredClone(policy.attempts) }`
- Uncommitted changes

## Tasks — execute in order:

### A1: Project setup (Plan Step 1)

```bash
npm install @anthropic-ai/claude-agent-sdk tsx @types/node --save-dev
```

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

Create directory structure: `scripts/sdk/`, `scripts/sdk/policies/`, `scripts/sdk/__tests__/`,
`scripts/sdk/__tests__/fixtures/`.

Verify: `npx tsc -p tsconfig.sdk.json --noEmit` passes. `npx tsc --noEmit` (frontend) still passes.

Commit both `package.json` AND `package-lock.json`.

Commit: `feat: scaffold SDK agent runner with tsconfig and vitest integration`

### A2: Core types (Plan Step 2)

Create `scripts/sdk/types.ts`. Key types — see plan Step 2 for full definitions:

```typescript
export type FailureMode = "success" | "error_max_turns" | "error_max_budget_usd" | "error_during_execution" | "crash";
export type AttemptResultType = Exclude<FailureMode, "crash">;

export interface AttemptConfig {
  maxTurns: number;
  model: string;          // alias ("sonnet") or full ID
  resumePrevious: boolean;
  wrapUpPrompt?: string;
  effort?: "low" | "medium" | "high" | "max";
}

export interface AgentResult {
  group: string; phase: string; attempt: number; totalAttempts: number;
  partial: boolean; failed: boolean; output: string | null;
  sessionId: string | null; failureMode: FailureMode; totalCostUsd: number;
}

export interface AttemptContext {
  attemptIndex: number; config: AttemptConfig; resultType: FailureMode;
  output: string | null; sessionId: string | null; durationMs: number; costUsd: number;
}
```

Also: `OutputValidation`, `PolicyDefinition`, `RunnerOptions`, `AgentMetrics` (see plan).

Commit: `feat: add core types for SDK agent runner`

### A3: Policy registry (Plan Step 3)

Create `scripts/sdk/policy-registry.ts` using factory pattern:

```typescript
export function createPolicyRegistry() {
  const registry = new Map<string, PolicyDefinition>();
  return { registerPolicy, getPolicy, listPolicies, applyOverrides };
}
const defaultRegistry = createPolicyRegistry();
export const { registerPolicy, getPolicy, listPolicies, applyOverrides } = defaultRegistry;
export { createPolicyRegistry };  // for test isolation
```

- `getPolicy`: `{ ...policy, attempts: structuredClone(policy.attempts) }` — NOT `structuredClone(policy)` (throws on functions)
- No `_resetForTesting` — tests use `createPolicyRegistry()` for isolation

Commit: `feat: add open policy registry for agent runner`

### A4: Policies (Plan Step 4)

Create `scripts/sdk/policies/default.ts`:
```typescript
export const defaultPolicy: PolicyDefinition = {
  attempts: [{ maxTurns: 80, model: "sonnet", resumePrevious: false }],
};
registerPolicy("default", defaultPolicy);
```

Create `scripts/sdk/policies/reviewer.ts` — 3-attempt config with WRAP_UP, SYNTHESIZE, FORMAT_FIX
prompts, `isValid()` function, `reviewerValidation` OutputValidation. Export `reviewerPolicy` and
`isValid` for test isolation. Attempt 3 has `effort: "low"`. See plan Step 4b for full code.

Commit: `feat: add default and reviewer policies for agent runner`

### A5: Prompts utility (Plan Step 5)

Create `scripts/sdk/prompts.ts` — `stripFrontmatter()` + `substituteVars()`.

**Critical:** `substituteVars` uses `content.split('{' + key + '}').join(value)` — no regex.
This prevents regex injection if keys contain metacharacters.

Commit: `feat: add frontmatter stripping and variable substitution for agent runner`

### A6: Metrics (Plan Step 6)

Create `scripts/sdk/metrics.ts` — `logMetrics()` writes JSONL.

Directory: `process.env.LOG_METRICS_DIR ?? '.claude/logs'` (matches agent.sh line 6 contract).
Append-only, synchronous, mkdir if needed. Note concurrent append risk (40 processes) is acceptable.

Commit: `feat: add structured metrics for SDK agent runner`

### A7: Attempt state machine (Plan Step 7)

Create `scripts/sdk/attempt-machine.ts` — `nextAction()` pure function.

```typescript
export function nextAction(
  attempts: AttemptConfig[], attemptIndex: number, resultType: AttemptResultType,
  crashCount: number, maxCrashRetries: number,
  outputValid: boolean | null, outputFixAttempted: boolean,
): NextAction
```

Rule precedence for `success` (order matters):
1. `outputValid === null` → `validate_output`
2. `outputValid === false` + `!outputFixAttempted` → `fix_output`
3. `outputValid === false` + `outputFixAttempted` → `done` (accept)
4. `outputValid === true` → `done`

Crash: checked first via `crashCount >= maxCrashRetries` → done(crash).
`error_during_execution` + `outputFixAttempted` → done(accept).
`error_max_budget_usd` → always done. See plan Step 7 for complete rules.

Commit: `feat: implement attempt state machine for agent runner`

### A8: Agent runner (Plan Step 8)

Create `scripts/sdk/agent-runner.ts`:

```typescript
export type QueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;

export async function runAgent(options: RunnerOptions, queryFn: QueryFn): Promise<AgentResult>

export function parseCliArgs(argv: string[]): RunnerOptions

export function buildRetryContext(workdir: string, previousOutput: string | null): string
```

Key behaviors — see plan Step 8 for full spec:
- Determine `persistSession` from policy (resumePrevious OR outputValidation)
- Capture `session_id` from `system/init` message, `total_cost_usd` from `result` message
- Track cumulative budget, pass `remainingBudget` as `maxBudgetUsd`
- Track `lastNonNullOutput` across attempts for `{OUTPUT}` substitution
- Dispatch on `nextAction` return: call/validate_output/fix_output/done
- Edge cases: empty stream→crash, missing prompt→fail immediately, crash during fix→set
  outputFixAttempted before call, mkdir failure→log warning
- CLI entry: dynamic imports for policies, JSON result to stdout, exit code 1 on failure

CLI flags: `--group`, `--workdir`, `--prompt`, `--log`, `--phase` (required).
`--policy`, `--max-turns`, `--max-budget`, `--model`, `--agent`, `--output-file`,
`--prompt-var KEY=VALUE`, `--max-crash-retries`, `--crash-retry-delay` (optional).

Commit: `feat: implement SDK agent runner with policy registry and DI`

### A9: All unit tests (Plan Step 11, tests T1-T9)

Create 4 fixture files from `.claude/agents/skill-reviewer.md` lines 158-193:
- `valid-accuracy-report.md`, `valid-scope-report.md`, `malformed-report.md`, `no-report-output.md`

Create 8 test files (integration.test.ts belongs to Group D). Every test file starts with `// @vitest-environment node`.

See plan Step 11 (11a-11i) for complete test specifications. Key patterns:
- `fakeQuery` returns `{ queryFn, calls }` tuple (not fn.calls — inaccessible after QueryFn cast)
- Use `createPolicyRegistry()` for isolated registries in `beforeEach`
- Import `reviewerPolicy`/`defaultPolicy` for isolated registry tests
- Session IDs: capture `idx` before `callIndex++` to avoid off-by-one
- Budget tests: verify `maxBudgetUsd` decreases across attempts
- `persistSession` tests: true when `resumePrevious` or `outputValidation`, false otherwise
- Integration test (T10) belongs to Group D — do NOT create it here

Commit: `test: add unit tests for SDK agent runner`

## Progress Tracking

Update `.agent-status.json` after each task:
```json
{
  "group": "A", "phase": 19,
  "tasks": { "A1": { "status": "done" }, "A2": { "status": "in_progress" } },
  "last_updated": "2026-03-21T10:00:00Z"
}
```

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked in .agent-status.json
- Emergency: `git add -A && git commit -m "emergency: groupA saving work"`
- **Calculations**: NEVER do mental math — use `python3 -c` for arithmetic
