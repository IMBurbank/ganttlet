# Orchestration Redesign: DAG-Based Pipeline Runner

**Date:** 2026-03-23
**Status:** Planning (reviewed, v5 — clean)
**Predecessor:** Phase 19 (SDK agent runner), curation test runs (2026-03-22/23)

## Problem Statement

The multi-agent orchestration system works but is architecturally fragile. A curation
test run that should take 30 minutes took 4 hours across 8 attempts due to symptoms
of the wrong abstractions: two execution engines, state scattered across 25+ env vars,
naming convention inference, no resume, no parallelism control, stages that can't
express partial dependencies.

## Design Principles

1. **Config declares behavior.** The YAML is the complete truth. No naming conventions, no env var inference, no phase-name checks.
2. **One execution engine.** `agent-runner.ts` handles all agent execution. Observation is pluggable, not a separate code path.
3. **State is a file.** `pipeline-state.json` is the single source of truth. Resume reads it. Any process can query it.
4. **Pure scheduling logic.** The scheduler is a pure function (like `attempt-machine.ts`). Given state, return actions. No I/O, no path resolution.
5. **DAG, not stages.** Groups declare dependencies. The scheduler runs groups when their dependencies are met. Stages are syntactic sugar.
6. **Bash does bash things.** Git operations, builds, file copying — called via typed interface from TypeScript.
7. **No new dependencies.** All new code uses Node built-ins and existing project deps only.
8. **No human in the loop until PR.** The pipeline runs autonomously. Merge conflicts get fix agents. Verify failures get fix agents. Partial failures produce a PR that reports what worked and what didn't. The first human touchpoint is the PR review. `--watch` is read-only observability, not intervention.

## Architecture

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

Each component has one responsibility. None overlap.

### 1. DAG Parser (`dag.ts`)

Parses YAML config into a validated dependency graph. Pure function, no side effects.

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
  verify?: 'full' | 'quick' | 'none'; // default: 'full' if branched, 'none' if not
  depends_on?: string[];               // group IDs (snake_case in YAML, camelCase in TypeScript)
}

function parseConfig(configPath: string): {
  phase: string;
  mergeTarget: string;
  maxParallel?: number;
  groups: GroupSpec[];
}
```

Responsibilities:
- Parse YAML, validate required fields (`id` and `prompt` are required)
- Detect cycles in dependency graph
- Validate all `depends_on` refs exist (converted to `dependsOn` in TypeScript output)
- Desugar `stages:` into explicit `depends_on`
- Expand `group_templates:` into individual GroupSpecs
- Auto-insert verify nodes for groups with `verify != 'none'`

**Stages desugar:**
```yaml
# Input:
stages:
  - name: "Review"
    groups: [{ id: A }, { id: B }]
  - name: "Curate"
    groups: [{ id: C, branch: x }]

# Becomes:
groups:
  - { id: A }
  - { id: B }
  - { id: C, branch: x, depends_on: [A, B] }
```

**Group templates** reduce repetitive YAML (e.g., 40 reviewer groups):
```yaml
group_templates:
  - template: reviewer
    prompt: docs/prompts/curation/reviewer-template.md
    policy: reviewer
    agent: skill-reviewer
    id_pattern: "{SKILL}-{ANGLE}"
    output_pattern: "reviews/{SKILL}/{ANGLE}.md"
    expand:
      - { SKILL: scheduling-engine, ANGLE: accuracy }
      - { SKILL: scheduling-engine, ANGLE: structure }
```

Templates are config convenience. The parser desugars them into individual GroupSpecs.

### 2. Dependency Model

**Two dependency types** (implicit from config, no annotation needed):

- **Data dependency** — upstream has no `branch`. Downstream waits for completion. No merge needed. Example: reviewer → curator.
- **Code dependency** — upstream has `branch`. Downstream needs that branch merged + verified before starting. Example: feature-A → integration.

**Merge is infrastructure.** Mechanical, deterministic, tied to a shared resource (merge worktree). The pipeline runner handles it — serialized via mutex, fix agents on conflict. Not a DAG node.

**Verify is a node.** Configurable (`full`/`quick`/`none`), can fail, needs fix agents. Different groups need different levels. Auto-inserted by the DAG parser.

```
# User writes:
- { id: feature-A, branch: feature/A, verify: full }
- { id: docs-update, branch: docs/update, verify: none }
- { id: integration, depends_on: [feature-A, docs-update] }

# Internal DAG (after parser):
- { id: feature-A, type: 'agent' }
- { id: verify:feature-A, type: 'verify', level: 'full', dependsOn: [feature-A] }
- { id: docs-update, type: 'agent' }
- { id: integration, type: 'agent', dependsOn: [verify:feature-A, docs-update] }
```

### 3. Node Types

```typescript
type NodeType = 'agent' | 'verify';

interface DAGNode {
  id: string;
  type: NodeType;
  dependsOn: string[];
  spec?: GroupSpec;           // agent nodes only
  level?: 'full' | 'quick';  // verify nodes only
  maxRetries?: number;        // verify default 3
}
```

Two types. Users never write verify nodes — the parser generates them.

**Result type** (returned by all handlers):
```typescript
interface NodeResult {
  status: 'success' | 'failure';
  failureReason?: NodeState['failureReason'];
  sessionId?: string;
  costUsd?: number;
  turns?: number;
}
```

### 4. Scheduler (`scheduler.ts`)

Pure state machine. Given nodes + state → actions. No I/O. Same pattern as `attempt-machine.ts`.

```typescript
interface NodeState {
  status: 'blocked' | 'ready' | 'running' | 'success' | 'failure' | 'skipped';
  failureReason?: 'agent' | 'merge_conflict' | 'verify_failed' | 'timeout' | 'budget' | 'dependency';
  attempt: number;
  maxRetries: number;
  sessionId?: string;
  costUsd: number;
  turns: number;
}

type Action =
  | { type: 'execute'; nodeId: string }
  | { type: 'complete'; status: 'success' | 'partial' | 'failed' | 'deadlock' }

function nextActions(nodes: DAGNode[], state: Record<string, NodeState>): Action[]
```

Logic (uniform across all node types):
1. `blocked` → `ready` when all `dependsOn` are `success`.
2. `blocked` → `skipped` when any `dependsOn` is `failure`/`skipped`.
3. `skipped` → `blocked` when a previously-failed dependency resets to `ready` (resume re-evaluation).
4. `ready` → emit `execute` action.
5. `failure` with `attempt < maxRetries` → `ready` (auto-retry).
6. All terminal → emit `complete`.
7. No actions, not all terminal → `deadlock`.

The scheduler doesn't know what agents or verifications are. It doesn't resolve paths. It doesn't know about git. It just resolves dependencies.

Tests: zero-dep nodes, single-node, diamond dependencies, partial failure cascades, retry exhaustion, resume from partial state, all-read-only, boundary values.

### 5. Executor (`agent-runner.ts`, interface change only)

Already well-designed: policies, attempt machine, stream events, `canUseTool`, metrics.

Interface addition — event callback for the observer pattern:

```typescript
type AgentEventCallback = (event: AgentEvent) => void;

async function executeGroup(
  spec: GroupSpec,
  run: RunIdentity,
  workdir: string,
  onEvent: AgentEventCallback,
): Promise<NodeResult>
```

The `canUseTool` callback (`.claude/skills/` edit permissions, #37157 workaround) MUST be preserved. See `docs/sdk-skill-edit-findings.md`.

### 6. GitOps (`git-ops.ts`)

Typed interface over shell commands.

```typescript
interface GitOps {
  createWorktree(branch: string, base: string): string;
  removeWorktree(path: string): void;
  createMergeWorktree(mergeTarget: string): string;
  removeMergeWorktree(path: string): void;
  mergeBranch(worktree: string, branch: string): 'merged' | 'conflict' | 'up-to-date';
  verify(worktree: string, checks: { tsc: boolean; vitest: boolean; cargo: boolean }): VerifyResult;
  rebaseOnMain(worktree: string): void;    // git fetch origin && git rebase origin/main
  copyWasm(from: string, to: string): void;
  ensureWasm(launchDir: string): void;
  checkCleanState(): void;
  runHookTests(): void;
  applySkillsPatch(): void;
}
```

Constraints (from git history and code comments):
- `createWorktree` MUST: npm install, apply SDK patch (`applySkillsPatch`), copy WASM, seed `.agent-status.json`
- `createWorktree` branches from `mergeTarget` AFTER relevant merges complete
- `mergeBranch` conditionally rebuilds WASM if `crates/` changed, auto-commits `Cargo.lock`
- `removeWorktree` uses `rm -rf` + `git worktree prune` (guard blocks `git worktree remove`)
- `ensureWasm` checks `launchDir` first, falls back to main repo root (`git worktree list --porcelain | head -1`) — orchestrator worktrees may not have WASM built
- Use `git worktree list --porcelain | head -1` for main repo root (never `git rev-parse --show-toplevel`)
- Exit codes must be propagated, not swallowed
- `kill_tree` in TypeScript: `execSync('ps -o pid= --ppid ' + pid)` recursively, then `process.kill(pid, signal)` — Node has no built-in process tree kill

### 7. Pipeline State (`pipeline-state.json`)

```typescript
interface RunIdentity {
  phase: string;
  baseRef: string;
  suffix: string;
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

- Serialized writes via queue (no torn writes from concurrent completions)
- Atomic writes: write to `.tmp`, rename (POSIX atomic — readers never see partial JSON)
- State file path deterministic from config + baseRef: `{logDir}/pipeline-state.json`

**Resume:** `--resume` derives path from config phase + current HEAD (or `--base-ref`). Loads `RunIdentity` FROM the file. `running` → `ready` (crash recovery). `success` nodes are left as-is (not re-executed). `skipped` → `blocked` (re-evaluated — the failed dependency may succeed on retry). Stale worktrees cleaned before retry. Session IDs preserved.

### 8. Observer (pluggable)

```typescript
interface Observer {
  onPipelineStart(run: RunIdentity): void;
  onNodeStart(id: string, node: DAGNode): void;
  onAgentEvent(id: string, event: AgentEvent): void;
  onNodeComplete(id: string, state: NodeState): void;
  onMerge(groupId: string, branch: string, result: string): void;
  onVerify(result: VerifyResult): void;
  onStall(id: string, idleSeconds: number): void;
  onPipelineComplete(state: PipelineState): void;
}
```

Three implementations:
- **FileLogObserver** — structured logs: `[turn N]`, `[tool] Name /path`, `[text] full output`, `[result] status turns=N cost=$X.XX`. Full text preserved (not truncated).
- **TmuxObserver** — read-only tmux panes, one per running group, status summary in first window. Unit-testable state/formatting; rendering manual-test only.
- **StdoutObserver** — CI summary lines, exit code reflects status.

**Stall detection:** Pipeline runner tracks time since last `onAgentEvent` per node. No events for `STALL_THRESHOLD` seconds → `observer.onStall()` + optional `kill_tree`.

### 9. Pipeline Runner (`pipeline-runner.ts`)

Composition layer. DI for testing.

```typescript
async function runPipeline(
  dag: DAGNode[],
  run: RunIdentity,
  handlers: {
    agent: (spec: GroupSpec, run: RunIdentity, workdir: string, onEvent: AgentEventCallback) => Promise<NodeResult>;
    verify: (node: DAGNode, mergeWorktree: string, gitOps: GitOps) => Promise<NodeResult>;
  },
  gitOps: GitOps,
  observer: Observer,
  statePath: string,
  options: { maxParallel: number },
): Promise<PipelineState>
```

**Core loop:**

```typescript
const state = loadOrCreateState(statePath, dag);
const stateWriteQueue = createWriteQueue();
const mergedBranches = new Set<string>();
let mergeWorktree: string | null = null;
const mergeLock = createMutex();
const running = new Map<string, Promise<void>>();

// Helper: find the agent branch for a dependency, walking through verify nodes
function findBranchForDep(depId: string): string | undefined {
  const dep = dag.find(n => n.id === depId);
  if (!dep) return undefined;
  if (dep.spec?.branch) return dep.spec.branch;
  // verify nodes don't have spec — look at their dependency (the agent)
  if (dep.type === 'verify' && dep.dependsOn.length > 0) {
    return findBranchForDep(dep.dependsOn[0]);
  }
  return undefined;
}

while (true) {
  const actions = nextActions(dag, state.nodes);

  const done = actions.find(a => a.type === 'complete');
  if (done) { state.status = done.status; break; }

  for (const action of actions.filter(a => a.type === 'execute')) {
    if (running.size >= options.maxParallel) break;
    const node = dag.find(n => n.id === action.nodeId)!;
    if (running.has(node.id)) continue;

    state.nodes[node.id].status = 'running';

    const promise = (async () => {
      let result: NodeResult = { status: 'failure', failureReason: 'agent' };

      try {
        // Merge infrastructure: before ANY node, merge unmerged dependency branches.
        // Walks through verify nodes to find the originating agent's branch.
        const unmergedBranches = node.dependsOn
          .map(id => findBranchForDep(id))
          .filter((b): b is string => !!b && !mergedBranches.has(b));

        if (unmergedBranches.length > 0) {
          if (!mergeWorktree) mergeWorktree = await gitOps.createMergeWorktree(run.mergeTarget);
          const merged = await mergeLock.run(() =>
            mergeUnmergedBranches(unmergedBranches, mergedBranches, mergeWorktree!, gitOps, observer)
          );
          if (!merged) {
            result = { status: 'failure', failureReason: 'merge_conflict' };
            throw new Error('merge_conflict');  // skip to catch
          }
        }

        switch (node.type) {
          case 'agent': {
            const spec = node.spec!;
            // Create worktree AFTER merges complete (agent sees merged code)
            const workdir = spec.branch
              ? await gitOps.createWorktree(spec.branch, run.mergeTarget)
              : run.launchDir;
            observer.onNodeStart(node.id, node);
            result = await handlers.agent(spec, run, workdir, e => observer.onAgentEvent(node.id, e));
            break;
          }
          case 'verify': {
            if (!mergeWorktree) mergeWorktree = await gitOps.createMergeWorktree(run.mergeTarget);
            observer.onNodeStart(node.id, node);
            result = await handlers.verify(node, mergeWorktree, gitOps);
            break;
          }
          default:
            result = { status: 'failure', failureReason: 'agent' };
        }
      } catch {
        // result already set (merge conflict or default)
      }

      // Update state explicitly — no spread that could overwrite status
      const ns = state.nodes[node.id];
      ns.status = result.status === 'success' ? 'success' : 'failure';
      ns.failureReason = result.failureReason;
      if (result.sessionId) ns.sessionId = result.sessionId;
      if (result.costUsd) ns.costUsd = result.costUsd;
      if (result.turns) ns.turns = result.turns;
      ns.attempt++;

      observer.onNodeComplete(node.id, ns);
      await stateWriteQueue.enqueue(() => saveState(statePath, state));
      running.delete(node.id);
    })();

    running.set(node.id, promise);
  }

  if (running.size > 0) await Promise.race(running.values());
}

if (mergeWorktree) await gitOps.removeMergeWorktree(mergeWorktree);
```

**Resource constraints** (runner-level, not scheduler):

| Resource | Constraint | Mechanism |
|---|---|---|
| Claude API | Max N concurrent agents | Semaphore (`maxParallel`, default 5) |
| Merge worktree | One merge at a time | Mutex (`mergeLock`) |
| State file | One write at a time | Write queue (`stateWriteQueue`) |

**After the loop — PR creation:**

```typescript
if (mergeWorktree) {
  // Rebase on latest main before PR (CLAUDE.md: "branch must pass against current HEAD")
  await gitOps.rebaseOnMain(mergeWorktree);
  await gitOps.verify(mergeWorktree, { tsc: true, vitest: true, cargo: true });
}

const prResult = await createPR(run, state, gitOps);
observer.onPipelineComplete(state);
return state;
```

PR creation is a pipeline runner responsibility (not scheduler, not observer, not GitOps). It reads the final state and produces the PR with:
- **All success:** full summary, all changes, ready for review
- **Partial:** what succeeded + report of what failed, fix agent attempts, specific errors
- **All failed:** no PR, state file and logs contain diagnostics

**Preflight:**
```typescript
await gitOps.checkCleanState();
await gitOps.runHookTests();
await gitOps.ensureWasm(run.launchDir);
```

### 10. Orchestrator Pattern

The pipeline runs autonomously. An orchestrator agent (or admin) launches it, monitors progress, and answers questions — without intervening.

```bash
# Launch
npx tsx scripts/sdk/pipeline-runner.ts config.yaml &

# Query status (non-blocking)
cat /tmp/ganttlet-logs/{phase}-{suffix}/pipeline-state.json | jq '.nodes | to_entries[] | select(.value.status != "success")'

# What's the curator doing?
tail -20 /tmp/ganttlet-logs/{phase}-{suffix}/curator-attempt1.log

# Pipeline completes → PR created → human reviews PR
```

### CLI

```bash
npx tsx scripts/sdk/pipeline-runner.ts config.yaml                  # default (FileLogObserver)
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --watch           # admin tmux
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --ci              # GitHub Actions
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --resume          # retry from state
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --max-parallel 10 # concurrency
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --only a,b        # subset + transitive deps
```

## Config Format

### Full DAG
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
  - id: groupD
    prompt: docs/prompts/phase19/groupD.md
    branch: feature/phase19-bash-integration
    merge_message: "feat: bash integration"
    depends_on: [groupA, groupB]
```

### Stages sugar
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
  - name: "Curate"
    groups:
      - id: scheduling-engine
        prompt: docs/prompts/curation/curator.md
        prompt_vars: { SKILL: scheduling-engine }
        policy: curator
        branch: curation/scheduling-engine
        merge_message: "docs: curate scheduling-engine skill"
```

## Failure & Recovery

| Failure | Handler | Recovery |
|---|---|---|
| Agent fails | Scheduler retries up to `maxRetries` | `--resume` retries failed, skips succeeded |
| Merge conflict | Fix agent in merge worktree, retry | `--resume` retries merge |
| Verify fails | Fix agent in merge worktree, retry up to 3 | `--resume` retries verify |
| Pipeline crash | State file persists | `--resume` resets `running`→`ready`, cleans stale worktrees |
| Process abort | SIGINT/SIGTERM → `kill_tree` all PIDs | State saved before exit |

Pipeline always ends with a PR (partial results reported) or all-failed (logs only). No human intervention during execution.

## What Changes

### New (~800 lines)
| File | Purpose |
|---|---|
| `dag.ts` | YAML parser, validator, desugar, cycle detection |
| `scheduler.ts` | Pure state machine |
| `git-ops.ts` | Typed git/build interface |
| `pipeline-runner.ts` | Event-driven composition + CLI |
| `observers/file-log.ts` | Structured log files |
| `observers/tmux.ts` | Tmux pane rendering |
| `observers/stdout.ts` | CI output |
| `__tests__/dag.test.ts` | Config parsing, cycles, desugar |
| `__tests__/scheduler.test.ts` | Exhaustive state transitions |
| `__tests__/pipeline-runner.test.ts` | Integration with mock executor |
| `__tests__/git-ops.test.ts` | Integration with real git |

### Modified
| File | Change |
|---|---|
| `types.ts` | Add GroupSpec, NodeState, RunIdentity, PipelineState, DAGNode |
| `agent-runner.ts` | Add event callback to callQuery, preserve canUseTool |

### Unchanged
`attempt-machine.ts`, `policy-registry.ts`, `policies/*.ts`, `prompts.ts`, `metrics.ts`, all existing tests, guard binary, `test-hooks.sh`

### Deprecated
`stage.sh`, `watch.sh`, `agent.sh`, `config.sh`, `launch-phase.sh`, `curate-skills.sh`, `generate-retry-config.sh`

### Kept (called from TypeScript)
`merge.sh` core, `worktree.sh` core, `validate.sh` core, `verify.sh`, `full-verify.sh`, `test-hooks.sh`, `patch-sdk-skills-permission.py`

## Implementation Plan

### Phase 1a: Types + DAG + Scheduler
Pure, no I/O. Unit tests only. `full-verify.sh` at end.

### Phase 1b: GitOps
Integration tests with real git repos in /tmp. `full-verify.sh` at end.

### Phase 2: Pipeline runner + file observer + E2E
Event-driven loop, state writes, stall detection, SIGINT handler, `--resume`, `--max-parallel`. Integration tests with mock executor. E2E tests for `--resume` (required for user-facing CLI). End-to-end curation test. `full-verify.sh` at end.

### Phase 3: Tmux observer
Unit tests for state/formatting. Manual test for rendering. `full-verify.sh` at end.

### Phase 4: Stdout observer + CI
Unit tests. `full-verify.sh` at end.

### Phase 5: Migration + cleanup
Update YAML configs, update docs/skills, remove deprecated bash. `full-verify.sh` at end.

### Phase 6: Full validation + polish
Full curation run on all 8 skills. Additional E2E tests for `--watch` and `--ci` (if not already covered). Debrief.

## Success Criteria

- [ ] Curation (5 reviewers → 1 curator) runs with one command, no env vars
- [ ] Phase 19 config (3 parallel → 1 dependent) runs without modification
- [ ] `--resume` retries only failed nodes
- [ ] `--watch` shows tmux TUI equivalent to current WATCH mode
- [ ] All existing tests pass (120+)
- [ ] Scheduler tests exhaustive (~180 lines for ~60 lines of code)
- [ ] State file queryable with `jq`
- [ ] `full-verify.sh` passes at every phase boundary
- [ ] E2E tests for CLI flags
- [ ] Zero new npm dependencies

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Tmux observer complexity | Phase 3 independent — file log works without it |
| Agent-runner interface | Adapter pattern — GroupSpec→RunnerOptions is the seam |
| Merge logic (WASM, Cargo.lock) | GitOps wraps existing merge.sh, doesn't rewrite |
| SDK patch dependency (#37157) | patch-sdk-skills-permission.py warns on SDK updates |
| Same-commit state clash | `--resume` explicit opt-in, default overwrites |
| Event loop complexity | `Promise.race` is standard; mock executor tests cover timing |
| Process orphans | SIGINT/SIGTERM + kill_tree |
