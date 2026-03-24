# Agent Engine

Orchestrate AI agents in DAG workflows. One command to fix a bug.
One config file for a 40-agent pipeline.

## Principles

1. **Progressive.** One command to start. Full DAG when needed. No cliff between levels.
2. **Resilient.** Retry, escalate, resume. Agents advise their successors. Self-healing
   until external help is truly needed.
3. **Observable.** Every action recorded. Files are the interface — for humans, agents,
   and machines. JSONL for queries. Markdown for reports. Live status for terminals.
4. **Extensible.** Plug in any AI runner, workspace provider, or config pattern.
   Engine core has zero external dependencies.
5. **Agent-native.** Designed to be operated BY agents, not just run them. File-based
   IPC. Hints to running agents. Orchestrator prompt included. Three tiers:
   engine → orchestrator agent → human.

## Concepts

Three things users need to know:

**Step** — a unit of work. A prompt, a shell command, or a sequence of both
(try shell first, fall back to agent, escalate to better agent).

**Pipeline** — steps with dependencies. Defined in YAML. Sequential by default.
Parallel via `parallel:` blocks or explicit `depends_on`.

**Run** — one execution of a pipeline. Produces state (JSON), logs (JSONL + text),
and a completion report (markdown). Resumable. Cumulative across retries.

## User Experience

**Level 0** — no config:
```bash
npx @agent-engine/claude --prompt "fix the failing tests"
```

**Level 1** — prompt files:
```bash
npx agent-engine run review.md implement.md test.md
```

**Level 2** — YAML:
```yaml
steps:
  - prompt: "Review src/ for bugs"
  - prompt: "Fix the issues found"
```
Sequential by default. Inline prompts. IDs auto-generated. For parallel:
```yaml
steps:
  - parallel:
    - prompt: "Review for bugs"
    - prompt: "Review for security"
  - prompt: "Fix the issues found"
```

**Level 3** — full control (same `steps:` keyword, more fields):
```yaml
requires:
  env: [GITHUB_TOKEN]
  commands: [gh]
resources:
  api: 10
  cost_usd: 50.00
steps:
  - id: feature-A
    prompt: feature-a.md
    branch: feature/A
    labels: { role: implement }
    max_attempts: 3
    depends_on: [review]
    attempts:
      - executor: shell
        command: "npm test"
      - executor: sdk
        model: claude-opus-4-6
        max_turns: 60
```

**Defaults:**
```
model: claude-sonnet-4-6    maxTurns: 30       maxAttempts: 2
resources: [api]            api: 5             timeoutSeconds: 1800
stallWarnSeconds: 120       stallAbandonSeconds: 600
```

### Getting started
```bash
npm install @agent-engine/claude
npx agent-engine init           # .agent-engine/ with config, prompts, .env.example
npx agent-engine validate       # preflight + config + cost estimate
npx agent-engine run            # run the pipeline
npx agent-engine run --resume   # retry failed (finds latest run)
npx agent-engine cleanup        # remove stale artifacts
```

```bash
npx agent-engine run config.yaml --watch          # Tmux panes per agent
npx agent-engine run config.yaml --ci             # non-interactive stdout
npx agent-engine run config.yaml --max-parallel 10
npx agent-engine run config.yaml --budget 50
npx agent-engine run config.yaml --only a,b       # subset + transitive deps
npx agent-engine run config.yaml --executor claude # when multiple SDKs installed
```

`.agent-engine/` directory (like `.github/`):
```
.agent-engine/
  config.yaml    prompts/    .env.example    .gitignore (logs/, .env)
```

`engine validate` catches everything before spending money:
```
Preflight:  ✓ API key valid   ✗ GITHUB_TOKEN not set   ✓ gh available
Config:     ✓ Valid (3 steps)  ⚠ No budget cap
Estimate:   ~$9.00 (3 steps × 30t × $0.10/turn)
```
`--json` for agents. Every error says what, where, how to fix.

### Agent-assisted setup
Setup guide (`prompts/setup-guide.md`) ships with engine. Agent reads guide →
analyzes project → writes config + prompts → validates → runs. JSON schema
for autocomplete. Prompt templates (`review.md`, `implement.md`, `fix.md`,
`refactor.md`) show structure.

## Architecture

```
User writes config → Parser builds DAG → Scheduler resolves deps →
Engine spawns workers → Workers try attempts → Results flow back →
Engine updates state → Observers report → Complete or resume
```

```
Config (YAML)        Commands         State File
  │ watched            │ consumed       │ engine writes
  ▼                    ▼                ▼
┌─────────────────────────────────────────────┐
│                   Engine                     │
│            (scheduler + dispatcher)          │
│                                             │
│  Loop: monitor → signals → save → schedule  │
│        → dispatch → sleep 1s                │
└────────────────┬────────────────────────────┘
                 │ spawn (setsid)
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  Worker      Worker      Worker
```

### Engine loop (poll-based, batched I/O)
1. Monitor workers: ONE `readdir` for completions, `kill(pid,0)` for crashes, `stat` for stalls
2. Process signals: commands (cancel/adjust/hint), config changes (reconcile DAG live)
3. Save state (throttled 30s)
4. Run scheduler (pure: `(dag, state) → (actions, newState)`, never mutates input)
5. Dispatch: check resource pools, set `running` immediately, spawn worker
6. Sleep 1s

### Workers
Subprocesses (`setsid`). Read step config → try attempts → write log + result → exit.
Kill = `kill(-pgid)`. No orphans. Each SDK package ships a default worker.
Projects override via config.

### Steps and attempts
Every step has an ordered attempt sequence. Same abstraction for shell-with-fallback
and agent-with-escalation:
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
When `attempts` omitted, generated by escalation policy (attempt 1: base.
Timeout → double turns. Final attempt → opus). Worker appends retry context
(hint from predecessor, orchestrator adjustments, attempt number) to prompt.

### StepExecutor interface
The engine's only extension point. Options object for forward-compatible evolution:
```typescript
interface StepExecutor {
  execute(attempt: Attempt, context: ExecutionContext): Promise<AttemptResult>;
  resume?(sessionId: string, message: string, context: ExecutionContext): Promise<AttemptResult>;
  preflight?(): Promise<PreflightResult>;
}
interface ExecutionContext { workdir: string; logFile: string; /* future optional fields */ }
```
Validated against Claude SDK, OpenAI Agents SDK, Google ADK. Zero changes needed.

### Resource pools
Slots (renewable concurrency) and budgets (consumable cost):
```yaml
resources:
  api: 10           # max concurrent agents
  merge_lock: 1     # serialize merges
  cost_usd: 50.00   # pipeline budget cap
```
Budget exceeded → no new steps dispatched. Running steps finish. Pipeline completes partial.

### Labels
Key-value metadata for grouping, bulk operations, dynamic dependencies:
```yaml
- id: sched-curator
  labels: { role: curator, skill: scheduling-engine }
  depends_on:
    label: { skill: scheduling-engine, role: reviewer }
```
Selectors in `depends_on` and commands resolved at parse time.

### State
`pipeline-state.json`. Per-step: status, attempt, cost, turns, health, labels,
lastEventAt, retryHint, attemptHistory. Resume: `running→ready`, `skipped→blocked`,
non-retryable→`blocked`. Config reconciliation on DAG changes. Versioned for migration.

### Step output flow
Each step's output written to `.agent-engine/outputs/`. Dependent steps get
automatic context pointing to previous outputs. Agent reads files naturally.

## Failure and Recovery

**Failure taxonomy:**

| Reason | Retryable | Meaning |
|---|---|---|
| `timeout` | Yes | max_turns, stall, or timeout exceeded |
| `agent` | Yes | execution error, crash |
| `infra` | Yes | workspace setup failure |
| `budget` | No | cost limit exhausted |
| `blocked` | No | `CANNOT_PROCEED` or orchestrator cancel |

**Stall detection:** log file mtime. Warn at configurable threshold. Kill
(process group) at abandon threshold. `start-to-close` timeout per step.
Worker crash detection via `kill(pid,0)`.

**Resume:** `--resume` finds latest failed run. Resets: `running→ready`,
`skipped→blocked`, non-retryable→`blocked` (orchestrator fixed it).
Success nodes untouched. Config reconciliation if DAG changed.

**classifyResult** — single function, all outcomes: CANNOT_PROCEED → blocked,
RETRY_HINT → extracted for successor, SDK failures → mapped to taxonomy.

## Agent-First

**Engine context** — the worker constructs and prepends to EVERY prompt:
```markdown
# Engine Context
You are step "{id}" in an automated pipeline (attempt {attempt}/{maxAttempts}).

## Your workspace
Working directory: {workdir}
Output saved to: .agent-engine/outputs/{id}.txt

## Previous step outputs
- .agent-engine/outputs/{dep_id}.txt (for each dependency)

## Signals
- CANNOT_PROCEED: <reason> — if you cannot complete this task
- RETRY_HINT: <advice> — if you fail but have advice for a retry

## Previous attempt (if retry)
Failed with: {previousFailure}. Hint: {retryHint}. Context: {adjustments}
```
**Prompt composition (the engine is a good citizen):**

The engine references the user's existing project knowledge — it doesn't
create parallel copies. Config points to files. Engine loads them. Agnostic.

```yaml
context: project-instructions.md                # project-wide knowledge
steps:
  - prompt: implement.md
    skills: [skills/scheduling-engine.md]        # reusable domain knowledge
  - prompt: review.md
    skills: [skills/code-review.md, skills/security.md]
```

`context:` and `skills:` are just file paths. The engine loads and prepends them.
It doesn't know or care about their format — markdown, text, anything.

SDK packages may load their own project knowledge natively (e.g., Claude SDK
loads CLAUDE.md and .claude/skills/ automatically). The executor declares this
via `loadsProjectContext`, and the engine avoids duplicating what the SDK handles:

```typescript
interface StepExecutor {
  // ...
  loadsProjectContext?: boolean;  // if true, engine skips context:/skills: loading
}
```

`engine init` detects existing project knowledge and references it:
```
✓ Project instructions found — config references them automatically
✓ Skills directory found (8 skills) — use skills: in config to reference
✗ Skipping duplicate files — your project already has what agents need
```

**CANNOT_PROCEED** → `blocked` (non-retryable). Reason in lastError.

**RETRY_HINT** → extracted, stored, included in next attempt automatically.

**Default diagnosis step** — on SDK failures, the escalation policy automatically
inserts a 10-turn diagnosis agent before the retry:
```
Attempt 1: sdk sonnet 30t → task fails
Attempt 2: sdk sonnet 10t → analyze-failure (reads previous log, outputs RETRY_HINT)
Attempt 3: sdk sonnet 60t → retry with diagnosis as context
```
Collaborative debugging as a default, not an expert pattern. Skipped for shell failures.

**Hints to running agents** — orchestrator writes `commands.json` → engine writes
hint file → worker injects via `executor.resume`. Types: guidance, context,
warning, critical, cancel. If resume unsupported, deferred to next attempt.

**Health summary** — computed per-step: healthy/warning/critical/unknown.

**Orchestrator prompt** — ships with engine, includes playbook:
- Failure diagnosis (read logs, understand code, modify config)
- Decomposition (handle CANNOT_PROCEED split recommendations)
- Optimization (analyze historical reports, tune config for next run)
- Cost management (identify expensive steps, suggest cheaper routing)

**`engine init` pattern selection:**
```bash
$ npx agent-engine init
What kind of workflow?
  ❯ Simple pipeline — steps run in sequence
    Review loop — implement → review → improve → verify
    Parallel reviews — multiple agents review from different angles
    Custom — blank config
```
Patterns are DISCOVERABLE at first use, not buried in docs.

## Patterns (what's newly possible)

**The closed loop** — no other tool provides this:
```
Agent fails → RETRY_HINT → smarter retry (self-healing)
Agent stuck → CANNOT_PROCEED → orchestrator diagnoses → modifies config (self-adapting)
Orchestrator → hint → running agent adjusts (active supervision)
Run completes → report analyzed → config optimized (self-improving)
```

**Review loops:** Draft → review → improve → verify. Agents improve each other's
work through step output flow. `engine init` offers this as a template.

**Agent quality gates:** Review step using judgment. Catches what tests miss.

**Dynamic decomposition:** Agent recommends split. Orchestrator restructures config.
Engine picks up via config watching. No human needed.

**Self-optimizing:** Orchestrator analyzes historical reports. Steps always
succeeding → reduce attempts. Steps needing opus → skip sonnet. Pipeline gets
cheaper without human tuning.

## Observability

| Channel | Format | Updated | Audience |
|---|---|---|---|
| State file | JSON | 30s + completion | Orchestrator (jq) |
| Pipeline log | JSONL | Real-time | Machine queries |
| Step logs | Text | Real-time (worker) | Debug, stall detection |
| Report | Markdown | Per run (appended) | Human + orchestrator |

**Observer** — discriminated union (`EngineEvent`). Backward-compatible.
Implementations: FileLog (JSONL), Report (markdown), Inline (TTY status line — default),
Stdout (CI), Tmux (full panes), Web (self-contained HTML dashboard).

**Web dashboard** — `--dashboard` flag. Generates `dashboard.html` in logs dir.
Self-contained (embedded JS, no build step). Reads state file + JSONL via fetch.
Shows: DAG graph, timeline/Gantt, resource gauges, cost breakdown, live events.
Dev server on localhost for live view during execution. ~155 lines. Files are the API —
visualization is decoupled from the engine. VS Code extensions, Slack bots, Grafana
integrations can be built the same way (read files, no engine changes).

**Completion report** appended per run:
```
## Run 1 — PARTIAL (5/8) | 45t | $6.75
  ✓ review      8t  $1.20
  ✗ merge-A     FAILED (3 attempts, $11.70)
    #1 shell "git merge" → conflict
    #2 sdk sonnet 30t → agent error
    #3 sdk opus 60t → timeout
## Run 2 — COMPLETE (8/8) | Cumulative: 76t | $10.95
```

**SDK auto-detection** — scan `@agent-engine/*/package.json`. One → auto-select.
Multiple → require `--executor`. None → actionable error.

## Operations

**Credentials:** Executor: `preflight()` (SDK-native). Workspace: `requires:` in config.
Engine has zero credential logic. Optional `.agent-engine/.env` loading.

**Security:** `.env` 600, `logs/` 700. Never log credential values. `.gitignore` enforced.
`validate` shows commands. Budget caps. Process isolation (`setsid`).

**Compatibility:** `ExecutionContext` options object. `EngineEvent` union. Versioned
StepConfig/Result/state. YAML additive only. Commands ignore unknown. String executor keys.

**Scaling:**
```
Local:  1000 workers → ~15ms/iter. Engine <2% of tick.
NFS:    batched readdir. Per-worker stat for stalls only.
Multi:  change spawn to ssh/k8s. Zero engine changes.
```

**Cleanup:** `WorkspaceProvider.cleanStale()` on startup/resume. `engine cleanup` CLI.

## Project Structure

```
@agent-engine/core          zero deps — scheduler, runner, state, observers, CLI
@agent-engine/claude        Claude executor + worker + onboarding
@agent-engine/openai        OpenAI executor + tools + worker
@agent-engine/google        Google executor + tools + worker
ganttlet/                   consumer — configs, workspace setup
```

One install: `npm install @agent-engine/claude` → `npx agent-engine run`.
Core ships `tokensToCost()`, git workspace, shell/mock executors.

## DAG Parser

Accepts desugar functions. Git module provides `branch` desugar. Parser doesn't
know about git. `steps:` desugars: sequential by default, `parallel:` blocks,
`depends_on` for DAG. `branch:` → merge+verify steps (via registered desugar).

```typescript
type Desugar = (steps: StepSpec[]) => StepSpec[];
function parseConfig(raw: RawConfig, desugars?: Desugar[]): ParsedConfig;
```

## Implementation

**Keep:** Scheduler (29 tests), DAG parser core (38 tests), observer pattern (12 tests),
state atomics, E2E tests (9 tests).

**Restructure:** Handlers → StepExecutor. Phase 1/2 → poll loop. `maxRetries` → `maxAttempts`.
`maxParallel` → resources. In-process → workers. `groups:` → `steps:` everywhere.

**Build:**

| Component | Est |
|---|---|
| StepExecutor + shell/claude/mock executors | 100 |
| Resource pool (slots + budgets) | 40 |
| Workers (default per SDK, spawn, process groups) | 110 |
| Engine loop (batched I/O, crash, stall, timeout) | 100 |
| Hints + commands | 70 |
| Config watching + reconciliation | 20 |
| classifyResult + escalation + RetryContext | 90 |
| Observers (FileLog JSONL, Report, Inline, Tmux) | 200 |
| CLI (multi-mode, validate, init, cleanup) | 150 |
| Labels, health, step output flow | 60 |
| Steps/parallel desugar + ID inference | 50 |
| Prompt library (orchestrator, setup guide, templates) | 230 |
| Workflow configs (curation, phase-dev, single-issue) | 60 |
| Documentation (README per package, getting started, config ref) | 100 |

**Tests:**
- Unit: scheduler, parser, resource pool (pure functions)
- Integration: worker spawn/kill, file I/O, git workspace
- E2E: full pipeline with mock executor
- Contract: StepConfig/StepResult serialization
- Smoke: real SDK, simple task

**Delete:** handlers.ts, Phase 1/2 loop, Promise.race, stallKilled,
runAgentWithInlinePrompt, git-specific code in engine, `groups:` keyword.
