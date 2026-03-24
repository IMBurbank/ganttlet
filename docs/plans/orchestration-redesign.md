# Agent Orchestration Engine

**Date:** 2026-03-24
**Status:** v13 — runner-agnostic core, StepExecutor interface

## Problem

Build a general-purpose orchestration engine for AI agents. A single prompt should
"just work." A 40-agent pipeline should be configurable without a manual. The engine
coordinates work — it doesn't know or care what executes it. Claude, OpenAI, shell
commands, human tasks: all plug in through the same interface.

## Principles

1. **The engine never executes work.** It schedules, dispatches, monitors, and records.
   Workers execute. The engine is one process. Workers are N processes.

2. **State is files.** State, logs, config, commands, results — all files. Any process
   can read them. Works on shared filesystems for multi-machine with zero code changes.

3. **Pure scheduling.** `(dag, state) → (actions, newState)`. Level-triggered
   reconciliation. Never misses an event. (K8s controller pattern.)

4. **Steps are attempt sequences.** Try something cheap, if it fails try something
   capable. Shell → agent → better agent is the same pattern as agent → more turns →
   better model.

5. **Resources are named pools.** Slots (concurrency) and budgets (cost caps).
   No hardcoded concurrency logic.

6. **Config is live.** Engine watches the config file. Changes picked up within seconds.
   (K8s desired-state pattern.)

7. **Runner-agnostic.** The engine defines a `StepExecutor` interface. Claude is one
   implementation. The engine has zero external dependencies beyond Node built-ins.

8. **Three-tier supervision.** Engine handles recoverable failures. Orchestrator handles
   unrecoverable failures. Human reviews the result.

9. **Observable by default.** Attempt history, live state, cumulative reports.
   Log files are the event stream AND the IPC channel.

## Progressive UX

Simple things are simple, complex things are possible.

**Level 0 — one command, no config, no files:**
```bash
npx @agent-engine/claude --prompt "fix the failing tests in src/auth"
```
npx downloads the package. One agent runs. Result printed. Done.
If API key not set: clear error with link to get one.

**Level 1 — prompt files, sequential:**
```bash
npx agent-engine run review.md implement.md test.md
```
Three agents, sequential (argument order). IDs from filenames.

**Level 2 — simple YAML with inline prompts:**
```yaml
steps:
  - prompt: "Review src/ for bugs and security issues"
  - prompt: "Fix the issues found in the review"
  - prompt: "Run tests and verify everything passes"
```
Sequential by default (`steps:` implies each depends on previous).
Inline prompts — no prompt files needed. IDs auto-generated.
For parallel within `steps:`, use `parallel:` blocks:
```yaml
steps:
  - parallel:
    - prompt: "Review for bugs"
    - prompt: "Review for security"
    - prompt: "Review for performance"
  - prompt: "Fix the issues found above"
```
For full DAG control, use `groups:` (Level 3).

**Level 3 — full YAML (DAG, resources, branches):**
```yaml
phase: my-project
resources:
  api: 10
  cost_usd: 50.00
groups:
  - id: feature-A
    prompt: feature-a.md
    branch: feature/A
    max_attempts: 3
    attempts:
      - executor: shell
        command: "npm test"
      - executor: sdk
        model: claude-opus-4-6
        max_turns: 60
```

### Sane defaults
```
model:               claude-sonnet-4-6
maxTurns:            30
maxAttempts:         2
resources:           [api]
api concurrency:     5
timeoutSeconds:      1800
stallWarnSeconds:    120
stallAbandonSeconds: 600
```

### `steps:` shorthand
`steps:` desugars into `groups:` with defaults. IDs inferred from prompt filenames.

### Project directory
Engine files live in `.agent-engine/` (like `.github/`):
```
.agent-engine/
  config.yaml              # workflow config
  prompts/                 # agent prompts
  logs/                    # pipeline-state.json, reports, step logs
```
`engine run` looks for `.agent-engine/config.yaml` by default. Explicit path overrides.
Add `.agent-engine/logs/` to `.gitignore`.

### `engine init`
For humans. Detects installed SDK, checks API key, creates `.agent-engine/` with
starter `config.yaml` + `prompts/`.

### `engine validate`
For agents and humans. Validates config without running — critical for agent setup
workflows where the agent generates config and needs fast feedback:
```bash
$ npx agent-engine validate config.yaml
✓ Valid (3 steps, 0 branches)
⚠ No resources.cost_usd — no budget cap
ℹ Estimated: 3 steps × 30 turns × ~$0.10/turn = ~$9.00
```

### Validation errors (agent-actionable)

Every error tells the agent WHAT, WHERE, and HOW TO FIX:
- `Step "B" depends on "X" which doesn't exist. Available: A, C, D`
- `Prompt "review.md" not found at /abs/path. Create the file or fix the path.`
- `Step "A" uses resource "merge_lock" not in resources. Add: resources: { merge_lock: 1 }`
- `Unknown field "timout_seconds" — did you mean "timeout_seconds"?`
- `Prompt contains {SKILL} but step has no prompt_vars.SKILL`

`--json` flag outputs structured errors for programmatic consumption:
```json
{ "type": "missing_dependency", "step": "B", "value": "X",
  "available": ["A","C","D"], "fix": "Change depends_on to existing step ID" }
```

### Agent-assisted setup
A setup guide (`prompts/setup-guide.md`) ships with the engine, written FOR agents.
When a user says "set up a workflow," their agent:
1. Reads the guide
2. Installs the package (`npm install @agent-engine/claude`)
3. Analyzes the project (language, tests, structure)
4. Writes `config.yaml` + prompt files directly (doesn't use `init`)
5. Validates with `engine validate`
6. Runs the pipeline

### JSON schema
`schema/config.schema.json` published with the package. Enables agent
self-validation and VS Code autocomplete for YAML editing.

### Prompt templates
`prompts/templates/` ships with the engine: `review.md`, `implement.md`,
`fix.md`, `refactor.md`. These show the STRUCTURE of a good prompt — agents
read them and customize for the project.

## Agent-First Conventions

### `CANNOT_PROCEED`
Agent output contains `CANNOT_PROCEED: <reason>`. Classified as `blocked`
(non-retryable). Orchestrator reads reason, fixes root cause.

### `RETRY_HINT`
Agent output contains `RETRY_HINT: <advice>`. Extracted by worker, stored in
result, included in next attempt's prompt automatically. Failed agent directly
helps its successor — no orchestrator needed for self-diagnosable failures.

### Hints to running agents
Orchestrator writes hint file → engine writes to worker's workdir → worker detects
on next turn → injects as conversation message via executor's `resume` capability.
If executor doesn't support resume, hints are deferred to next attempt.

```typescript
interface AgentHint {
  type: 'guidance' | 'context' | 'warning' | 'critical' | 'cancel';
  message: string;
  source?: string;
}
```

### Orchestrator prompt
Ships with the engine. Instructions for an agent to manage the pipeline using
files (state, logs, commands, config). The "agent API" counterpart to the CLI.

## Architecture

```
Config (YAML)           Commands              State File
  │ (watched)             │ (consumed)           │ (written by engine)
  ▼                       ▼                      ▼
┌──────────────────────────────────────────────────────────┐
│                         Engine                            │
│               (scheduler + dispatcher)                    │
│                                                          │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐            │
│  │ Scheduler │  │ Resource  │  │ Observer │            │
│  │ (pure)    │  │ Pool      │  │ (composite)│           │
│  └───────────┘  └───────────┘  └──────────┘            │
│                                                          │
│  Main loop:                                              │
│    1. Monitor workers (completions, crashes, stalls)     │
│    2. Process signals (commands, config, hints)          │
│    3. Save state (throttled)                             │
│    4. Run scheduler (pure)                               │
│    5. Dispatch ready steps (resource-aware)              │
│    6. Sleep 1s                                           │
└──────────────┬───────────────────────────────────────────┘
               │ spawn (setsid)
               ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ Worker                   │  │ Worker                   │
│                          │  │                          │
│ reads: step-config.json  │  │ reads: step-config.json  │
│ uses: StepExecutor       │  │ uses: StepExecutor       │
│ writes: {id}.log         │  │ writes: {id}.log         │
│ writes: {id}-result.json │  │ writes: {id}-result.json │
│ exits                    │  │ exits                    │
└──────────────────────────┘  └──────────────────────────┘
```

## 1. StepExecutor Interface

The engine's only extension point for execution. The engine never imports an SDK.
Uses options object pattern for forward-compatible evolution — new fields in
`ExecutionContext` are optional, existing executors don't break.

```typescript
interface ExecutionContext {
  workdir: string;
  logFile: string;
  // Future additions (all optional — backward compatible):
  // signal?: AbortSignal;
  // env?: Record<string, string>;
  // onProgress?: (percent: number) => void;
}

interface StepExecutor {
  // Run an attempt. Returns when complete.
  execute(attempt: Attempt, context: ExecutionContext): Promise<AttemptResult>;

  // Optional: resume a session with a new message (enables hint injection).
  // If not implemented, hints are deferred to the next attempt.
  resume?(sessionId: string, message: string, context: ExecutionContext): Promise<AttemptResult>;
}

interface AttemptResult {
  status: 'success' | 'failure';
  output: string | null;
  costUsd: number;
  turns: number;
  sessionId: string | null;
  failureMode: string;        // executor-specific, mapped by classifyResult
}
```

Reference implementations (ship with this project, not the engine):

| Executor | Dependency | `resume` | Purpose |
|---|---|---|---|
| `ShellExecutor` | node:child_process | No | Run commands |
| `ClaudeExecutor` | @anthropic-ai/claude-agent-sdk | Yes | Run Claude agents |
| `MockExecutor` | none | No | Testing |

The engine has **zero external dependencies** beyond Node built-ins (+ `yaml` for
config parsing). All SDK dependencies live in executor implementations.

## 2. Steps and Attempts

Every DAG node is a **step**. Every step has **attempts** tried in order.

```yaml
- id: merge-A
  attempts:
    - executor: shell
      command: "git merge --no-ff origin/feature-A"
    - executor: sdk
      prompt: resolve-merge-conflict.md
      model: claude-sonnet-4-6
      max_turns: 30
    - executor: sdk
      prompt: resolve-merge-conflict.md
      model: claude-opus-4-6
      max_turns: 60
  resources: [merge_lock]
  depends_on: [feature-A]
```

When `attempts` is omitted, generated by the escalation policy from `prompt` +
`max_attempts`. Simple configs stay simple.

### Step config (engine → worker, JSON file)

```typescript
interface StepConfig {
  version: 1;                 // bump on breaking format changes
  id: string;
  attempts: Attempt[];
  workdir: string;
  logFile: string;
  resultPath: string;
  hintPath: string;           // worker checks this for mid-execution hints
  retry: RetryContext;
  env?: Record<string, string>;
}

interface Attempt {
  number: number;
  executor: string;           // key into executor registry (not an enum — extensible)
  command?: string;
  prompt?: string;
  model?: string;
  maxTurns?: number;
  policy?: string;
  agent?: string;
  promptVars?: Record<string, string>;
  timeoutSeconds?: number;
}

interface RetryContext {
  attempt: number;            // 1-indexed
  maxAttempts: number;
  previousFailure?: FailureReason;
  previousSessionId?: string;
  previousLogFile?: string;
  retryHint?: string;         // from previous agent's RETRY_HINT
  workspacePreserved: boolean;
  adjustments?: {
    maxTurns?: number;
    model?: string;
    promptContext?: string;
  };
}
```

### Step result (worker → engine, JSON file)

```typescript
interface StepResult {
  version: 1;
  status: 'success' | 'failure';
  failureReason?: FailureReason;
  costUsd: number;
  turns: number;
  sessionId?: string;
  lastError?: string;
  retryHint?: string;
  attemptHistory: AttemptRecord[];
}

interface AttemptRecord {
  number: number;
  executor: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  status: 'success' | 'failure';
  failureReason?: FailureReason;
  costUsd: number;
  turns: number;
  sessionId?: string;
}
```

## 3. Failure Taxonomy

| FailureReason | Retryable | Meaning |
|---|---|---|
| `timeout` | Yes | max_turns, stall, or start-to-close exceeded |
| `agent` | Yes | execution error, crash |
| `infra` | Yes | workspace creation, setup failure |
| `budget` | **No** | cost limit exhausted |
| `blocked` | **No** | agent `CANNOT_PROCEED` or orchestrator cancel |

5 types. Non-retryable within a run. All reset to `blocked` on resume.

### classifyResult (in worker)

```typescript
function classifyResult(result: AttemptResult, abandoned: boolean): Partial<StepResult> {
  if (abandoned) return { status: 'failure', failureReason: 'timeout' };
  if (result.output?.includes('CANNOT_PROCEED:'))
    return { status: 'failure', failureReason: 'blocked',
             lastError: extractAfter(result.output, 'CANNOT_PROCEED:') };
  if (result.output?.includes('RETRY_HINT:'))
    // Extract hint — included in result, engine stores for next attempt
    retryHint = extractAfter(result.output, 'RETRY_HINT:');
  if (result.status === 'failure')
    return { status: 'failure', failureReason: mapFailureMode(result.failureMode) };
  return { status: 'success' };
}
```

## 4. Scheduler — IMPLEMENTED

```typescript
function nextActions(nodes, state): { actions, state }
```

Pure. Never mutates input. Level-triggered. 29 tests. Unchanged by any of the
architectural evolution — it doesn't know about execution.

## 5. Resource Pools

**Slots** (renewable): concurrency limits. Acquired on dispatch, released on completion.
**Budgets** (consumable): cumulative limits. Consumed permanently.

```yaml
resources:
  api: 10
  merge_lock: 1
  cost_usd: 50.00
```

```typescript
interface ResourcePool {
  canAcquire(slots: string[], estimatedCost?: number): boolean;
  acquire(slots: string[]): void;
  release(slots: string[]): void;
  consume(budget: string, amount: number): void;
  remaining(budget: string): number;
}
```

## 6. Engine (scheduler + dispatcher)

Simple poll loop. Does NOT execute work — spawns workers, monitors results.

**I/O model:** ONE `readdir` per iteration for completion detection. Per-worker
`stat` only for stall detection on running workers.

```typescript
while (!aborted) {
  const dirSnapshot = new Set(fs.readdirSync(run.logDir));
  processWorkers(dirSnapshot, workers, state, resourcePool, observer, options);
  processCommands(run.logDir, dirSnapshot, workers, state);
  checkConfigChanges(run.configPath, dag, state, observer);
  saveState(statePath, state);

  const { actions, state: newState } = scheduler.nextActions(dag, state.nodes);
  state.nodes = newState;
  if (actions.find(a => a.type === 'complete')) break;

  for (const action of actions.filter(a => a.type === 'execute')) {
    const node = getNode(action.nodeId);
    if (workers.has(node.id)) continue;
    if (!resourcePool.canAcquire(node.spec.resources)) continue;
    resourcePool.acquire(node.spec.resources);
    state.nodes[node.id].status = 'running';
    state.nodes[node.id].startedAt = new Date().toISOString();
    workers.set(node.id, spawnStep(node, run));
  }

  await sleep(1000);
}
```

### Worker monitoring (single pass, batched I/O)

```typescript
function processWorkers(dirSnapshot, workers, state, resourcePool, observer, options) {
  const now = Date.now();
  for (const [nodeId, worker] of workers) {
    // Completed? (set lookup, no syscall)
    if (dirSnapshot.has(`${nodeId}-result.json`)) {
      const result = JSON.parse(fs.readFileSync(worker.resultPath, 'utf-8'));
      updateNodeState(state, nodeId, result);
      resourcePool.release(worker.resources);
      resourcePool.consume('cost_usd', result.costUsd);
      workers.delete(nodeId);
      observer.onNodeComplete(nodeId, state.nodes[nodeId]);
      continue;
    }
    // Crashed? (kill(pid,0) — no filesystem)
    if (!isProcessAlive(worker.pid)) {
      handleFailure(state, nodeId, 'infra', 'worker process died');
      resourcePool.release(worker.resources);
      workers.delete(nodeId);
      continue;
    }
    // Still running — check stall + timeout (one stat)
    const logMtime = fs.statSync(worker.logFile).mtimeMs;
    const idle = (now - logMtime) / 1000;
    const elapsed = (now - worker.startedAt) / 1000;
    state.nodes[nodeId].lastEventAt = new Date(logMtime).toISOString();

    if (worker.timeoutSeconds && elapsed > worker.timeoutSeconds) {
      killWorker(worker);
      handleFailure(state, nodeId, 'timeout', `exceeded ${worker.timeoutSeconds}s`);
    } else if (idle > options.stallAbandonSeconds) {
      killWorker(worker);
      handleFailure(state, nodeId, 'timeout', `stalled ${Math.round(idle)}s`);
    } else if (idle > options.stallWarnSeconds) {
      observer.onStall(nodeId, idle, 'warning');
    }
  }
}
```

### Hints to running workers

Engine writes hint file to worker's workdir. Worker checks after each stream message.
If executor supports `resume`, hint is injected as a conversation message. Otherwise
deferred to next attempt.

```typescript
// Engine (in processCommands):
for (const h of commands.hint ?? []) {
  const worker = workers.get(h.nodeId);
  if (worker) {
    const queue = fs.existsSync(worker.hintPath)
      ? JSON.parse(fs.readFileSync(worker.hintPath, 'utf-8')) : [];
    queue.push(h);
    fs.writeFileSync(worker.hintPath, JSON.stringify(queue));
  }
}

// Worker (in stream loop):
if (fs.existsSync(config.hintPath)) {
  const hints = JSON.parse(fs.readFileSync(config.hintPath, 'utf-8'));
  fs.unlinkSync(config.hintPath);
  const cancelHint = hints.find(h => h.type === 'cancel');
  if (cancelHint) { writeFailureResult('blocked', cancelHint.message); process.exit(1); }
  if (executor.resume && sessionId) {
    const message = hints.map(formatHint).join('\n\n');
    stream = await executor.resume(sessionId, message, config.workdir, config.logFile);
  } else {
    pendingHints.push(...hints); // deferred to next attempt context
  }
}
```

## 7. Worker (`run-step.ts`)

Project-provided, not engine-provided. Imports engine types + project executors.

```typescript
// Project's worker script:
import { ShellExecutor } from './executors/shell.js';
import { ClaudeExecutor } from './executors/claude.js';
import type { StepConfig, StepExecutor, AttemptResult } from 'engine/types.js';

const executors: Record<string, StepExecutor> = {
  shell: new ShellExecutor(),
  sdk: ClaudeExecutor.create(),
};

const config: StepConfig = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const attemptHistory = [];

for (const attempt of config.attempts) {
  const executor = executors[attempt.executor];
  if (!executor) { writeFailure('infra', `unknown executor: ${attempt.executor}`); process.exit(1); }

  log(`[attempt ${attempt.number}] ${attempt.executor}`);
  const result = await executor.execute(attempt, config.workdir, config.logFile);

  attemptHistory.push({ number: attempt.number, ..., status: result.status });
  const classified = classifyResult(result, false);

  if (classified.status === 'success' || isNonRetryable(classified.failureReason)) {
    writeResult({ ...classified, attemptHistory });
    process.exit(classified.status === 'success' ? 0 : 1);
  }
}

writeResult({ status: 'failure', attemptHistory });
process.exit(1);
```

The engine spawns this script. The script imports executors. The engine never
touches executor code.

## 8. State

### NodeState

```typescript
interface NodeState {
  status: 'blocked' | 'ready' | 'running' | 'success' | 'failure' | 'skipped';
  failureReason?: FailureReason;
  attempt: number;
  maxAttempts: number;
  sessionId?: string;
  costUsd: number;
  turns: number;
  startedAt?: string;
  lastEventAt?: string;
  logFile?: string;
  lastError?: string;
  retryHint?: string;
  adjustments?: { maxTurns?: number; model?: string; promptContext?: string };
  attemptHistory: AttemptRecord[];
}
```

### State updates
On completion: append `attemptHistory`, accumulate `costUsd`/`turns`, increment
`attempt`. Runner constructs `RetryContext` from `NodeState` — scheduler never
sees retry context.

### Resume
`running` → `ready`. `skipped` → `blocked`. Non-retryable → `blocked`.
`success` → untouched. Config reconciliation if DAG changed.

## 9. Observability

| Channel | File | Updated | Audience |
|---|---|---|---|
| State file | `pipeline-state.json` | 30s + on completion | Orchestrator (jq) |
| Pipeline log | `pipeline.log` | Real-time | Debugging |
| Step logs | `{nodeId}.log` | Real-time (worker) | Deep debug, stall detection |
| Completion report | `pipeline-report.md` | On completion (appended) | Human, orchestrator |

### Observer interface

Single-method discriminated union. Adding new event types is backward-compatible —
existing observers hit their default case and ignore unknown events.

```typescript
type EngineEvent =
  | { type: 'pipeline:start'; run: RunIdentity }
  | { type: 'node:start'; id: string; node: DAGNode }
  | { type: 'node:complete'; id: string; state: NodeState }
  | { type: 'stall'; id: string; idleSeconds: number; severity: 'warning' | 'critical' }
  | { type: 'dag:changed'; dag: DAGNode[] }
  | { type: 'error'; context: string; message: string }
  | { type: 'pipeline:complete'; state: PipelineState };

interface Observer {
  onEvent(event: EngineEvent): void;
}
```

No agent-level events (workers write to log files, not observer).
Tmux tails `{nodeId}.log` directly for live activity.

Implementations:
- **FileLog** — always active (audit trail)
- **Report** — always active (completion report, appended per run)
- **Inline** — default for interactive terminals (single updating status line)
- **Stdout** — `--ci` mode (non-interactive, no cursor, Actions-compatible)
- **Tmux** — `--watch` mode (full panes per agent)

Inline observer for interactive use (when stdout is a TTY):
```
[2/5 running] review: turn 12 ($1.20) | implement: turn 8 ($0.80) | 3 waiting
```
Not the full Tmux UI — just a live status line so the user isn't staring at nothing.

### Completion report (appended per run)

```markdown
## Run 1 — 2026-03-24T08:15:00Z
PARTIAL (5/8) | 45 turns | $6.75
  ✓ review            8 turns    $1.20
  ✗ merge-A           FAILED (3 attempts, $11.70)
    #1  shell "git merge"     → conflict (0.2s, $0)
    #2  sdk sonnet 30t        → agent error (45t, $3.20)
    #3  sdk opus 60t          → timeout (60t, $8.50)

## Run 2 (resumed) — 2026-03-24T09:45:00Z
COMPLETE (8/8) | 31 turns | $4.20 | Cumulative: 76 turns | $10.95
```

## 10. DAG Parser — IMPLEMENTED (needs updates)

- `steps:` shorthand with ID inference
- `maxRetries` → `maxAttempts` (1-indexed)
- `attempts`, `resources`, `timeoutSeconds` fields
- Stage desugar: explicit `depends_on` replaces stage deps
- Desugar functions as extension point (not hardcoded)
- `branch` desugar provided by git workspace module, not the parser

```typescript
type Desugar = (groups: GroupSpec[]) => GroupSpec[];

function parseConfig(raw: RawConfig, desugars: Desugar[] = []): ParsedConfig {
  let groups = parseGroups(raw);    // steps: → groups:, ID inference, defaults
  for (const desugar of desugars) groups = desugar(groups);
  return buildDAG(groups);          // validate, detect cycles, build nodes
}
```

## 11. Project Structure

Monorepo of packages. Each SDK gets its own package with dedicated onboarding,
defaults, and configuration. The engine core has zero external dependencies.

```
@agent-engine/core               → pure engine (zero SDK deps)
  scheduler.ts                   # Pure DAG scheduler
  pipeline-runner.ts             # Main loop, worker spawning
  dag.ts                         # YAML → DAG (accepts desugars)
  resource-pool.ts               # Slots + budgets
  state.ts                       # Load, save, resume, reconcile
  cli.ts                         # CLI framework
  observers/                     # FileLog, Report, Stdout, Tmux
  executors/shell.ts             # Shell command executor (built-in)
  executors/mock.ts              # Testing executor
  workspace/git.ts               # Generic git worktree + branch desugar
  cost.ts                        # tokensToCost utility
  prompts/                       # Orchestrator prompt, fix templates
  types.ts                       # StepExecutor, StepConfig, NodeState, ...
  deps: yaml

@agent-engine/claude             → Claude executor + onboarding
  executor.ts                    # ClaudeExecutor (wraps query() + resume)
  defaults.ts                    # Models, costs, turns, escalation
  worker.ts                      # Worker script with Claude executor registered
  init/                          # npx agent-engine init templates
  deps: @agent-engine/core, @anthropic-ai/claude-agent-sdk

@agent-engine/openai             → OpenAI executor + onboarding
  executor.ts                    # OpenAIExecutor (wraps run() + Sessions)
  tools.ts                       # ShellTool executor, ApplyPatch handler
  defaults.ts                    # Models, costs, turns
  worker.ts                      # Worker script with OpenAI executor registered
  deps: @agent-engine/core, @openai/agents

@agent-engine/google             → Google executor + onboarding
  executor.ts                    # GeminiExecutor (wraps runAsync() + sessions)
  tools.ts                       # Custom FunctionTools or MCP bridge
  defaults.ts                    # Models, costs, turns
  worker.ts                      # Worker script with Google executor registered
  deps: @agent-engine/core, @google/adk

ganttlet/                        → consumer (this project)
  deps: @agent-engine/claude
  workspace/setup.ts             # WASM, SDK patch, hooks
  configs/                       # curation, phase-dev, single-issue
```

**User experience — one install, works immediately:**
```bash
npm install @agent-engine/claude     # or /openai, or /google
npx agent-engine run --prompt "fix the failing tests"
```

**Each SDK package owns:** executor implementation, default models/costs/turns,
worker script, onboarding templates, README, test suite. Changes to one SDK
don't touch others.

**Validated against competing SDKs:** StepExecutor maps cleanly to all three:
- Claude: `query()` + `resume` option
- OpenAI: `run()` + Sessions / `conversation_id`
- Google ADK: `runAsync()` + `SessionService`

Core ships `tokensToCost(model, input, output)` for executors that return
token counts instead of USD (OpenAI, Google). Claude returns USD directly.

## 12. Escalation Policy

Default policy generates attempt sequences when `attempts` not specified:

```typescript
function defaultAttempts(spec, retry): Attempt[] {
  const base = spec.maxTurns ?? 30;
  const model = spec.model ?? 'claude-sonnet-4-6';
  if (retry.attempt === 1) return [{ executor: 'sdk', model, maxTurns: base }];
  if (retry.previousFailure === 'timeout') return [{ executor: 'sdk', model, maxTurns: base * 2 }];
  if (retry.attempt >= retry.maxAttempts) return [{ executor: 'sdk', model: 'claude-opus-4-6', maxTurns: base * 2 }];
  return [{ executor: 'sdk', model, maxTurns: Math.round(base * 1.5) }];
}
```

The worker (not the policy) builds the final prompt by appending `RetryContext`:
```typescript
// In worker — policy chooses WHAT attempt, worker builds HOW to prompt it:
let prompt = readPromptFile(attempt.prompt);
if (retry.retryHint) prompt += `\n\n## Hint from previous attempt\n${retry.retryHint}`;
if (retry.adjustments?.promptContext) prompt += `\n\n## Orchestrator context\n${retry.adjustments.promptContext}`;
if (retry.attempt > 1) prompt += `\n\nAttempt ${retry.attempt}/${retry.maxAttempts}. Previous: ${retry.previousFailure}.`;
```

## 13. CLI

```bash
npx engine run --prompt "fix the failing tests"      # Level 0
npx engine run review.md implement.md                # Level 1
npx engine run config.yaml                           # Level 2-3
npx engine run config.yaml --resume                  # retry from state
npx engine run config.yaml --watch                   # + Tmux
npx engine run config.yaml --ci                      # + Stdout
npx engine run config.yaml --max-parallel 10         # api resource shorthand
npx engine run config.yaml --budget 50               # cost_usd shorthand
npx engine run config.yaml --only a,b                # subset + deps
npx engine init                                      # generate starter config
```

## Onboarding

### First-run experience

```bash
$ npm install @agent-engine/claude
$ npx agent-engine init

Welcome to Agent Engine!
  ✓ @agent-engine/claude detected
  ✗ ANTHROPIC_API_KEY not set
    Set it with: export ANTHROPIC_API_KEY=sk-ant-...

Creating:
  ✓ config.yaml — edit to define your workflow
  ✓ prompts/step1.md — your first agent prompt

Next: set your API key, edit prompts, run:
  npx agent-engine run config.yaml
```

### SDK auto-detection

CLI discovers installed executor packages. If exactly one → use it as default.
If multiple → require `--executor` flag or `executor:` in config. No manual
registration for the common case.

### Error messages are UX

Every error says what's wrong, why, and how to fix:
- `executor "sdk" not found` → `Install @agent-engine/claude to use SDK executors`
- `config.yaml not found` → `Run 'npx agent-engine init' to create one`
- `ANTHROPIC_API_KEY not set` → `Set with: export ANTHROPIC_API_KEY=sk-ant-...`
- `unknown field 'branch'` → `Install @agent-engine/core[git] or register a branch desugar`

## Compatibility

All public interfaces use patterns that allow evolution without breaking consumers.

| Interface | Pattern | Effect |
|---|---|---|
| StepExecutor | Options object (`ExecutionContext`) | New params are optional fields |
| Observer | Discriminated union (`EngineEvent`) | New events ignored by old observers |
| StepConfig/Result | `version` field | Workers validate version, engine migrates old formats |
| State file | `version` field | Resume migrates old state files |
| YAML config | Never remove fields, always default | Old configs work with new engine |
| Commands | Ignore unknown fields | New commands don't break old engines |
| Attempt.executor | String key (not enum) | New executor types don't require engine changes |

### Versioning rules

- **YAML config**: additive only. New fields have defaults. Old configs always parse.
- **StepConfig/Result**: versioned. Workers reject unknown versions with clear error.
- **State file**: versioned. Engine applies migration on `--resume` from older version.
- **Engine events**: new event types added to union. Old observers ignore via default case.
- **ExecutionContext**: new optional fields. Old executors don't see them, don't break.

## Scaling

```
Single machine:
  ≤ 10 concurrent: 16GB RAM
  ≤ 50 concurrent: 32GB RAM, symlinked node_modules
  ≤ 100 concurrent: 64GB RAM, fast SSD

Multi-machine (shared FS):
  Change spawnStep to ssh/k8s/cloud-run. Zero engine changes.

Engine overhead:
  Local: 1000 workers → ~15ms/iteration (<2% of tick)
  NFS: 1000 workers → batched readdir + per-worker stat
  State: ~200 bytes per attempt record, stringify ~20ms at 1000 nodes
```

## What Needs Building

### Keep (validated, no changes)
- Scheduler (pure, 29 tests)
- DAG parser core (38 tests) — needs field additions
- Observer pattern + composite dispatch (12 tests)
- State file atomic writes
- E2E tests (9 tests)

### Restructure
| Current | Change to |
|---|---|
| `Handlers { agent, merge, verify }` | `StepExecutor` interface |
| Phase 1/2 loop with Promise.race | Single poll loop |
| `maxRetries` | `maxAttempts` (1-indexed) |
| `maxParallel` | `resources.api` slot |
| In-process execution | Worker subprocesses (setsid) |
| `git-ops.ts` in engine | `workspace/git.ts` (project, not engine) |
| Branch desugar in parser | Desugar function from git module |

### New
| Component | Est |
|---|---|
| `StepExecutor` interface + shell/claude/mock impls | 100 |
| Resource pool (slots + budgets) | 40 |
| Worker script (project-provided) | 80 |
| Step config/result file I/O | 30 |
| Worker spawn + process group mgmt | 30 |
| Worker monitoring (batched readdir + crash detection) | 40 |
| Stall detection + start-to-close timeout | 30 |
| Hint injection (file + resume) | 40 |
| Config watching + reconciliation | 20 |
| Commands processing (cancel, adjust, hint) | 30 |
| `classifyResult` (CANNOT_PROCEED, RETRY_HINT) | 20 |
| Default escalation policy | 20 |
| ReportObserver (completion report) | 80 |
| RetryContext + attempt history | 30 |
| Tmux observer | 120 |
| CLI multi-mode (inline, files, YAML) | 40 |
| `steps:` shorthand + ID inference | 30 |
| `engine init` scaffolding | 40 |
| `engine validate` command + cost estimation | 50 |
| JSON schema for config | 60 |
| Setup guide for agents | 40 |
| Prompt templates (review, implement, fix, refactor) | 80 |
| Orchestrator prompt | 50 |
| Workflow configs (curation, phase-dev, single-issue) | 60 |
| File restructure (engine/ executors/ workspace/ project/) | 0 net |
| Tests | 150 |

### Delete
- `handlers.ts`
- Phase 1/2 loop, Promise.race, stallKilled, async IIFEs
- `runAgentWithInlinePrompt`
- Git-specific code from engine (moves to workspace/git.ts)

## Success Criteria

### UX
- [ ] `engine run --prompt "..."` works with zero config
- [ ] `engine run review.md fix.md` runs two agents sequentially
- [ ] `engine init` generates working starter config
- [ ] `engine validate` checks config without running, shows cost estimate
- [ ] `steps:` shorthand with ID inference
- [ ] JSON schema published for config autocomplete + validation
- [ ] Setup guide usable by agents for automated project setup
- [ ] Prompt templates for common patterns (review, implement, fix)

### Engine
- [ ] `StepExecutor` interface — engine has zero SDK dependencies
- [ ] Workers are subprocesses (setsid, killable)
- [ ] Resource pools: slots + budgets
- [ ] Stall detection + start-to-close timeout
- [ ] Config watching (live reconciliation)
- [ ] Commands: cancel, adjust, hint
- [ ] `--resume` recovers from any failure state
- [ ] Budget cap stops scheduling

### Agent-first
- [ ] `CANNOT_PROCEED` → `blocked`, non-retryable
- [ ] `RETRY_HINT` → extracted, stored, included in retry prompt
- [ ] Hints injected into running agents via executor resume
- [ ] Orchestrator prompt ships with engine
- [ ] Completion report with per-attempt history

### Reference implementation
- [ ] Curation config runs with one command
- [ ] Phase-dev config runs with one command
- [ ] Engine extractable with zero project dependencies
- [ ] 550+ tests, tsc clean
