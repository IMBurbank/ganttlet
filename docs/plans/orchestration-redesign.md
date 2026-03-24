# Agent Orchestration Engine

**Date:** 2026-03-24
**Status:** v11 — worker model, resource pools, unified execution strategy

## Problem

Build a general-purpose agent orchestration engine. It runs DAGs of steps — shell
commands, SDK agent sessions, or sequences of both — with automatic retry, capability
escalation, cost tracking, and observable state. It must work for any workflow (curation,
feature development, deployment) and scale from 5 concurrent steps to 100+ on one machine
with a clear path to multi-machine via shared filesystem.

## Principles

1. **The scheduler never executes work.** The scheduler makes decisions. Workers execute
   steps. The scheduler is one process. Workers are N processes. (K8s, Temporal, Airflow
   all do this.)

2. **State is files.** State file, log files, config file, commands file, result files.
   Any process can read them. The scheduler is the only state file writer. Files work on
   shared filesystems (NFS/EFS) — multi-machine with zero code changes.

3. **Pure scheduling.** Scheduler is a pure function: `(dag, state) → (actions, newState)`.
   Level-triggered reconciliation — re-derives full diff each iteration, never misses an
   event. (K8s controller pattern.)

4. **Steps are attempt sequences.** A step tries attempts in order (shell → agent → better
   agent). "Script with fallback" and "agent with escalation" are the same pattern: try
   something, if it fails, try something more capable.

5. **Resources are named pools.** Slots (renewable: concurrency limits) and budgets
   (consumable: cost caps). The engine never hardcodes concurrency logic — it checks pools.

6. **Config is the live source of truth.** The engine watches the config file. Changes are
   picked up within 30 seconds — no restart needed. (K8s desired-state pattern.)

7. **Three-tier supervision.** Pipeline handles recoverable failures (retry + escalate).
   Orchestrator handles unrecoverable failures (diagnose + fix + modify config).
   Human reviews the final result.

8. **Observable by default.** Every step records attempt history. State file updated every
   30 seconds. Completion report persisted and cumulative. Log files are the real-time
   event stream AND the IPC channel between workers and scheduler.

## Architecture

```
Config (YAML)           Commands              State File
  │ (watched)             │ (consumed)           │ (written by scheduler)
  ▼                       ▼                      ▼
┌──────────────────────────────────────────────────────────┐
│                    Pipeline Runner                        │
│                  (scheduler + dispatcher)                 │
│                                                          │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐            │
│  │ Scheduler │  │ Resource  │  │ Observer │            │
│  │ (pure)    │  │ Pool      │  │ (composite)│           │
│  └───────────┘  └───────────┘  └──────────┘            │
│                                                          │
│  Main loop:                                              │
│    1. Check completions (result files)                   │
│    2. Check stalls (log file mtimes)                     │
│    3. Process commands (commands.json)                   │
│    4. Check config changes (mtime)                       │
│    5. Run scheduler (pure)                               │
│    6. Dispatch ready steps (spawn workers)               │
│    7. Save state                                         │
│    8. Sleep 1s                                           │
└──────────────┬───────────────────────────────────────────┘
               │ spawn (setsid)
               ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ Step Worker              │  │ Step Worker              │
│                          │  │                          │
│ reads: step-config.json  │  │ reads: step-config.json  │
│ tries: attempt sequence  │  │ tries: attempt sequence  │
│ writes: {id}.log         │  │ writes: {id}.log         │
│ writes: {id}-result.json │  │ writes: {id}-result.json │
│ exits                    │  │ exits                    │
└──────────────────────────┘  └──────────────────────────┘
```

Workers are subprocesses (setsid for process group isolation).
Kill = `kill(-pgid)`. No orphans. No `stallKilled` guards.
Multi-machine = change spawn from local to `ssh remote ...` (shared FS).

## 1. Steps and Attempts

Every node in the DAG is a **step**. Every step has an ordered sequence of **attempts**.
Each attempt has an **executor** (shell or sdk) and configuration. The step tries attempts
in order until one succeeds or all are exhausted.

```yaml
# A merge step: try shell first, fall back to agent
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

# An agent step: escalation across attempts
- id: feature-A
  prompt: implement-feature.md
  max_attempts: 3
  resources: [api]
  # Default attempt sequence (generated by escalation policy):
  #   attempt 1: sdk sonnet 30t
  #   attempt 2: sdk sonnet 60t (if timeout)
  #   attempt 3: sdk opus 60t (final attempt)
```

When `attempts` is not specified, the engine generates a default sequence from the
escalation policy + `prompt` + `max_attempts`. Simple configs stay simple:

```yaml
- id: review-accuracy
  prompt: reviewer-template.md
  prompt_vars: { SKILL: scheduling-engine, ANGLE: accuracy }
  resources: [api]
```

### Step config (written by scheduler, read by worker)

```typescript
interface StepConfig {
  id: string;
  attempts: Attempt[];
  workdir: string;
  logFile: string;
  resultPath: string;
  retry: RetryContext;
  env?: Record<string, string>;
}

interface Attempt {
  number: number;            // 1-indexed
  executor: 'shell' | 'sdk';
  command?: string;          // shell
  prompt?: string;           // sdk
  model?: string;            // sdk
  maxTurns?: number;         // sdk
  policy?: string;           // sdk (agent-runner internal policy)
  agent?: string;            // sdk (agent definition)
  promptVars?: Record<string, string>;
  timeoutSeconds?: number;   // per-attempt timeout
}

interface RetryContext {
  attempt: number;           // 1-indexed (which pipeline-level retry this is)
  maxAttempts: number;
  previousFailure?: FailureReason;
  previousSessionId?: string;
  previousLogFile?: string;
  worktreePreserved: boolean;
  adjustments?: {
    maxTurns?: number;
    model?: string;
    promptContext?: string;  // appended to prompt
  };
}
```

### Step result (written by worker, read by scheduler)

```typescript
interface StepResult {
  status: 'success' | 'failure';
  failureReason?: FailureReason;
  costUsd: number;
  turns: number;
  sessionId?: string;
  lastError?: string;
  attemptHistory: AttemptRecord[];
}

interface AttemptRecord {
  number: number;
  executor: 'shell' | 'sdk';
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

## 2. Failure Taxonomy

Every failure is classified. The scheduler decides retryability per-type.

| FailureReason | Retryable | Meaning | Escalation |
|---|---|---|---|
| `timeout` | Yes | max_turns, stall, or start-to-close exceeded | More turns |
| `agent` | Yes | execution error, crash | Better model on final attempt |
| `infra` | Yes | worktree creation, npm install | Retry same config |
| `budget` | **No** | maxBudgetUsd exhausted | Orchestrator adjusts budget |
| `blocked` | **No** | agent output `CANNOT_PROCEED:` | Orchestrator fixes dependency |
| `merge_conflict` | **No** | merge handler exhausted attempts | Orchestrator resolves conflict |

Non-retryable within a run. All reset to `blocked` on resume (orchestrator fixed it).

### Output classification

The worker classifies agent output before writing the result:

```typescript
function classifyResult(agentResult, abandoned): StepResult {
  if (abandoned) → timeout
  if (output contains 'CANNOT_PROCEED:') → blocked (with reason extracted)
  if (SDK failure) → map to failure taxonomy
  if (success) → success
}
```

Single function, all outcomes, no special cases scattered across the codebase.

## 3. Scheduler (pure) — IMPLEMENTED

```typescript
function nextActions(nodes, state) → { actions, state }
```

Never mutates input. Level-triggered. 29 tests. No changes needed for the worker model —
the scheduler doesn't know about execution. It just resolves dependencies and emits
`execute` actions.

## 4. Resource Pools

Two resource types:

**Slots** (renewable): concurrency limits. Acquired on dispatch, released on completion.
**Budgets** (consumable): cumulative limits. Consumed permanently.

```yaml
resources:
  api: 10              # max 10 concurrent SDK agents
  merge_lock: 1        # serialize merge operations
  cost_usd: 50.00      # pipeline budget cap
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

When budget is exhausted, no new steps are dispatched. Running steps finish. Pipeline
completes as `partial` with remaining nodes failed as `budget`.

## 5. Pipeline Runner (scheduler + dispatcher)

The runner is a simple loop. It does NOT execute work — it spawns workers and monitors
their output via the filesystem.

**I/O model:** All worker monitoring uses ONE `readdir` per iteration (O(1) syscall)
instead of per-worker `stat` calls (O(N) syscalls). This scales to 1000+ workers on
NFS with constant filesystem overhead. Per-worker `stat` is only used for stall
detection on workers that haven't completed — and only when the `readdir` didn't
find their result file.

```typescript
const workers = new Map<string, WorkerHandle>();

while (!aborted) {
  // ── Monitor workers (batched I/O) ───────────────────
  const dirSnapshot = new Set(fs.readdirSync(run.logDir));
  processWorkers(dirSnapshot, workers, state, resourcePool, observer, options);

  // ── External signals ────────────────────────────────
  processCommands(run.logDir, dirSnapshot, workers, state);
  checkConfigChanges(run.configPath, dag, state, observer);
  saveState(statePath, state);     // throttled to every 30s

  // ── Schedule ────────────────────────────────────────
  const { actions, state: newState } = scheduler.nextActions(dag, state.nodes);
  state.nodes = newState;
  if (actions.find(a => a.type === 'complete')) break;

  // ── Dispatch ────────────────────────────────────────
  for (const action of actions.filter(a => a.type === 'execute')) {
    const node = getNode(action.nodeId);
    if (workers.has(node.id)) continue;
    if (!resourcePool.canAcquire(node.spec.resources)) continue;

    resourcePool.acquire(node.spec.resources);
    workers.set(node.id, spawnStep(node, run));
  }

  // ── Wait ────────────────────────────────────────────
  // 1s poll. Latency is acceptable — agent runs take minutes.
  // Batched readdir means the poll cost is O(1), not O(workers).
  await sleep(1000);
}
```

### Worker monitoring (single pass, batched I/O)

Completions, crash detection, stall detection, and live state updates in ONE loop
over the workers map. The `dirSnapshot` from `readdir` tells us which result files
exist without per-file `stat` calls. Only workers without results get a `stat` on
their log file (for stall detection).

```typescript
function processWorkers(dirSnapshot, workers, state, resourcePool, observer, options) {
  const now = Date.now();

  for (const [nodeId, worker] of workers) {
    // ── Completed? (set lookup, no syscall)
    if (dirSnapshot.has(`${nodeId}-result.json`)) {
      const result = JSON.parse(fs.readFileSync(worker.resultPath, 'utf-8'));
      updateNodeState(state, nodeId, result);
      resourcePool.release(worker.resources);
      resourcePool.consume('cost_usd', result.costUsd);
      workers.delete(nodeId);
      observer.onNodeComplete(nodeId, state.nodes[nodeId]);
      continue;
    }

    // ── Crashed? (kill(pid,0) — one syscall, no filesystem)
    if (!isProcessAlive(worker.pid)) {
      handleFailure(state, nodeId, 'infra', 'worker process died unexpectedly');
      resourcePool.release(worker.resources);
      workers.delete(nodeId);
      observer.onNodeComplete(nodeId, state.nodes[nodeId]);
      continue;
    }

    // ── Still running — check stall + timeout (one stat for log mtime)
    const logMtime = fs.statSync(worker.logFile).mtimeMs;
    const idleSeconds = (now - logMtime) / 1000;
    const elapsedSeconds = (now - worker.startedAt) / 1000;
    state.nodes[nodeId].lastEventAt = new Date(logMtime).toISOString();

    if (worker.timeoutSeconds && elapsedSeconds > worker.timeoutSeconds) {
      killWorker(worker);
      handleFailure(state, nodeId, 'timeout', `exceeded ${worker.timeoutSeconds}s total`);
      resourcePool.release(worker.resources);
      workers.delete(nodeId);
    } else if (idleSeconds > options.stallAbandonSeconds) {
      killWorker(worker);
      handleFailure(state, nodeId, 'timeout', `stalled: no output for ${Math.round(idleSeconds)}s`);
      resourcePool.release(worker.resources);
      workers.delete(nodeId);
    } else if (idleSeconds > options.stallWarnSeconds) {
      observer.onStall(nodeId, idleSeconds, 'warning');
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killWorker(worker: WorkerHandle): void {
  try { process.kill(-worker.pgid, 'SIGTERM'); } catch { /* already dead */ }
}
```

**Scaling:**
- 10 workers: 1 readdir + ~10 stat (running workers only) = ~11 syscalls/iteration
- 100 workers: 1 readdir + ~100 stat = ~101 syscalls/iteration (~100μs local, ~100ms NFS)
- 1000 workers: 1 readdir + ~1000 stat = ~1001 syscalls/iteration (~1ms local, ~1-10s NFS)
- Beyond 1000 on NFS: batch log mtimes via single `ls -lt` subprocess, or switch to
  UDP notification from workers (worker sends nodeId to runner on completion).

### External signals

**Commands** — orchestrator → pipeline, one-way, consumed on read:
```typescript
interface PipelineCommands {
  cancel?: { nodeId: string; reason: string; retryable?: boolean }[];
  adjust?: { nodeId: string; maxTurns?: number; model?: string; promptContext?: string }[];
}
```

The `dirSnapshot` from the main loop's `readdir` already tells us if `commands.json`
exists — no additional syscall needed.

Cancel kills the worker process group. Adjust stores in `NodeState.adjustments`,
applied on next attempt via `RetryContext`.

**Config watching** — detects YAML changes, reconciles live:
```typescript
function checkConfigChanges(configPath, dag, state, observer) {
  const mtime = fs.statSync(configPath).mtimeMs;
  if (mtime <= lastConfigMtime) return;
  lastConfigMtime = mtime;
  const newConfig = parseConfig(loadYaml(configPath));
  reconcileState(state, newConfig.nodes);
  dag.length = 0;
  dag.push(...newConfig.nodes);
  observer.onDagChanged(dag);
}
```

Orchestrator edits YAML → engine picks up within 1s → no restart.

## 6. Step Worker (`run-step.ts`)

Simple process. Reads config, tries attempts in order, writes events to log, writes
result file, exits.

```typescript
const config: StepConfig = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));

const attemptHistory: AttemptRecord[] = [];

for (const attempt of config.attempts) {
  const record = { number: attempt.number, startedAt: now(), ... };
  log(`[attempt ${attempt.number}] ${attempt.executor}`);

  const result = attempt.executor === 'shell'
    ? runShell(attempt.command, config.workdir)
    : await runSDKAgent(attempt, config.workdir, config.logFile);

  record.completedAt = now();
  record.status = result.status;
  record.costUsd = result.costUsd;
  record.turns = result.turns;
  attemptHistory.push(record);

  const classified = classifyResult(result, false);
  if (classified.status === 'success' || isNonRetryable(classified.failureReason)) {
    writeResult({ ...classified, attemptHistory });
    process.exit(classified.status === 'success' ? 0 : 1);
  }

  log(`[attempt ${attempt.number}] failed: ${classified.failureReason}`);
}

writeResult({ status: 'failure', ..., attemptHistory });
process.exit(1);
```

The worker doesn't know about the DAG, other steps, or the scheduler. It just executes
and reports.

## 7. State

### NodeState

```typescript
interface NodeState {
  status: 'blocked' | 'ready' | 'running' | 'success' | 'failure' | 'skipped';
  failureReason?: FailureReason;
  attempt: number;             // 1-indexed, current pipeline-level attempt
  maxAttempts: number;
  sessionId?: string;
  costUsd: number;             // cumulative across all attempts
  turns: number;               // cumulative across all attempts
  startedAt?: string;          // when current execution started
  lastEventAt?: string;        // last log file activity
  logFile?: string;
  lastError?: string;
  adjustments?: {              // from orchestrator commands
    maxTurns?: number;
    model?: string;
    promptContext?: string;
  };
  attemptHistory: AttemptRecord[];  // full forensic trail
}
```

### PipelineState

```typescript
interface PipelineState {
  run: RunIdentity;
  nodes: Record<string, NodeState>;
  status: 'running' | 'complete' | 'partial' | 'failed' | 'deadlock';
  createdAt: string;
  updatedAt: string;
  totalCostUsd: number;
  resumeCommand: string;
}
```

### State updates

When a worker completes, the runner reads the result file and updates `NodeState`:
- `attemptHistory`: APPEND new records (accumulates across pipeline-level retries)
- `costUsd`, `turns`: cumulative (add, not replace)
- `attempt`: increment (1-indexed pipeline-level counter)
- `sessionId`: last session (for potential SDK resume)

The runner constructs `RetryContext` from `NodeState` when writing step configs —
the scheduler is pure and never sees retry context.

### Resume

Loads state file. Validates DAG (or reconciles with `--allow-dag-changes`).
- `running` → `ready` (crash recovery — worker died)
- `skipped` → `blocked` (re-evaluate)
- All non-retryable failures → `blocked` (orchestrator fixed it)
- `success` → untouched

## 8. Observability

### Four channels

| Channel | File | Updated | Audience |
|---|---|---|---|
| State file | `pipeline-state.json` | Every 30s + on completion | Orchestrator (jq queries) |
| Pipeline log | `pipeline.log` | Real-time (observer) | Debugging, orchestrator (tail) |
| Step logs | `{nodeId}.log` | Real-time (worker) | Deep debugging, stall detection |
| Completion report | `pipeline-report.md` | On pipeline completion (appended) | Human, orchestrator |

### Completion report (ReportObserver)

Appended per run — cumulative across resumes:

```markdown
## Run 1 — 2026-03-24T08:15:00Z
PARTIAL (5/8 succeeded) | 45 turns | $6.75

  ✓ sched-accuracy          8 turns    $1.20
  ✓ sched-structure          12 turns   $1.80
  ✗ merge-sched              FAILED (3 attempts, $11.70)
    #1  shell "git merge"        → conflict (0.2s, $0)
    #2  sdk sonnet 30t           → agent error (45t, $3.20)
    #3  sdk opus 60t             → timeout (60t, $8.50)
  ⊘ verify-sched              SKIPPED (dependency failed)

## Run 2 (resumed) — 2026-03-24T09:45:00Z
COMPLETE (8/8) | 31 turns | $4.20 | Cumulative: 76 turns | $10.95

  ✓ merge-sched              1 attempt
    #1  shell "git merge"        → merged (0.3s, $0)
```

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

No `onAgentEvent` — the runner doesn't see individual turns (workers write to log files).
No `onMerge` — merge is just a step; results come through `onNodeComplete`.
`onError` — non-fatal errors (config parse failures, stale worktrees, unexpected states).

Implementations: FileLog (always), Report (always), Stdout (--ci), Tmux (--watch).
Tmux gets live agent activity by tailing `{nodeId}.log` directly, not via Observer.

## 9. DAG Parser — IMPLEMENTED (needs updates)

Updates needed:
- `maxRetries` → `maxAttempts` (1-indexed)
- `attempts` field in GroupSpec (optional — generated from escalation policy if absent)
- `resources` field in GroupSpec
- `timeoutSeconds` field
- Stage desugar: explicit `depends_on` replaces stage deps (not unions)
- `branch` desugars into merge + verify steps with attempt sequences

## 10. GitOps — IMPLEMENTED

Workspace provider for git-based workflows. Behind interface — swappable.
Steps without `branch` don't touch GitOps. The engine works without git.

## 11. Escalation Policy

Default policy generates attempt sequences when `attempts` not specified:

```typescript
function defaultAttempts(spec: GroupSpec, retry: RetryContext): Attempt[] {
  const base = spec.maxTurns ?? 30;
  const model = spec.model ?? 'claude-sonnet-4-6';

  if (retry.attempt === 1) return [{ executor: 'sdk', model, maxTurns: base }];
  if (retry.previousFailure === 'timeout') return [{ executor: 'sdk', model, maxTurns: base * 2 }];
  if (retry.attempt >= retry.maxAttempts) return [{ executor: 'sdk', model: 'claude-opus-4-6', maxTurns: base * 2 }];
  return [{ executor: 'sdk', model, maxTurns: Math.round(base * 1.5) }];
}
```

Steps with explicit `attempts` skip the policy — the config is the complete strategy.

## 12. CLI

```bash
npx tsx scripts/sdk/cli.ts config.yaml                    # FileLog + Report
npx tsx scripts/sdk/cli.ts config.yaml --watch             # + Tmux
npx tsx scripts/sdk/cli.ts config.yaml --ci                # + Stdout
npx tsx scripts/sdk/cli.ts config.yaml --resume            # retry from state
npx tsx scripts/sdk/cli.ts config.yaml --max-parallel 10   # (shorthand for api resource)
npx tsx scripts/sdk/cli.ts config.yaml --only a,b          # subset + transitive deps
npx tsx scripts/sdk/cli.ts config.yaml --budget 50         # (shorthand for cost_usd resource)
```

## What Needs Building / Changing

### Keep (correct, no changes)
- Scheduler (pure, 29 tests)
- DAG parser core (38 tests) — needs field additions
- GitOps (16 tests)
- Observer pattern + composite dispatch
- State file atomic writes

### Restructure (logic correct, abstraction changes)
| Current | Change to | Why |
|---|---|---|
| `Handlers { agent, merge, verify }` | `StepExecutor` (spawn worker) | Workers execute, scheduler dispatches |
| Phase 1/2 loop with Promise.race | Single poll loop with sleep(1s) | Simpler, no async IIFEs |
| `FixAgentFn` narrow seam | Attempt sequence (shell → agent) | Unified escalation model |
| `maxRetries` | `maxAttempts` (1-indexed) | Clearer naming |
| `maxParallel` | `resources.api` slot | One of many resources |

### New
| Component | Lines est |
|---|---|
| Resource pool (slots + budgets) | 40 |
| Step worker (`run-step.ts`) | 80 |
| Step config / result file I/O | 30 |
| Worker spawn + process group management | 30 |
| Completion check (poll result files) | 30 |
| Stall detection (log mtime + start-to-close) | 30 |
| Config watching (mtime + reconcile) | 20 |
| Commands processing (cancel + adjust) | 30 |
| `classifyResult` (unified outcome classification) | 20 |
| Default escalation policy | 20 |
| ReportObserver (completion report, appended) | 80 |
| RetryContext + attempt history | 30 |
| Tmux observer | 120 |
| Tests | 150 |

### Delete (replaced by worker model)
- `handlers.ts` (Handlers interface, FixAgentFn, createMergeHandler, createVerifyHandler)
- Phase 1/2 loop logic in pipeline-runner.ts
- `stallKilled` Set, async IIFEs, Promise.race patterns
- `runAgentWithInlinePrompt` (worker handles inline prompts directly)

## Scaling

```
Single machine (current target):
  ≤ 10 concurrent: comfortable on 16GB RAM
  ≤ 50 concurrent: needs 32GB RAM, symlinked node_modules
  ≤ 100 concurrent: needs 64GB RAM, fast SSD

Multi-machine (shared filesystem):
  Change spawnStep from local spawn to ssh/k8s/cloud-run
  Zero changes to scheduler, state, observers, config
  Shared FS: NFS, EFS, GCS FUSE

The engine is never the bottleneck:
  Scheduler: O(N × deps) per iteration, negligible CPU
  I/O: O(1) readdir + O(running workers) stat per iteration
  State file: <1MB for 1000 nodes, one write per 30s
  Workers: independent processes, own memory

  Local: 1000 workers → ~1ms per iteration
  NFS: 1000 workers → ~1-10s per iteration (stat calls)
  Beyond 1000 on NFS: batch log stats or switch to UDP notification
```

## Success Criteria

- [ ] Curation (40 reviewers → 8 curators) runs with one command
- [ ] Steps use attempt sequences (shell → agent → escalated agent)
- [ ] Resource pools control concurrency + budget
- [ ] Workers are subprocesses (setsid, killable, isolated)
- [ ] Stall detection: warn at 120s, kill at 600s (configurable)
- [ ] Start-to-close timeout per step
- [ ] `commands.json` cancel/adjust picked up within 30s
- [ ] Config changes picked up within 30s (no restart)
- [ ] `CANNOT_PROCEED` → `blocked` failure, non-retryable
- [ ] Completion report: per-attempt history, cumulative across runs
- [ ] State file: turns, cost, lastEventAt queryable during execution
- [ ] `--resume` recovers from any failure state
- [ ] Budget cap stops scheduling when pipeline cost exceeded
- [ ] 550+ tests, tsc clean
