# Agent Engine

A general-purpose orchestration engine for AI agents. One command to fix a bug.
One config file for a 40-agent pipeline. The engine coordinates — it never
executes.

## Principles

1. **The engine never executes work.** Scheduler makes decisions. Workers execute.
   One process schedules. N processes work. (K8s, Temporal, Airflow.)
2. **State is files.** State, logs, config, commands, results. Any process reads them.
   Shared filesystem → multi-machine with zero code changes.
3. **Pure scheduling.** `(dag, state) → (actions, newState)`. Level-triggered
   reconciliation. Never misses an event.
4. **Steps are attempt sequences.** Shell → agent → better agent. Same pattern as
   agent → more turns → better model. One abstraction for all escalation.
5. **Resources are named pools.** Slots (concurrency) and budgets (cost caps).
6. **Config is live.** Engine watches the file. Changes within seconds. No restart.
7. **Runner-agnostic.** `StepExecutor` interface. Claude, OpenAI, Google, shell — all
   plug in. Engine has zero SDK dependencies.
8. **Three-tier supervision.** Engine → orchestrator agent → human. Each handles
   what it's best at.
9. **Observable by default.** JSONL event log, live state, cumulative reports, health
   summary. Log files are the event stream AND the IPC channel.
10. **Progressive UX.** Zero config → inline YAML → full DAG. Sane defaults. No cliff.

## User Experience

### Four levels

**Level 0** — one command, no config:
```bash
npx @agent-engine/claude --prompt "fix the failing tests"
```

**Level 1** — prompt files, sequential:
```bash
npx agent-engine run review.md implement.md test.md
```

**Level 2** — simple YAML:
```yaml
steps:
  - prompt: "Review src/ for bugs"
  - prompt: "Fix the issues found"
  - prompt: "Run tests and verify"
```
Sequential by default. Inline prompts. IDs auto-generated. For parallel:
```yaml
steps:
  - parallel:
    - prompt: "Review for bugs"
    - prompt: "Review for security"
  - prompt: "Fix the issues found"
```

**Level 3** — full DAG:
```yaml
phase: my-project
requires:
  env: [GITHUB_TOKEN]
  commands: [gh]
resources:
  api: 10
  cost_usd: 50.00
groups:
  - id: feature-A
    prompt: feature-a.md
    branch: feature/A
    labels: { role: implement }
    max_attempts: 3
```

### Defaults
```
model: claude-sonnet-4-6    maxTurns: 30    maxAttempts: 2
resources: [api]            api: 5          timeoutSeconds: 1800
stallWarnSeconds: 120       stallAbandonSeconds: 600
```

### Getting started
```bash
npm install @agent-engine/claude
npx agent-engine init           # creates .agent-engine/ with config, prompts, .env.example
npx agent-engine validate       # preflight + config check + cost estimate
npx agent-engine run            # run the pipeline
npx agent-engine run --resume   # retry failed steps (finds latest run)
npx agent-engine cleanup        # remove stale artifacts
```

`engine init` detects installed SDK, checks API key, creates `.agent-engine/`:
```
.agent-engine/
  config.yaml       prompts/       .env.example       .gitignore (logs/, .env)
```

**CLI flags:**
```bash
npx agent-engine run config.yaml --watch          # Tmux panes per agent
npx agent-engine run config.yaml --ci             # non-interactive stdout
npx agent-engine run config.yaml --max-parallel 10
npx agent-engine run config.yaml --budget 50
npx agent-engine run config.yaml --only a,b       # subset + transitive deps
npx agent-engine run config.yaml --executor claude # when multiple SDKs installed
```

`engine validate` catches everything before spending money:
```
Preflight:  ✓ API key valid   ✗ GITHUB_TOKEN not set   ✓ gh available
Config:     ✓ Valid (3 steps)  ⚠ No budget cap
Estimate:   ~$9.00 (3 steps × 30 turns × $0.10/turn)
```
`--json` for agent consumption. Every error says what, where, how to fix.

### Agent-assisted setup
Setup guide ships with the engine (`prompts/setup-guide.md`). Agent reads guide →
analyzes project → writes config + prompts → validates → runs. JSON schema
(`schema/config.schema.json`) enables autocomplete and self-validation. Prompt
templates (`review.md`, `implement.md`, `fix.md`, `refactor.md`) show structure.

## Architecture

```
Config (YAML)        Commands         State File
  │ watched            │ consumed       │ written by engine
  ▼                    ▼                ▼
┌─────────────────────────────────────────────┐
│                   Engine                     │
│            (scheduler + dispatcher)          │
│                                             │
│  Scheduler (pure) → Resource Pool → Observer│
│                                             │
│  Loop: monitor → signals → save → schedule  │
│        → dispatch → sleep 1s                │
└────────────────┬────────────────────────────┘
                 │ spawn (setsid)
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  Worker      Worker      Worker
  (StepExecutor)
```

### Core concepts

**StepExecutor** — the engine's only extension point. Options object for
forward-compatible evolution:

```typescript
interface StepExecutor {
  execute(attempt: Attempt, context: ExecutionContext): Promise<AttemptResult>;
  resume?(sessionId: string, message: string, context: ExecutionContext): Promise<AttemptResult>;
  preflight?(): Promise<PreflightResult>;
}
interface ExecutionContext { workdir: string; logFile: string; /* future optional fields */ }
```

Validated against Claude SDK (`query` + `resume`), OpenAI Agents SDK
(`run` + Sessions), Google ADK (`runAsync` + `SessionService`). Zero interface
changes needed for any of them.

**Steps and attempts** — every DAG node is a step with an ordered attempt sequence:
```yaml
- id: merge-A
  attempts:
    - executor: shell
      command: "git merge --no-ff origin/feature-A"
    - executor: sdk
      prompt: resolve-conflict.md
      model: claude-sonnet-4-6
    - executor: sdk
      prompt: resolve-conflict.md
      model: claude-opus-4-6
```
When `attempts` omitted, generated by escalation policy. Simple configs stay simple.

**Labels** — key-value metadata for grouping, bulk operations, dynamic dependencies:
```yaml
- id: sched-curator
  labels: { role: curator, skill: scheduling-engine }
  depends_on:
    label: { skill: scheduling-engine, role: reviewer }
```
Selectors in `depends_on` and `commands` resolved at parse time.

**Resource pools** — slots (renewable concurrency) and budgets (consumable cost):
```yaml
resources:
  api: 10           # max concurrent agents
  merge_lock: 1     # serialize merges
  cost_usd: 50.00   # pipeline budget cap
```

**Scheduler** — pure function. `(dag, state) → (actions, newState)`. Never mutates
input. Level-triggered. Failure taxonomy determines retryability:

| Reason | Retryable | Meaning |
|---|---|---|
| `timeout` | Yes | max_turns, stall, or timeout exceeded |
| `agent` | Yes | execution error, crash |
| `infra` | Yes | workspace setup failure |
| `budget` | No | cost limit exhausted |
| `blocked` | No | `CANNOT_PROCEED` or orchestrator cancel |

**Engine loop** — poll-based, batched I/O:
1. Monitor workers: ONE `readdir` for completions (set lookup), `kill(pid,0)` for crashes, `stat` for stalls
2. Process signals: commands (cancel/adjust/hint), config changes (reconcile DAG)
3. Save state (throttled 30s)
4. Run scheduler
5. Dispatch: resource-aware, set `running` immediately (no redundant actions)
6. Sleep 1s

**Workers** — subprocesses (`setsid`). Each SDK package ships a default worker.
Read step config → try attempts in order → write log + result → exit.
Kill = `kill(-pgid)`. No orphans. Projects override via `engine.worker` in config.

**State** — `pipeline-state.json`. Per-node: `status`, `attempt`, `costUsd`,
`turns`, `health`, `labels`, `lastEventAt`, `retryHint`, `attemptHistory`.
Resume: `running→ready`, `skipped→blocked`, non-retryable→`blocked`. Config
reconciliation on DAG changes. Version field for migration.

**Step output flow** — each step's output written to `.agent-engine/outputs/`.
Dependent steps get automatic context pointing to previous outputs. Agent reads
files naturally. Automatic for `steps:` mode.

## Agent-First

**CANNOT_PROCEED** — agent output contains this marker → `blocked` (non-retryable).
Reason extracted and stored in `lastError`. Orchestrator reads and fixes.

**RETRY_HINT** — agent advises its successor. Extracted by worker, stored in result,
included in next attempt's prompt automatically. Self-healing without orchestrator.

**Hints to running agents** — orchestrator writes `commands.json` with hint →
engine writes hint file to worker's workdir → worker detects on next turn →
injects as conversation message via `executor.resume`. If executor doesn't support
resume, deferred to next attempt. Types: guidance, context, warning, critical, cancel.

**Health summary** — computed `health` field on each state save: healthy/warning/
critical/unknown. Orchestrator checks one field: `jq '.nodes[] | select(.health == "warning")'`.

**Orchestrator prompt** — ships with engine. Instructions for an agent to manage
the pipeline using files (state, logs, commands, config).

**Escalation policy** — generates attempt sequences when `attempts` omitted:
attempt 1: base model/turns. Timeout → double turns. Final attempt → opus.
Worker appends `RetryContext` (hint, adjustments, attempt number) to prompt.

## Observability

**Four channels:**

| Channel | Format | Updated | Audience |
|---|---|---|---|
| State file | JSON | 30s + completion | Orchestrator (jq) |
| Pipeline log | JSONL | Real-time | Machine queries (grep+jq) |
| Step logs | Text | Real-time (worker) | Debugging, stall detection |
| Completion report | Markdown | Per run (appended) | Human + orchestrator |

**Observer** — discriminated union (`EngineEvent`). Adding events is backward-compatible.
Implementations: FileLog (JSONL), Report (markdown), Inline (TTY status line),
Stdout (CI), Tmux (full panes). Inline is default for interactive terminals.

**Completion report** appended per run:
```
## Run 1 — PARTIAL (5/8) | 45 turns | $6.75
  ✓ review        8t  $1.20
  ✗ merge-A       FAILED (3 attempts, $11.70)
    #1 shell "git merge" → conflict
    #2 sdk sonnet 30t → agent error
    #3 sdk opus 60t → timeout
## Run 2 — COMPLETE (8/8) | Cumulative: 76t | $10.95
```

**SDK auto-detection** — scan `@agent-engine/*/package.json` for executor field.
One → auto-select. Multiple → require flag. None → actionable error.

## Operations

### Credentials
Executor credentials: `executor.preflight()` (SDK-native discovery).
Workspace credentials: `requires:` in config (env vars, commands).
Engine core has zero credential logic. Optional `loadProjectEnv()` reads `.agent-engine/.env`.

### Security
File permissions: `.env` 600, `logs/` 700. Credential masking: never log values.
`.gitignore` enforced. Config transparency: `validate` shows commands. Budget caps.
Process isolation (`setsid`).

### Compatibility
`ExecutionContext` options object → new params optional. `EngineEvent` union → new
events ignored. `StepConfig/Result` versioned. State file versioned + migration.
YAML additive only. Commands ignore unknown. `Attempt.executor` string keys.

### Scaling
```
Local:  1000 workers → ~15ms/iteration. Engine <2% of tick.
NFS:    batched readdir. Per-worker stat for stalls only.
Multi:  change spawn to ssh/k8s. Zero engine changes.
Growth: ~200 bytes per attempt record. 1000×10 = 2MB state.
```

### Cleanup
`WorkspaceProvider.cleanStale()` on startup/resume. `engine cleanup` CLI for manual.

## Project Structure

```
@agent-engine/core          zero deps — scheduler, runner, state, observers, CLI, git workspace
@agent-engine/claude        Claude executor + defaults + worker + onboarding
@agent-engine/openai        OpenAI executor + tools + defaults + worker
@agent-engine/google        Google executor + tools + defaults + worker
ganttlet/                   consumer — configs, project-specific setup
```

Each SDK: own executor, defaults, worker, init templates, README, tests.
One install works: `npm install @agent-engine/claude` → `npx agent-engine run`.
Core ships `tokensToCost()` for executors returning tokens not USD.

## DAG Parser

Accepts desugar functions as extension point. Git module provides branch desugar
(merge + verify steps with attempt sequences). Parser doesn't know about git.

```typescript
type Desugar = (groups: GroupSpec[]) => GroupSpec[];
function parseConfig(raw: RawConfig, desugars: Desugar[] = []): ParsedConfig;
```

`steps:` desugars to sequential `groups:`. `parallel:` blocks desugar to parallel
groups. `branch:` desugars to merge+verify steps (via registered desugar).

## What Needs Building

**Keep:** Scheduler (29 tests), DAG parser core (38 tests), observer pattern (12 tests),
state atomics, E2E tests (9 tests). ~533 existing tests.

**Restructure:** Handlers → StepExecutor. Phase 1/2 → poll loop. maxRetries → maxAttempts.
maxParallel → resources. In-process → workers. git-ops → workspace/git.

**New:**

| Component | Est |
|---|---|
| StepExecutor + shell/claude/mock executors | 100 |
| Resource pool (slots + budgets) | 40 |
| Worker (default per SDK package) | 80 |
| Engine loop (batched I/O, crash detection, stall, timeout) | 100 |
| Hint injection + commands processing | 70 |
| Config watching + reconciliation | 20 |
| classifyResult (CANNOT_PROCEED, RETRY_HINT) | 20 |
| Escalation policy + RetryContext | 50 |
| Observers: FileLog (JSONL), Report, Inline, Tmux | 200 |
| CLI (multi-mode, validate, init, cleanup) | 150 |
| Labels + health computation | 45 |
| Steps/parallel desugar + ID inference | 50 |
| JSON schema, setup guide, prompt templates, orchestrator prompt | 230 |
| Workflow configs (curation, phase-dev, single-issue) | 60 |
| Documentation (README per package, getting started, config ref) | 100 |
| Tests | 200 |

**Delete:** handlers.ts, Phase 1/2 loop, Promise.race, stallKilled,
runAgentWithInlinePrompt, git-specific code in engine.
