# Agent Engine

Orchestrate AI agents in DAG workflows. One command to fix a bug.
One config file for a 40-agent pipeline.

## Principles

1. **Progressive.** One command to start. Full DAG when needed. No cliff.
2. **Resilient.** Retry, escalate, resume. Agents advise their successors.
3. **Observable.** Files are the interface. JSONL for machines. Markdown for humans.
4. **Extensible.** Any AI runner, workspace, or config pattern. Zero engine deps.
5. **Agent-native.** Operated BY agents. File IPC. Hints to running agents.
   Three tiers: engine → orchestrator agent → human.

## Concepts

**Step** — a unit of work. A prompt, a shell command, or a sequence of both.

**Pipeline** — steps with dependencies. YAML config. Sequential by default.

**Run** — one execution. State (JSON), logs (JSONL + text), report (markdown).
Resumable. Cumulative across retries.

## User Experience

**Level 0** — no config:
```bash
npx @agent-engine/claude --prompt "fix the failing tests"
```

**Level 1** — prompt files, sequential:
```bash
npx agent-engine run review.md implement.md test.md
```

**Level 2** — YAML:
```yaml
steps:
  - prompt: "Review src/ for bugs"
  - prompt: "Fix the issues found"
```
Sequential by default. Inline prompts. IDs auto-generated. Parallel:
```yaml
steps:
  - parallel:
    - prompt: "Review for bugs"
    - prompt: "Review for security"
  - prompt: "Fix the issues found"
```

**Level 3** — full control (same keyword, more fields):
```yaml
context: project-instructions.md
requires:
  env: [GITHUB_TOKEN]
  commands: [gh]
resources:
  api: 10
  cost_usd: 50.00
steps:
  - id: feature-A
    prompt: feature-a.md
    skills: [skills/coding.md]
    branch: feature/A
    labels: { role: implement }
    max_attempts: 3
    depends_on: [review]
    attempts:
      - executor: shell
        command: "npm test"
      - executor: sdk
        max_turns: 60
```

### Defaults
Every field has a default. SDK packages provide their own (model, cost rates).
```
maxTurns: 30    maxAttempts: 2    resources: [api]    api: 5
timeoutSeconds: 1800    stallWarnSeconds: 120    stallAbandonSeconds: 600
```

### CLI
```bash
npx agent-engine init                        # scaffold .agent-engine/
npx agent-engine validate                    # preflight + config + cost estimate
npx agent-engine run                         # run pipeline
npx agent-engine run --resume                # retry failed (finds latest)
npx agent-engine run --watch                 # tmux panes
npx agent-engine run --ci                    # non-interactive stdout
npx agent-engine run --dashboard             # web UI on localhost
npx agent-engine run --max-parallel 10
npx agent-engine run --budget 50
npx agent-engine run --only a,b              # subset + transitive deps
npx agent-engine cleanup                     # remove stale artifacts
```

`engine validate` catches everything before spending money:
```
Preflight:  ✓ API key valid   ✗ GITHUB_TOKEN not set   ✓ gh available
Config:     ✓ Valid (3 steps)  ⚠ No budget cap
Estimate:   ~$9.00 (3 steps × ~30t × ~$0.10/turn)
```
`--json` for agents. Every error says what, where, how to fix.

### Project directory
`.agent-engine/` (like `.github/`):
```
.agent-engine/
  config.yaml    prompts/    .env.example    .gitignore (logs/, .env)
```

### Agent-assisted setup
Setup guide, JSON schema, prompt templates ship with the engine. Agent reads
guide → analyzes project → writes config + prompts → validates → runs.

### `engine init`
Detects existing project knowledge. Offers pattern templates:
```
What kind of workflow?
  ❯ Simple pipeline — steps in sequence
    Review loop — implement → review → improve → verify
    Parallel reviews — multiple angles
    Custom — blank config
```
Skips creating files that already exist.

## Architecture

```
Config → Parser → DAG → Scheduler → Engine spawns workers →
Workers try attempts → Results → State updated → Report → Complete or resume
```

```
Config (YAML)        Commands         State File
  │ watched            │ consumed       │ engine writes
  ▼                    ▼                ▼
┌─────────────────────────────────────────────┐
│                   Engine                     │
│  Loop: monitor → signals → save → schedule  │
│        → dispatch → sleep 1s                │
└────────────────┬────────────────────────────┘
                 │ spawn (setsid)
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  Worker      Worker      Worker
```

### Engine loop (poll-based, batched I/O)
1. Monitor: ONE `readdir` for completions, `kill(pid,0)` for crashes, `stat` for stalls
2. Signals: commands (cancel/adjust/hint), config changes (reconcile live)
3. Save state (throttled 30s)
4. Scheduler (pure: `(dag, state) → (actions, newState)`, never mutates)
5. Dispatch: resource-aware, set `running` immediately, spawn worker
6. Sleep 1s

### Workers
Subprocesses (`setsid`). Read config → try attempts → write log + result → exit.
Kill = `kill(-pgid)`. No orphans. SDK packages ship default workers.

### Steps and attempts
Ordered attempt sequence — same abstraction for all escalation:
```yaml
attempts:
  - executor: shell
    command: "git merge --no-ff origin/feature-A"
  - executor: sdk
    prompt: resolve-conflict.md
  - executor: sdk
    prompt: resolve-conflict.md
    model: claude-opus-4-6
```
When omitted, generated by escalation policy. Default: on SDK failure,
auto-insert 10-turn diagnosis step before retry (reads previous log,
outputs RETRY_HINT). Collaborative debugging as a default.

### StepExecutor
Engine's only extension point. Forward-compatible (options object):
```typescript
interface StepExecutor {
  execute(attempt: Attempt, context: ExecutionContext): Promise<AttemptResult>;
  resume?(sessionId: string, message: string, context: ExecutionContext): Promise<AttemptResult>;
  preflight?(): Promise<PreflightResult>;
  loadsProjectContext?: boolean;   // SDK handles project knowledge natively
  getContext?(): string;           // SDK-specific agent guidance
}
interface ExecutionContext { workdir: string; logFile: string; /* extensible */ }
```
Validated against Claude SDK, OpenAI Agents SDK, Google ADK.

### Resources
Slots (renewable concurrency) and budgets (consumable cost):
```yaml
resources:
  api: 10
  merge_lock: 1
  cost_usd: 50.00
```

### Labels
Key-value metadata for grouping, bulk operations, dynamic dependencies:
```yaml
- id: curator
  labels: { role: curator, skill: scheduling-engine }
  depends_on:
    label: { skill: scheduling-engine, role: reviewer }
```

### State
`pipeline-state.json`. Per-step: status, attempt, cost, turns, health,
labels, lastEventAt, retryHint, attemptHistory. Versioned for migration.
Resume: `running→ready`, `skipped→blocked`, non-retryable→`blocked`.

### Step output flow
Each step's output → `.agent-engine/outputs/`. Dependent steps get
automatic context pointing to previous outputs.

## Prompt Composition

The worker constructs the full prompt from layers. The engine doesn't
create parallel knowledge — it references what exists.

| Layer | Source | Loaded by |
|---|---|---|
| Engine context | Auto-generated | Worker (always) |
| Project context | `context:` in config | Worker (if executor doesn't handle natively) |
| Step skills | `skills:` per step | Worker (if executor doesn't handle natively) |
| Executor context | `executor.getContext()` | SDK package |
| Task prompt | `prompt:` field | Worker (always) |

**Engine context** (auto-generated, never written by users):
```
You are step "{id}" (attempt {attempt}/{maxAttempts}).
Workspace: {workdir}. Output: .agent-engine/outputs/{id}.txt
Previous outputs: {dep outputs}
Signals: CANNOT_PROCEED, RETRY_HINT
Previous failure: {hint, adjustments}
```

**Project context + skills** — just file paths:
```yaml
context: project-instructions.md
steps:
  - prompt: implement.md
    skills: [skills/coding.md, skills/testing.md]
```
If executor declares `loadsProjectContext: true`, engine skips loading
(SDK handles it natively). No duplication.

## Failure and Recovery

| Reason | Retryable | Meaning |
|---|---|---|
| `timeout` | Yes | max_turns, stall, or timeout exceeded |
| `agent` | Yes | execution error, crash |
| `infra` | Yes | workspace setup failure |
| `budget` | No | cost limit exhausted |
| `blocked` | No | `CANNOT_PROCEED` or orchestrator cancel |

**Stall detection:** log mtime. Warn → kill (process group). Per-step timeout.
Crash detection: `kill(pid,0)`.

**Resume:** `--resume` finds latest run. Resets non-terminal states.
Config reconciliation if DAG changed. Success untouched.

**classifyResult:** single function. CANNOT_PROCEED → blocked.
RETRY_HINT → extracted for successor. SDK failures → mapped.

## Agent-First

**CANNOT_PROCEED** — agent signals it can't continue. Non-retryable.
Reason extracted for orchestrator.

**RETRY_HINT** — agent advises its successor. Auto-included in retry prompt.
Self-healing without orchestrator intervention.

**Hints to running agents** — orchestrator writes `commands.json` → engine
writes hint to workdir → worker injects via `executor.resume` on next turn.
Types: guidance, context, warning, critical, cancel.

**Health** — computed per-step: healthy/warning/critical/unknown.

**Orchestrator** — prompt ships with engine. Playbook: diagnose failures,
handle decomposition, optimize from history, manage cost.

**The closed loop:**
```
Agent fails → RETRY_HINT → smarter retry
Agent stuck → CANNOT_PROCEED → orchestrator fixes config
Orchestrator → hint → running agent adjusts
Run completes → report → config optimized for next run
```

**Review loops:** Draft → review → improve → verify. Template in `engine init`.

**Agent quality gates:** Judgment-based checks. Catches what tests miss.

**Dynamic decomposition:** Agent recommends split. Orchestrator restructures.

**Self-optimizing:** Orchestrator tunes config from historical reports.

## Observability

| Channel | Format | Updated | Audience |
|---|---|---|---|
| State file | JSON | 30s + completion | Orchestrator (jq) |
| Pipeline log | JSONL | Real-time | Machine queries |
| Step logs | Text | Real-time (worker) | Debug, stall |
| Report | Markdown | Per run (appended) | Human |

**Observer** — discriminated union (`EngineEvent`). Backward-compatible.
Implementations: FileLog (JSONL), Report, Inline (TTY default),
Stdout (CI), Tmux, Web (self-contained HTML dashboard).

**Completion report:**
```
## Run 1 — PARTIAL (5/8) | 45t | $6.75
  ✓ review      8t  $1.20
  ✗ merge-A     FAILED (3 attempts, $11.70)
    #1 shell "git merge" → conflict
    #2 sdk sonnet 30t → agent error
    #3 sdk opus 60t → timeout
## Run 2 — COMPLETE (8/8) | Cumulative: 76t | $10.95
```

**SDK auto-detection:** scan `@agent-engine/*/package.json`.
One → auto-select. Multiple → require flag.

## Operations

**Credentials:** `preflight()` for executor. `requires:` for workspace.
Engine has zero credential logic. Optional `.agent-engine/.env`.

**Security:** File permissions (600/700). Never log values. `.gitignore`.
Budget caps. Process isolation.

**Compatibility:** Options objects. Union events. Versioned formats.
Additive YAML. String executor keys.

**Scaling:**
```
Local:  1000 workers → ~15ms/iter. <2% tick.
NFS:    batched readdir. Stat for stalls only.
Multi:  change spawn. Zero engine changes.
```

**Cleanup:** `cleanStale()` on startup. `engine cleanup` CLI.

## Project Structure

```
@agent-engine/core       zero deps — scheduler, runner, state, observers, CLI
@agent-engine/claude     Claude executor + worker + onboarding
@agent-engine/openai     OpenAI executor + tools + worker
@agent-engine/google     Google executor + tools + worker
```
One install: `npm install @agent-engine/claude` → `npx agent-engine run`.
Core ships shell/mock executors, git workspace, `tokensToCost()`.

## DAG Parser

Desugar functions as extension point. `steps:` → sequential. `parallel:` → parallel.
`depends_on` → DAG. `branch:` → merge+verify (via git desugar). Parser is agnostic.

```typescript
type Desugar = (steps: StepSpec[]) => StepSpec[];
function parseConfig(raw: RawConfig, desugars?: Desugar[]): ParsedConfig;
```

## Implementation

**Keep:** Scheduler (29 tests), DAG parser (38 tests), observer pattern (12 tests),
state atomics, E2E (9 tests).

**Restructure:** Handlers → StepExecutor. Phase 1/2 → poll loop.
`maxRetries` → `maxAttempts`. In-process → workers. `groups:` → `steps:`.

**Build:**

| Component | Est |
|---|---|
| StepExecutor + executors (shell, claude, mock) | 100 |
| Resource pool (slots + budgets) | 40 |
| Workers (spawn, process groups, default per SDK) | 110 |
| Engine loop (batched I/O, crash, stall, timeout) | 100 |
| Hints, commands, config watching | 90 |
| classifyResult, escalation, RetryContext | 90 |
| Observers (JSONL, Report, Inline, Tmux, Web) | 250 |
| CLI (multi-mode, validate, init, cleanup, dashboard) | 170 |
| Labels, health, output flow, desugar | 100 |
| Prompt composition (engine context, skills loading) | 50 |
| Prompt library + orchestrator prompt + setup guide | 230 |
| Workflow configs + documentation | 160 |

**Tests:** Unit (pure functions), integration (workers, I/O), E2E (mock executor),
contract (serialization), smoke (real SDK).

**Delete:** handlers.ts, Phase 1/2 loop, Promise.race, stallKilled,
runAgentWithInlinePrompt, git in engine, `groups:` keyword.
