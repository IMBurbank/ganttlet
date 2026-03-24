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

**Level 0 — no config:**
```bash
npx engine run --prompt "fix the failing tests in src/auth"
```

**Level 1 — prompt files:**
```bash
npx engine run review.md implement.md test.md
```

**Level 2 — simple YAML:**
```yaml
steps:
  - prompt: review.md
  - prompt: implement.md
  - prompt: test.md
    depends_on: [implement]
```

**Level 3 — full YAML:**
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

### `engine init`
Generates starter `config.yaml` + `prompts/` with templates.

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

```typescript
interface StepExecutor {
  // Run an attempt. Returns when complete.
  execute(attempt: Attempt, workdir: string, logFile: string): Promise<AttemptResult>;

  // Optional: resume a session with a new message (enables hint injection).
  // If not implemented, hints are deferred to the next attempt.
  resume?(sessionId: string, message: string, workdir: string, logFile: string): Promise<AttemptResult>;
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

```typescript
interface Observer {
  onPipelineStart(run: RunIdentity): void;
  onNodeStart(id: string, node: DAGNode): void;
  onNodeComplete(id: string, state: NodeState): void;
  onStall(id: string, idleSeconds: number, severity: 'warning' | 'critical'): void;
  onDagChanged(dag: DAGNode[]): void;
  onError(context: string, error: string): void;
  onPipelineComplete(state: PipelineState): void;
}
```

Implementations: FileLog (always), Report (always), Stdout (--ci), Tmux (--watch).

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
- [ ] `steps:` shorthand with ID inference

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
