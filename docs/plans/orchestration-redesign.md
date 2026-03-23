# Orchestration Redesign: DAG-Based Pipeline Runner

**Date:** 2026-03-23
**Branch:** `worktree-curation-test-run`
**Status:** Planning (reviewed, v2)
**Predecessor:** Phase 19 (SDK agent runner), curation test runs (2026-03-22/23)

## Problem Statement

The multi-agent orchestration system works but is architecturally fragile. A curation
test run that should take 30 minutes took 4 hours across 8 attempts due to:

- Two execution engines (bash retry loop + TypeScript SDK runner) that don't share capabilities
- WATCH mode (493 lines) reimplements execution instead of being a presentation layer
- Pipeline state scattered across 25+ env vars, text files, and branch existence
- Config doesn't declare behavior — naming conventions and phase-name checks infer it at runtime
- Stages are an imperfect approximation of the actual dependency graph between groups
- No resume — failure requires manual cleanup and full re-run
- Merge runs on all groups even when read-only groups have nothing to merge

These are not individual bugs — they're symptoms of the wrong abstractions.

## Design Principles

1. **Config declares behavior.** The YAML is the complete truth. No naming conventions, no env var inference, no phase-name checks.
2. **One execution engine.** `agent-runner.ts` handles all agent execution. Observation is pluggable, not a separate code path.
3. **State is a file.** `pipeline-state.json` is the single source of truth. Resume reads it. Any process can query it.
4. **Pure scheduling logic.** The scheduler is a pure function (like `attempt-machine.ts`). Given state, return actions. No I/O, no path resolution.
5. **DAG, not stages.** Groups declare dependencies. The scheduler runs groups when their dependencies are met. Stages are syntactic sugar.
6. **Bash does bash things.** Git operations, builds, file copying — called via typed interface from TypeScript.
7. **No new dependencies.** All new code uses Node built-ins and existing project deps only.
8. **No human in the loop until PR.** The pipeline runs autonomously. Merge conflicts get fix agents. Verify failures get fix agents. Partial failures produce a PR that reports what worked and what didn't. The first human touchpoint is the PR review — not the pipeline itself. `--watch` is read-only observability, not intervention.

## Architecture

### Components

```
Config (YAML)
    │
    ▼
┌──────────┐     ┌───────────┐     ┌──────────┐
│ DAG      │     │ Scheduler │     │ Executor │
│ Parser   │────▶│ (pure)    │────▶│ (agent-  │
│          │     │           │     │  runner) │
└──────────┘     └─────┬─────┘     └──────────┘
                       │
              ┌────────┴────────┐
              │ Pipeline Runner │
              │ (composition)   │
              ├────────┬────────┤
              │        │        │
         ┌────▼──┐ ┌───▼───┐ ┌─▼────────┐
         │GitOps │ │ State │ │ Observer │
         │(bash) │ │(JSON) │ │(pluggable)│
         └───────┘ └───────┘ └──────────┘
```

### 1. DAG Parser (`dag.ts`, ~80 lines)

Parses YAML config into a validated dependency graph.

```typescript
interface GroupSpec {
  id: string;
  prompt: string;                      // template path, relative to config dir
  promptVars?: Record<string, string>; // substituted before passing to agent
  policy?: string;                     // default: 'default'
  agent?: string;                      // agent definition from .claude/agents/
  branch?: string;                     // null = read-only, shared CWD
  mergeMessage?: string;
  output?: string;                     // relative to logDir
  dependsOn?: string[];                // group IDs
}

function parseConfig(configPath: string): {
  phase: string;
  mergeTarget: string;
  groups: GroupSpec[];
}
```

Responsibilities:
- Parse YAML, validate required fields (id, prompt are required)
- Detect cycles in dependency graph (error)
- Validate all `dependsOn` refs exist (error)
- Validate no dead fields (all GroupSpec fields are consumed by executor adapter)
- Desugar `stages:` syntax into explicit `dependsOn`
- Support both `stages:` (common pattern) and `groups:` with `dependsOn:` (complex DAGs)
- Support `group_templates:` for reducing repetition (see Config Format section)

Stages desugar:
```yaml
# Input:
stages:
  - name: "Review"
    groups:
      - { id: A, prompt: t.md }
      - { id: B, prompt: t.md }
  - name: "Curate"
    groups:
      - { id: C, prompt: c.md, branch: x }

# Output (equivalent):
groups:
  - { id: A, prompt: t.md }
  - { id: B, prompt: t.md }
  - { id: C, prompt: c.md, branch: x, dependsOn: [A, B] }
```

### 2. Dependency Model

**Two dependency types:**

- **Data dependency** — "I need your output." The downstream group needs the upstream
  group to complete. No code merge required. Example: curator needs reviewer reports.

- **Code dependency** — "I need your code changes integrated." The downstream group
  needs the upstream group's branch merged into the merge target. Example:
  integration-tests need feature-A's code.

The distinction is implicit from the config: upstream groups with `branch` create
code dependencies; those without create data dependencies. No explicit annotation needed.

**Merge is infrastructure, not a node.** Merge is mechanical — it takes a branch and
integrates it into the merge target. It's deterministic, bounded, and tied to a shared
resource (the merge worktree). Like worktree creation or WASM copying, it's something
the pipeline runner handles as infrastructure when a code-dependent group becomes ready.
If merge conflicts, the runner spawns a fix agent and retries — same pattern as the
current `merge.sh`, not a new abstraction.

**Verify IS a node.** Verification is judgment: which checks to run, how to fix
failures, whether the result is acceptable. It's configurable per-group, can fail
independently, can be retried with fix agents, and different groups need different
levels. It belongs in the DAG.

### The verify concern

Not every merge needs full verification. Not every verification follows a merge.

```yaml
groups:
  - id: feature-A
    branch: feature/A
    verify: full              # tsc + vitest + cargo after merge

  - id: docs-update
    branch: docs/update
    verify: none              # docs don't need build verification

  - id: quick-fix
    branch: fix/typo
    verify: quick             # tsc only, no vitest

  - id: solo-agent
    branch: fix/bug-123
    verify: full              # single agent, no merge needed, but verify its work
    # no depends_on — runs alone, verify confirms its changes

  - id: integration
    depends_on: [feature-A, docs-update, quick-fix]
    branch: feature/integration
    verify: full
```

Verify levels:
- `full` — tsc + vitest + cargo test (default for branched groups)
- `quick` — tsc only (~5s vs ~30s)
- `none` — skip verification (docs, skills, data-only output)

The DAG parser inserts verify nodes for groups where `verify != 'none'`:

```
# User writes:
- { id: feature-A, branch: feature/A, verify: full }
- { id: docs-update, branch: docs/update, verify: none }
- { id: integration, depends_on: [feature-A, docs-update] }

# Internal DAG:
- { id: feature-A, type: 'agent' }
- { id: verify:feature-A, type: 'verify', level: 'full', dependsOn: [feature-A] }
- { id: docs-update, type: 'agent' }
  # no verify node — verify: none
- { id: integration, type: 'agent', dependsOn: [verify:feature-A, docs-update] }
  # depends on verify:feature-A (code dep with verify)
  # depends on docs-update directly (code dep without verify)
```

**When a code-dependent group becomes ready**, the pipeline runner merges all unmerged
dependency branches before creating the group's worktree. Merge is serialized on the
merge worktree. If a merge conflicts, the runner spawns a fix agent. This is
infrastructure — not scheduled by the DAG.

**Key insight:** Merge is like `git worktree add` — infrastructure the runner handles.
Verify is like an agent — scheduled work in the DAG that can fail, retry, and be
configured.

### 3. Node Types

```typescript
type NodeType = 'agent' | 'verify';

interface DAGNode {
  id: string;              // 'feature-A' or 'verify:feature-A'
  type: NodeType;
  dependsOn: string[];     // other node IDs
  // Agent-specific:
  spec?: GroupSpec;         // only for type='agent'
  // Verify-specific:
  level?: 'full' | 'quick';  // only for type='verify'
  // All types:
  maxRetries?: number;      // verify default 3
}
```

Users never write verify nodes — the DAG parser generates them from the `verify`
field on groups with branches. The internal DAG has more nodes than the config,
but only one additional type (verify), which maps directly to a clear user concept.

### 4. Scheduler (`scheduler.ts`, ~60 lines)

Pure state machine. Given DAG nodes + current state → next actions. No I/O, no path
resolution, no side effects. Works identically for agent and verify nodes.

```typescript
interface NodeState {
  status: 'blocked' | 'ready' | 'running' | 'success' | 'failure' | 'skipped';
  failureReason?: 'agent' | 'verify_failed' | 'timeout' | 'budget' | 'dependency';
  attempt: number;
  maxRetries: number;
  sessionId?: string;      // agent nodes only
  costUsd: number;         // agent nodes only
  turns: number;           // agent nodes only
}

type Action =
  | { type: 'execute'; nodeId: string }
  | { type: 'complete'; status: 'success' | 'partial' | 'failed' | 'deadlock' }

function nextActions(nodes: DAGNode[], state: Record<string, NodeState>): Action[]
```

Logic (uniform across all node types):
1. For each `blocked` node: if all `dependsOn` are `success` → `ready`. If any is
   `failure`/`skipped` → `skipped(dependency)`.
2. For each `ready` node that isn't already `running` → emit `execute` action.
3. If a `failure` node has `attempt < maxRetries` → reset to `ready` (auto-retry).
4. If no actions and all nodes are terminal → `complete`.
5. If no actions and non-terminal nodes exist → `deadlock`.

**The scheduler doesn't know what agents or verifications are.** It resolves
dependencies and emits `execute`. The pipeline runner dispatches by type.

Tests must cover: zero-dependency nodes, single-node pipelines, diamond dependencies,
partial failure cascades, retry exhaustion, resume from partial state, all-data-deps
(no verify nodes), mixed verify levels, boundary values.

### 5. Executor (existing `agent-runner.ts`, interface change only)

Already well-designed: policies, attempt machine, stream events, `canUseTool`, metrics.

**Interface change:** The executor must accept an event callback for the observer
pattern. Currently it writes to log files internally via `fs.appendFileSync`. The
new interface:

```typescript
type AgentEventCallback = (event: AgentEvent) => void;

async function executeGroup(
  spec: GroupSpec,
  run: RunIdentity,
  onEvent: AgentEventCallback,
): Promise<AgentResult>
```

The `canUseTool` callback (for `.claude/skills/` edit permissions, #37157 workaround)
MUST be preserved in the executor adapter. This is load-bearing for curation curators.
See `docs/sdk-skill-edit-findings.md`.

### Verify Handler

```typescript
async function executeVerify(
  node: DAGNode,
  mergeWorktree: string,
  gitOps: GitOps
): Promise<NodeResult> {
  const checks = node.level === 'quick'
    ? { tsc: true, vitest: false, cargo: false }
    : { tsc: true, vitest: true, cargo: true };

  const result = await gitOps.verify(mergeWorktree, checks);

  if (!result.passed) {
    const fixed = await spawnVerifyFixAgent(mergeWorktree, result);
    if (!fixed) return { status: 'failure', failureReason: 'verify_failed' };
    return { status: 'success' };
  }
  return { status: 'success' };
}
```

### Merge as Infrastructure (in Pipeline Runner)

When a code-dependent group becomes ready, the pipeline runner merges all
unmerged dependency branches before executing the group:

```typescript
async function mergeIfNeeded(
  group: GroupSpec,
  dag: DAGNode[],
  mergedBranches: Set<string>,
  mergeWorktree: string,
  gitOps: GitOps,
  observer: Observer,
): Promise<boolean> {
  // Find dependency groups with branches that haven't been merged yet
  const toMerge = (group.dependsOn ?? [])
    .map(id => dag.find(n => n.id === id)?.spec)
    .filter(s => s?.branch && !mergedBranches.has(s.branch));

  if (toMerge.length === 0) return true;

  for (const dep of toMerge) {
    for (let attempt = 0; attempt < MERGE_FIX_RETRIES; attempt++) {
      const result = await gitOps.mergeBranch(mergeWorktree, dep.branch!);
      observer.onMerge(dep.id, dep.branch!, result);

      if (result === 'merged' || result === 'up-to-date') {
        mergedBranches.add(dep.branch!);
        break;
      }
      if (result === 'conflict') {
        const fixed = await spawnMergeFixAgent(mergeWorktree, dep.branch!);
        if (!fixed && attempt === MERGE_FIX_RETRIES - 1) return false;
      }
    }
  }
  return true;
}
```

Merge is serialized via `mergeLock` (one at a time on the shared worktree).
This is a resource constraint, not a DAG dependency — the scheduler doesn't model it.

### 3. Executor (existing `agent-runner.ts`, interface change only)

Already well-designed: policies, attempt machine, stream events, `canUseTool`, metrics.

**Interface change:** The executor must accept an event callback for the observer
pattern. Currently it writes to log files internally via `fs.appendFileSync`. The
new interface:

```typescript
// Current: events written to logFile internally
// New: events emitted via callback, pipeline runner routes to observer
type AgentEventCallback = (event: AgentEvent) => void;

// Adapter wraps existing runAgent, adds callback routing
async function executeGroup(
  spec: GroupSpec,
  run: RunIdentity,
  onEvent: AgentEventCallback,
): Promise<AgentResult>
```

The `canUseTool` callback (for `.claude/skills/` edit permissions, #37157 workaround)
MUST be preserved in the executor adapter. This is load-bearing for curation curators.
See `docs/sdk-skill-edit-findings.md`.

### 4. GitOps (`git-ops.ts`, ~120 lines)

Typed interface over shell commands. Called via `execSync`.

```typescript
interface GitOps {
  // Worktree lifecycle
  createWorktree(branch: string, base: string): string;  // returns path
  // createWorktree MUST: npm install, copy WASM, seed .agent-status.json
  // createWorktree branching base MUST be mergeTarget AFTER relevant merges complete
  removeWorktree(path: string): void;
  // removeWorktree uses rm -rf + git worktree prune (not git worktree remove,
  // which guard blocks). ExitWorktree is for interactive sessions only.

  // Merge worktree (persists for entire pipeline run)
  createMergeWorktree(mergeTarget: string): string;
  removeMergeWorktree(path: string): void;

  // Merge operations (serialized — caller holds merge lock)
  mergeBranch(worktree: string, branch: string): 'merged' | 'conflict' | 'up-to-date';
  // After merge: conditionally rebuild WASM if crates/ changed, auto-commit Cargo.lock
  verify(worktree: string): { tsc: boolean; vitest: boolean; cargo: boolean };

  // Build artifacts
  copyWasm(from: string, to: string): void;
  ensureWasm(launchDir: string): void;  // preflight: copy from main repo if missing

  // Preflight
  checkCleanState(): void;              // error if dirty git state
  runHookTests(): void;                 // run test-hooks.sh, error on failure
  applySkillsPatch(): void;             // run patch-sdk-skills-permission.py after npm install
}
```

**Important constraints from code comments and git history:**
- `createWorktree` must copy WASM artifacts (gitignored, not in worktree by default)
- `createWorktree` must branch from `mergeTarget` AFTER prior merges complete
  (agents must see merged output of prior groups)
- `mergeBranch` must conditionally rebuild WASM if `git diff HEAD~1 --name-only | grep '^crates/'`
  and auto-commit `Cargo.lock` changes (dirty Cargo.lock breaks subsequent verification)
- `removeWorktree` uses `rm -rf` + `git worktree prune`, NOT `git worktree remove`
  (guard binary blocks `git worktree remove`). `ExitWorktree` is for interactive
  sessions — `git-ops.ts` is infrastructure, not an interactive agent.
- `npmInstall` must be followed by `applySkillsPatch` to re-apply the SDK binary patch
  (#37157). Without this, curators cannot edit `.claude/skills/` files.
- Exit codes from git commands must be propagated, not swallowed.
- Use `git worktree list --porcelain | head -1` for main repo root, never `git rev-parse --show-toplevel`
  (returns current worktree root, not main).

### 6. Pipeline State (`pipeline-state.json`)

Single file, atomic updates. Any process can read it for status.

```typescript
interface RunIdentity {
  phase: string;
  baseRef: string;
  suffix: string;        // first 8 chars of baseRef
  mergeTarget: string;
  logDir: string;
  launchDir: string;
  configPath: string;
}

interface PipelineState {
  run: RunIdentity;
  nodes: Record<string, NodeState>;
  status: 'running' | 'complete' | 'partial' | 'failed' | 'deadlock';
  createdAt: string;
  updatedAt: string;
}
```

Written after: each node completion, pipeline completion.
**State writes are serialized** via a write queue — no concurrent `saveState` calls
from concurrent completions (prevents torn writes and lost updates).

**State file location follows standard practice:**
The state file path is deterministic from config + baseRef alone:
`{logDir}/pipeline-state.json` where `logDir = /tmp/ganttlet-logs/{phase}-{suffix}`.
Both `phase` (from config) and `suffix` (from baseRef) are derivable without reading
the state file. `--resume` derives the path, then loads RunIdentity from the file.

**Resume (`--resume`):**
- Derive state file path: `phase` from config YAML, `suffix` from current HEAD
  (or `--base-ref` flag if HEAD has advanced)
- Load state — `RunIdentity` (including `mergeTarget`, `launchDir`) recovered FROM the
  state file, never recomputed. This ensures worktree paths, branch names match.
- Nodes with `status: 'running'` at crash time → reset to `ready` (crash recovery)
- Nodes with `status: 'success'` → skipped
- Nodes with `status: 'skipped'` → re-evaluated (dependency may now be `success`)
- Failed agent nodes with stale worktrees → worktree removed before retry
- Session IDs preserved for agent-runner resumption

**Same-commit re-runs:** If `--resume` is NOT passed but a state file exists for the
same `suffix`, the pipeline starts fresh (overwrites state). Use `--resume` explicitly
to continue a prior run. `--force-new` overwrites even with `--resume`.

### 6. Observer (pluggable)

```typescript
interface Observer {
  onPipelineStart(run: RunIdentity): void;
  onGroupStart(id: string, spec: GroupSpec): void;
  onAgentEvent(id: string, event: AgentEvent): void;  // tool, text, turn, cost
  onGroupComplete(id: string, state: GroupState): void;
  onMerge(groupId: string, branch: string, result: string): void;
  onVerify(result: { tsc: boolean; vitest: boolean; cargo: boolean }): void;
  onStall(id: string, idleSeconds: number): void;
  onPipelineComplete(state: PipelineState): void;
}
```

Implementations:
- **FileLogObserver** (~50 lines): structured log files with `[turn N] [tool path] [text]`.
  Full text preserved (not truncated). Agent orchestrators read these. Format is a
  documented requirement, not an implementation detail:
  - `[turn N]` — turn counter for budget visibility
  - `[tool] ToolName /path/to/file` — tool name + first relevant input field
  - `[text] Full agent text output` — complete, not truncated
  - `[result] status turns=N cost=$X.XX` — final summary
- **TmuxObserver** (~120 lines): renders events to tmux panes. Read-only — admin can
  attach to observe progress but the pipeline doesn't accept input or pause for
  intervention. Creates one window per running group. Shows status summary in first
  window. Must have unit tests for state management and string formatting logic —
  only tmux rendering itself is manual-test-only.
- **StdoutObserver** (~30 lines): summary lines for CI. Exit code reflects status.

All three observe the same execution from agent-runner's `includePartialMessages` stream.
None affect execution. None duplicate the execution path.

**Stall detection:** The pipeline runner tracks time since last `onAgentEvent` per
group. If no events for `STALL_THRESHOLD` seconds (default 300), it calls
`observer.onStall()` and optionally kills the agent process tree via `kill_tree`.
This replaces the bash `monitor_agent` function. The SDK stream itself has a timeout —
if the stream hangs (network issue, model hang), the executor's `maxBudgetUsd` and
turn limits provide the backstop.

### 7. Pipeline Runner (`pipeline-runner.ts`, ~180 lines)

Composition layer. Receives all dependencies as arguments (DI for testing).
Dispatches to type-specific handlers. Handles merge as infrastructure (serialized
on merge worktree), not as scheduled work.

```typescript
async function runPipeline(
  dag: DAGNode[],
  run: RunIdentity,
  handlers: {
    agent: (spec: GroupSpec, run: RunIdentity, onEvent: AgentEventCallback) => Promise<NodeResult>;
    verify: (node: DAGNode, mergeWorktree: string, gitOps: GitOps) => Promise<NodeResult>;
  },
  gitOps: GitOps,
  observer: Observer,
  statePath: string,
): Promise<PipelineState>
```

**Core loop (event-driven):**

```typescript
const state = loadOrCreateState(statePath, dag);
const stateWriteQueue = createWriteQueue();
const mergedBranches = new Set<string>();
let mergeWorktree: string | null = null;  // created lazily on first code-dependent group
const mergeLock = createMutex();

const running = new Map<string, Promise<void>>();

while (true) {
  const actions = nextActions(dag, state.nodes);

  const completeAction = actions.find(a => a.type === 'complete');
  if (completeAction) {
    state.status = completeAction.status;
    break;
  }

  for (const action of actions.filter(a => a.type === 'execute')) {
    const node = dag.find(n => n.id === action.nodeId)!;
    if (running.has(node.id)) continue;

    state.nodes[node.id].status = 'running';

    const promise = (async () => {
      try {
        let result: NodeResult;

        switch (node.type) {
          case 'agent': {
            const spec = node.spec!;

            // Merge infrastructure: integrate dependency branches before starting
            if (spec.branch || spec.dependsOn?.some(id => groupHasBranch(dag, id))) {
              if (!mergeWorktree) {
                mergeWorktree = await gitOps.createMergeWorktree(run.mergeTarget);
              }
              const merged = await mergeLock.run(() =>
                mergeIfNeeded(spec, dag, mergedBranches, mergeWorktree!, gitOps, observer)
              );
              if (!merged) {
                result = { status: 'failure', failureReason: 'merge_conflict' };
                break;
              }
            }

            const workdir = spec.branch
              ? await gitOps.createWorktree(spec.branch, run.mergeTarget)
              : run.launchDir;

            observer.onGroupStart(node.id, spec);
            result = await handlers.agent(spec, run, (e) => observer.onAgentEvent(node.id, e));
            observer.onGroupComplete(node.id, state.nodes[node.id]);
            break;
          }
          case 'verify': {
            // Verify runs on the merge worktree (which has accumulated merges)
            result = await handlers.verify(node, mergeWorktree!, gitOps);
            observer.onVerify(result);
            break;
          }
        }

        state.nodes[node.id] = {
          ...state.nodes[node.id],
          status: result.status === 'success' ? 'success' : 'failure',
          failureReason: result.failureReason,
        };
      } catch (err) {
        state.nodes[node.id].status = 'failure';
        state.nodes[node.id].failureReason = 'agent';
      }

      await stateWriteQueue.enqueue(() => saveState(statePath, state));
      running.delete(node.id);
    })();

    running.set(node.id, promise);
  }

  if (running.size > 0) {
    await Promise.race(running.values());
  }
}

if (mergeWorktree) await gitOps.removeMergeWorktree(mergeWorktree);
observer.onPipelineComplete(state);
return state;
```

**Key design decisions:**
- `Promise.race` — re-evaluate scheduler after EACH completion (core DAG advantage)
- Merge is infrastructure: serialized via `mergeLock`, happens before agent execution,
  not as a scheduled node. Fix agents spawn on conflict within `mergeIfNeeded`.
- Verify IS a scheduled node: configurable per-group, can fail independently
- Merge worktree created lazily (not wasted for all-read-only DAGs)
- State writes serialized via write queue — no torn writes
- `status = 'running'` set before try — crash recovery resets to `ready`
- Prompt paths resolved relative to `run.launchDir`, never `process.cwd()`
- `kill_tree` + SIGINT/SIGTERM handler for process cleanup

**Preflight (before the main loop):**
```typescript
await gitOps.checkCleanState();
await gitOps.runHookTests();
await gitOps.ensureWasm(run.launchDir);
```

**`--only groupA,groupB`:** Filters the DAG to include only the specified groups,
their transitive dependencies, and any auto-inserted verify nodes. Implementation:
reverse walk from specified group IDs, collecting all `dependsOn` transitively.

### 8. Orchestrator Pattern

The pipeline is designed to be launched and monitored by an orchestrator agent
(or admin) who stays interactive while the pipeline runs autonomously.

**Launch:** The orchestrator starts the pipeline in the background:
```bash
npx tsx scripts/sdk/pipeline-runner.ts config.yaml &
```

**Monitor:** The orchestrator queries state without blocking:
```bash
# Current status of all groups
cat /tmp/ganttlet-logs/{phase}-{suffix}/pipeline-state.json | jq '.nodes | to_entries[] | "\(.key): \(.value.status)"'

# What's the curator doing right now?
tail -20 /tmp/ganttlet-logs/{phase}-{suffix}/multi-agent-orchestration-attempt1.log

# How many turns has the accuracy reviewer used?
grep -c '^\[turn' /tmp/ganttlet-logs/{phase}-{suffix}/multi-agent-orchestration-accuracy-attempt1.log

# Did any groups fail?
cat pipeline-state.json | jq '[.nodes | to_entries[] | select(.value.status == "failure")] | length'
```

**Respond to user questions:** The orchestrator reads state and logs to answer
questions like "how's it going?", "what's taking so long?", "did the curator
find the reviewer reports?" — without interrupting the pipeline.

**The orchestrator doesn't intervene.** The pipeline handles its own failures
(fix agents for merge conflicts and verify failures). The orchestrator reports
status and results. The first human action is reviewing the PR.

### CLI Entry Point (~40 lines)

```bash
# All three contexts:
npx tsx scripts/sdk/pipeline-runner.ts config.yaml              # agent/default (FileLogObserver)
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --watch       # admin tmux (TmuxObserver)
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --ci          # GitHub Actions (StdoutObserver)
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --resume      # retry from state file
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --force-new   # ignore existing state file

# Backwards compat wrapper:
./scripts/launch-phase.sh config.yaml                            # → delegates to pipeline-runner.ts
```

`--stage N` is not supported in DAG mode — it's a stages concept. For running a
subset, use `--only groupA,groupB` to run specific groups (and their dependencies).

## Config Format

### Full DAG (complex phases)

```yaml
phase: phase19-sdk-runner
merge_target: feature/phase19-sdk-runner

groups:
  - id: groupA
    prompt: docs/prompts/phase19/groupA.md
    branch: feature/phase19-sdk-runner-core
    merge_message: "feat: SDK agent runner core"

  - id: groupB
    prompt: docs/prompts/phase19/groupB.md
    branch: feature/phase19-curation-restructure
    merge_message: "feat: curation pipeline restructure"

  - id: groupC
    prompt: docs/prompts/phase19/groupC.md
    branch: feature/phase19-docs-config
    merge_message: "docs: SDK runner docs"

  - id: groupD
    prompt: docs/prompts/phase19/groupD.md
    branch: feature/phase19-bash-integration
    merge_message: "feat: bash integration"
    depends_on: [groupA, groupB, groupC]
```

### Stages sugar (simple phases)

```yaml
phase: skill-curation
merge_target: curation/run

stages:
  - name: "Review"
    groups:
      - id: scheduling-engine-accuracy
        prompt: docs/prompts/curation/reviewer-template.md
        prompt_vars: { SKILL: scheduling-engine, ANGLE: accuracy }
        policy: reviewer
        agent: skill-reviewer
        output: reviews/scheduling-engine/accuracy.md
      # ... more reviewers ...

  - name: "Curate"
    groups:
      - id: scheduling-engine
        prompt: docs/prompts/curation/curator.md
        prompt_vars: { SKILL: scheduling-engine }
        policy: curator
        branch: curation/scheduling-engine
        merge_message: "docs: curate scheduling-engine skill"
```

### Group templates (reduces repetitive YAML)

When many groups share the same prompt, policy, and agent (e.g., 40 review groups,
10 test groups across modules), explicit YAML is verbose. Templates:

```yaml
group_templates:
  - template: reviewer
    prompt: docs/prompts/curation/reviewer-template.md
    policy: reviewer
    agent: skill-reviewer
    id_pattern: "{SKILL}-{ANGLE}"             # how to derive group ID
    output_pattern: "reviews/{SKILL}/{ANGLE}.md"  # how to derive output path
    expand:
      - { SKILL: scheduling-engine, ANGLE: accuracy }
      - { SKILL: scheduling-engine, ANGLE: structure }
      # ...
```

Each entry in `expand` produces a GroupSpec with:
- `id` = `id_pattern` with vars substituted
- `prompt_vars` = the expand entry's key-value pairs
- `output` = `output_pattern` with vars substituted
- `prompt`, `policy`, `agent` = inherited from template
- `branch` = omitted (read-only) unless template specifies `branch_pattern`

The DAG parser desugars templates into individual GroupSpecs. Templates are
config convenience, not a runtime concept. Any field from GroupSpec can be
set on the template and inherited by all expanded groups.

### Per-group prompt wrapper files eliminated

Current: 9 wrapper files (one per skill) with nearly identical content.
Proposed: `prompt` + `prompt_vars` in YAML. No wrappers.

The executor resolves `{SKILL}`, `{ANGLE}`, `{LOG_DIR}` in the prompt template
before passing to agent-runner. `LOG_DIR` is injected from RunIdentity — never
needs to be in a wrapper file.

## Failure & Recovery

### Agent failure
- Agent node marked `failure` in state with `failureReason`
- Independent nodes continue running (DAG advantage)
- Dependent nodes marked `skipped(dependency)` by scheduler
- Pipeline completes as `partial`
- Resume: `--resume` retries failed nodes, skips succeeded, re-evaluates skipped

### Merge conflict (infrastructure failure)
- `mergeIfNeeded` detects conflict, spawns fix agent to resolve in merge worktree
- Fix agent has access to the merge worktree, both branches, and the conflict markers
- Retry up to `MERGE_FIX_RETRIES` (default 3) — each retry is a fresh fix agent attempt
- If fix agent succeeds → merge proceeds, downstream agent starts
- If fix agent exhausts retries → downstream agent marked `failure(merge_conflict)`,
  further downstream nodes → `skipped(dependency)`. Pipeline completes as `partial`.
  The PR reports the unresolvable conflict with the specific files and branches.

### Verify failure
- Verify node detects tsc/vitest/cargo failure, spawns fix agent
- Fix agent edits code in the merge worktree to resolve build issues
- Retry up to `maxRetries` (default 3)
- If fix agent succeeds → verify node marked `success`, downstream unblocked
- If fix agent exhausts retries → verify node marked `failure(verify_failed)`.
  The PR reports the specific build failures that couldn't be auto-fixed.

### Pipeline crash (Node process dies)
- State file written after each node completion (via serialized write queue)
- On restart with `--resume`:
  - State file path derived from config phase + `--base-ref` (or current HEAD)
  - `RunIdentity` recovered from state file (suffix, mergeTarget preserved)
  - `running` nodes reset to `ready` (can't know if they finished)
  - Stale worktrees from running agent nodes cleaned up before retry
  - Session IDs preserved for agent-runner resumption
  - Merge worktree re-created if missing

### Process cleanup on abort
- Pipeline runner installs SIGINT/SIGTERM handler
- Handler calls `kill_tree` on all running agent PIDs (kills entire process tree,
  not just parent — prevents orphaned subprocesses)
- State saved with running nodes marked `failure(timeout)` before exit

### Pipeline completion → PR
The pipeline always ends with a PR, regardless of outcome:
- **All success:** PR with full summary, all changes, ready for review
- **Partial:** PR with what succeeded + detailed report of what failed and why.
  The PR body includes: which groups completed, which failed, failure reasons,
  fix agent attempts, and specific errors. Reviewer can assess whether the
  successful work is mergeable independently.
- **All failed:** No PR. State file and logs contain the full diagnostic.

The PR is the handoff to human review. Everything before the PR is autonomous.

### Retry with no waste
```bash
# First run — curator fails
$ npx tsx pipeline-runner.ts config.yaml
# State: 5 reviewers=success, curator=failure
# No PR (or partial PR depending on config)

# Fix the underlying issue (prompt, config, code)
# Resume — skips succeeded reviewers, retries curator only
$ npx tsx pipeline-runner.ts config.yaml --resume
# State: 5 reviewers=success(skipped), curator=success
# PR created with full results
```

No `generate-retry-config.sh`. No manual cleanup. No re-running succeeded groups.
No human intervention during execution.

## What Changes

### New files (~700 lines total)

| File | Lines | Purpose |
|---|---|---|
| `scripts/sdk/dag.ts` | ~80 | YAML parser, validator, stages/template desugar, cycle detection |
| `scripts/sdk/scheduler.ts` | ~60 | Pure state machine: state → actions |
| `scripts/sdk/git-ops.ts` | ~120 | Typed interface over git/npm/cargo with full merge lifecycle |
| `scripts/sdk/pipeline-runner.ts` | ~150 | Event-driven composition loop + CLI entry point |
| `scripts/sdk/observers/file-log.ts` | ~50 | Structured log files (format is a documented requirement) |
| `scripts/sdk/observers/tmux.ts` | ~120 | Tmux pane rendering (unit-testable state + manual rendering) |
| `scripts/sdk/observers/stdout.ts` | ~30 | CI summary output |
| `scripts/sdk/__tests__/dag.test.ts` | ~120 | Config parsing, cycle detection, desugar, templates |
| `scripts/sdk/__tests__/scheduler.test.ts` | ~180 | Exhaustive state transitions, boundary values |
| `scripts/sdk/__tests__/pipeline-runner.test.ts` | ~250 | Integration with mock executor, resume, failures |
| `scripts/sdk/__tests__/git-ops.test.ts` | ~100 | Integration with real git repo in /tmp |

### Modified (interface additions)

| File | Lines | Change |
|---|---|---|
| `types.ts` | +80 | Add `GroupSpec`, `GroupState`, `RunIdentity`, `PipelineState`, `Action`, `AgentEvent` |
| `agent-runner.ts` | +20 | Add event callback parameter to `callQuery`, preserve `canUseTool` |

### Unchanged (well-designed, keep as-is)

| File | Lines | Why |
|---|---|---|
| `attempt-machine.ts` | 65 | Pure state machine — pattern for scheduler |
| `policy-registry.ts` | 46 | Open/closed — composable |
| `policies/*.ts` | 160 | Domain knowledge, correctly separated |
| `prompts.ts` | 44 | Frontmatter strip, var substitution |
| `metrics.ts` | 16 | JSONL append |
| All existing tests | 1489 | Full coverage maintained |
| Guard binary | — | Safety enforcement |
| `test-hooks.sh` | — | Hook integration tests |

### Deprecated (replaced by new components)

| File | Lines | Replaced by |
|---|---|---|
| `scripts/lib/stage.sh` | 229 | `pipeline-runner.ts` + `scheduler.ts` |
| `scripts/lib/watch.sh` | 493 | `observers/tmux.ts` |
| `scripts/lib/agent.sh` (SDK path) | 80 | Direct executor call |
| `scripts/lib/agent.sh` (legacy path) | 60 | Removed (SDK runner is only engine) |
| `scripts/lib/config.sh` | 135 | `dag.ts` |
| `scripts/launch-phase.sh` | 399 | CLI in `pipeline-runner.ts` (~40 lines) |
| `scripts/curate-skills.sh` | 96 | Config-only (YAML handles the flow) |
| `scripts/generate-retry-config.sh` | — | `--resume` reads state file |

### Kept but called from TypeScript instead of bash

| File | Purpose |
|---|---|
| `scripts/lib/merge.sh` core logic | Git merge + per-branch verification → `git-ops.ts` |
| `scripts/lib/worktree.sh` core logic | Worktree create/remove → `git-ops.ts` |
| `scripts/lib/validate.sh` core logic | tsc/vitest/cargo parallel run → `git-ops.ts` |
| `scripts/verify.sh` | Guard rebuild + verification (PostToolUse hook, unchanged) |
| `scripts/full-verify.sh` | Pre-commit verification (unchanged) |
| `scripts/test-hooks.sh` | Hook integration tests (called by `git-ops.ts` preflight) |
| `scripts/patch-sdk-skills-permission.py` | SDK binary patch (called by `git-ops.ts` after npm install) |

## Implementation Plan

### Phase 1a: Types + DAG + Scheduler (pure, no I/O)

**Files:** `types.ts` (expand), `dag.ts`, `scheduler.ts`
**Tests:** `dag.test.ts`, `scheduler.test.ts`

1. Add `GroupSpec`, `GroupState`, `RunIdentity`, `PipelineState`, `Action`, `AgentEvent` to types.ts
2. Implement DAG parser with stages desugar, template expansion, and cycle detection
3. Implement scheduler as pure function with exhaustive tests
4. Test DAG parser with curation config, phase 19 config, and edge cases
5. Test scheduler with: normal flow, partial failure, resume, deadlock, merge gating,
   diamond dependencies, zero-dep groups, single-group, all-read-only, boundary values

**Validation:** `npx vitest run` — all new + existing tests pass. `./scripts/full-verify.sh` passes.
**Commits:** `feat: add DAG parser`, `feat: add pipeline scheduler`

### Phase 1b: GitOps (integration tests with real git)

**Files:** `git-ops.ts`
**Tests:** `git-ops.test.ts`

1. Implement GitOps interface with execSync wrappers
2. Include WASM copy in createWorktree, conditional WASM rebuild + Cargo.lock commit in mergeBranch
3. Include npm install + SDK patch application
4. Include preflight: clean state check, hook tests, WASM ensure
5. Integration tests with real git repos in /tmp

**Validation:** `npx vitest run` + `./scripts/full-verify.sh`
**Commits:** `feat: add GitOps interface for git/build operations`

### Phase 2: Pipeline runner + file observer

**Files:** `pipeline-runner.ts`, `observers/file-log.ts`
**Tests:** `pipeline-runner.test.ts`

1. Implement event-driven pipeline runner with `Promise.race` loop
2. Implement serialized state write queue
3. Implement FileLogObserver with documented format requirements
4. Implement executor adapter (GroupSpec → RunnerOptions + event callback routing)
5. Implement CLI entry point with `--resume` and `--force-new`
6. Implement stall detection and kill_tree on timeout
7. Implement SIGINT/SIGTERM handler for clean shutdown
8. Integration test with mock executor (no real API calls)

**Validation:** Run curation test config end-to-end. `./scripts/full-verify.sh`
**Commits:** `feat: add pipeline runner`, `feat: add file log observer`

### Phase 3: Tmux observer

**Files:** `observers/tmux.ts`
**Tests:** `tmux-observer.test.ts` (state/formatting), manual (rendering)

1. Implement TmuxObserver: creates session, one window per running group
2. Unit tests for state tracking and string formatting (no tmux dependency)
3. Manual test: run with `--watch`, attach to tmux, verify rich output
4. `--watch` flag selects this observer

**Validation:** Manual tmux test + `./scripts/full-verify.sh`
**Commits:** `feat: add tmux observer for admin monitoring`

### Phase 4: Stdout observer + CI support

**Files:** `observers/stdout.ts`
**Tests:** `stdout-observer.test.ts`

1. Implement StdoutObserver: summary lines, progress, final status
2. Exit code: 0 = success, 1 = failed/partial
3. `--ci` flag selects this observer
4. Artifact collection: state file + logs in a known location

**Validation:** Run in simulated CI context + `./scripts/full-verify.sh`
**Commits:** `feat: add stdout observer for CI`

### Phase 5: Migration + cleanup

1. Update YAML configs (curation, phase 19) to new format with explicit fields
2. Verify both configs produce correct results with new pipeline runner
3. Update `launch-phase.sh` to delegate to `pipeline-runner.ts`
4. Update CLAUDE.md, skills, and docs to reference new architecture
5. Remove deprecated bash scripts
6. Run `./scripts/full-verify.sh`

**Validation:** Both curation and code-phase configs produce correct results.
**Commits:** `refactor: migrate configs to DAG format`, `refactor: remove deprecated bash orchestration`

### Phase 6: E2E tests + polish

1. Write E2E tests for `--resume`, `--watch`, `--ci` CLI flags
2. Update orchestrator prompt to reference new CLI
3. Run curation on all 8 skills as final validation
4. Write debrief

**Validation:** All E2E tests pass. Full curation run succeeds.
**Commits:** `test: add E2E tests for pipeline runner CLI`

## Test Strategy

| Component | Test type | Approach |
|---|---|---|
| DAG parser | Unit | Valid/invalid YAML, cycle detection, desugar, templates |
| Scheduler | Unit | Exhaustive state transitions (like attempt-machine: ~180 lines for ~60 lines) |
| GitOps | Integration | Real git repo in /tmp, WASM copy, merge, verify |
| Pipeline runner | Integration | Mock executor returning canned results, resume scenarios |
| FileLogObserver | Unit | Mock events → verify file output format |
| TmuxObserver | Unit + Manual | State/formatting unit tests; rendering manually verified |
| StdoutObserver | Unit | Mock events → verify stdout |
| CLI flags | E2E | `--resume`, `--watch`, `--ci` with real pipeline |
| End-to-end | Integration | Real curation run (5 reviewers + 1 curator) |

## Success Criteria

- [ ] Curation pipeline (5 reviewers → 1 curator) runs with one command, no env vars
- [ ] Phase 19 config (3 parallel → 1 dependent) runs without modification
- [ ] `--resume` after partial failure retries only failed groups
- [ ] `--watch` shows tmux TUI equivalent to current WATCH mode
- [ ] All existing SDK tests pass (120 tests)
- [ ] Pipeline runner tests cover: normal, partial failure, resume, deadlock, merge gating
- [ ] Scheduler tests are exhaustive (like attempt-machine: ~180 lines for ~60 lines of code)
- [ ] No env var threading between components
- [ ] State file is queryable: `cat pipeline-state.json | jq '.groups | to_entries[] | "\(.key): \(.value.status)"'`
- [ ] `./scripts/full-verify.sh` passes at every phase boundary
- [ ] E2E tests cover `--resume`, `--watch`, `--ci` flags
- [ ] Zero new npm dependencies added

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Tmux observer harder than expected | Phase 3 is independent — file log works without it |
| Agent-runner interface changes | Adapter pattern — GroupSpec→RunnerOptions is the seam |
| WATCH mode parity | TmuxObserver can reuse tmux-supervisor.sh helpers if needed |
| Merge logic is complex (WASM rebuild, Cargo.lock) | GitOps wraps existing merge.sh logic, doesn't rewrite it |
| CI workflow untested | StdoutObserver is simple; real CI testing is Phase 4 |
| SDK binary patch dependency (#37157) | `patch-sdk-skills-permission.py` runs after npm install in GitOps. Script warns loudly on SDK updates. |
| Same-commit re-run state clash | `--resume` is explicit opt-in. Default overwrites state. `--force-new` available. |
| Event-driven loop complexity | `Promise.race` pattern is standard; integration tests with mock executor cover timing |
| Process orphans on crash | SIGINT/SIGTERM handler + kill_tree on all running PIDs |
| Two-dot vs three-dot diff in merge detection | GitOps tests verify squash-merge detection with real git repos |
