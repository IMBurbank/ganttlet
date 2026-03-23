# Orchestration Redesign: DAG-Based Pipeline Runner

**Date:** 2026-03-23
**Branch:** `worktree-curation-test-run`
**Status:** Planning
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
4. **Pure scheduling logic.** The scheduler is a pure function (like `attempt-machine.ts`). Given state, return actions. No I/O.
5. **DAG, not stages.** Groups declare dependencies. The scheduler runs groups when their dependencies are met. Stages are syntactic sugar.
6. **Bash does bash things.** Git operations, builds, file copying — called via typed interface from TypeScript.

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

### 1. DAG Parser (`dag.ts`, ~60 lines)

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

function parseConfig(configPath: string): { run: Partial<RunIdentity>; groups: GroupSpec[] }
```

Responsibilities:
- Parse YAML, validate required fields
- Detect cycles in dependency graph (error)
- Validate all `dependsOn` refs exist (error)
- Desugar `stages:` syntax into explicit `dependsOn`
- Support both `stages:` (common pattern) and `groups:` with `dependsOn:` (complex DAGs)

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

### 2. Scheduler (`scheduler.ts`, ~50 lines)

Pure state machine. Given DAG + current state → next actions.

```typescript
interface GroupState {
  status: 'blocked' | 'ready' | 'running' | 'success' | 'failure' | 'skipped';
  merged: boolean;         // has this group's branch been merged into merge target?
  failureReason?: 'agent' | 'merge_conflict' | 'verify_failed' | 'timeout' | 'budget' | 'dependency';
  attempt: number;
  sessionId?: string;
  costUsd: number;
  turns: number;
  logFile: string;
}

type Action =
  | { type: 'run'; group: GroupSpec; workdir: string }
  | { type: 'merge'; branches: string[]; verify: boolean }
  | { type: 'complete'; status: 'success' | 'partial' | 'failed' | 'deadlock' }

function nextActions(groups: GroupSpec[], state: Record<string, GroupState>): Action[]
```

Logic (~40 lines):
1. For each `blocked` group: if all `dependsOn` are `success` → `ready`. If any `dependsOn` is `failure`/`skipped` → `skipped`.
2. For each `ready` group: if branch dependencies aren't merged → emit `merge` action first.
3. For each `ready` group with merges complete: emit `run` action.
4. If no actions and all groups are terminal → emit `complete`.
5. If no actions and some groups are non-terminal → `deadlock`.

No I/O. No side effects. Testable with the same exhaustive approach as `attempt-machine.ts`.

### 3. Executor (existing `agent-runner.ts`, unchanged)

Already well-designed: policies, attempt machine, stream events, `canUseTool`, metrics.

Thin adapter from GroupSpec:
```typescript
function groupSpecToRunnerOptions(spec: GroupSpec, run: RunIdentity): RunnerOptions {
  return {
    group: spec.id,
    phase: run.phase,
    workdir: spec.branch ? worktreePath(spec) : run.launchDir,
    prompt: spec.prompt,
    logFile: path.join(run.logDir, `${spec.id}.log`),
    policy: spec.policy ?? 'default',
    agent: spec.agent,
    promptVars: { ...spec.promptVars, LOG_DIR: run.logDir },
    outputFile: spec.output ? path.join(run.logDir, spec.output) : undefined,
  };
}
```

`LOG_DIR` is injected here — not in wrapper prompts, not in env vars. The executor resolves it from the RunIdentity.

### 4. GitOps (`git-ops.ts`, ~80 lines)

Typed interface over shell commands. Called via `execSync`.

```typescript
interface GitOps {
  createWorktree(branch: string, base: string): string;  // returns path
  removeWorktree(path: string): void;
  mergeBranch(worktree: string, branch: string): 'merged' | 'conflict' | 'up-to-date';
  verify(worktree: string): { tsc: boolean; vitest: boolean; cargo: boolean };
  copyWasm(from: string, to: string): void;
  npmInstall(dir: string): void;
  ensureWasm(launchDir: string): void;  // preflight: copy from main repo if missing
}
```

Merge serialization: the pipeline runner holds a merge lock (simple `Promise` chain).
Only one merge at a time on the merge worktree.

### 5. Pipeline State (`pipeline-state.json`)

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
  groups: Record<string, GroupState>;
  status: 'running' | 'complete' | 'partial' | 'failed';
  createdAt: string;
  updatedAt: string;
}
```

Written after: each group completion, each merge, pipeline completion.

On resume: load state, reset `running` → `ready` (crash recovery), skip `success` groups.

### 6. Observer (pluggable)

```typescript
interface Observer {
  onGroupStart(id: string, spec: GroupSpec): void;
  onAgentEvent(id: string, event: AgentEvent): void;
  onGroupComplete(id: string, state: GroupState): void;
  onMerge(branch: string, result: string): void;
  onVerify(result: { tsc: boolean; vitest: boolean; cargo: boolean }): void;
  onPipelineComplete(state: PipelineState): void;
}
```

Implementations:
- **FileLogObserver** (~40 lines): structured log files with `[turn N] [tool] [text]`. Agent orchestrators read these.
- **TmuxObserver** (~100 lines): renders to tmux panes. Admin attaches to watch. Creates one window per running group.
- **StdoutObserver** (~30 lines): summary lines for CI. Exit code reflects status.

All three observe the same execution from agent-runner's `includePartialMessages` stream.

### 7. Pipeline Runner (`pipeline-runner.ts`, ~100 lines)

Composition layer. Receives all dependencies as arguments (DI for testing).

```typescript
async function runPipeline(
  groups: GroupSpec[],
  run: RunIdentity,
  executor: (opts: RunnerOptions, onEvent: (e: AgentEvent) => void) => Promise<AgentResult>,
  gitOps: GitOps,
  observer: Observer,
  statePath: string,
): Promise<PipelineState>
```

Core loop:
```typescript
const state = loadOrCreateState(statePath, groups);
const mergeLock = createMutex();

while (true) {
  const actions = nextActions(groups, state.groups);

  const completeAction = actions.find(a => a.type === 'complete');
  if (completeAction) {
    state.status = completeAction.status;
    break;
  }

  // Execute merges first (serialized)
  for (const action of actions.filter(a => a.type === 'merge')) {
    await mergeLock.run(async () => {
      for (const branch of action.branches) {
        const result = await gitOps.mergeBranch(mergeWorktree, branch);
        observer.onMerge(branch, result);
        if (result === 'conflict') markGroupFailed(state, branch, 'merge_conflict');
      }
      if (action.verify) {
        const vr = await gitOps.verify(mergeWorktree);
        observer.onVerify(vr);
      }
    });
    markMerged(state, action.branches);
    saveState(statePath, state);
  }

  // Execute ready groups in parallel
  const runActions = actions.filter(a => a.type === 'run');
  await Promise.all(runActions.map(async (action) => {
    const spec = action.group;
    const workdir = spec.branch
      ? await gitOps.createWorktree(spec.branch, run.mergeTarget)
      : run.launchDir;

    state.groups[spec.id].status = 'running';
    observer.onGroupStart(spec.id, spec);

    const result = await executor(
      groupSpecToRunnerOptions(spec, run),
      (event) => observer.onAgentEvent(spec.id, event)
    );

    state.groups[spec.id] = {
      ...state.groups[spec.id],
      status: result.failed ? 'failure' : 'success',
      ...result,
    };

    observer.onGroupComplete(spec.id, state.groups[spec.id]);
    saveState(statePath, state);
  }));
}
```

### CLI Entry Point (~30 lines)

```bash
# All three contexts:
npx tsx scripts/sdk/pipeline-runner.ts config.yaml              # agent/default
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --watch       # admin tmux
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --ci          # GitHub Actions
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --resume      # retry after failure
npx tsx scripts/sdk/pipeline-runner.ts config.yaml --stage 2     # run specific stage only

# Backwards compat wrapper:
./scripts/launch-phase.sh config.yaml                            # → delegates to pipeline-runner.ts
```

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

### Per-group prompt wrapper files eliminated

Current: 9 wrapper files (one per skill) with nearly identical content.
Proposed: `prompt` + `prompt_vars` in YAML. No wrappers.

The executor resolves `{SKILL}`, `{ANGLE}`, `{LOG_DIR}` in the prompt template
before passing to agent-runner. `LOG_DIR` is injected from RunIdentity — never
needs to be in a wrapper file.

## Failure & Recovery

### Group failure
- Group marked `failure` in state
- Independent groups continue
- Dependent groups marked `skipped(dependency)`
- Pipeline completes as `partial`
- Resume: `--resume` retries failed, skips succeeded, unblocks skipped

### Merge conflict
- Group that triggered merge marked `failure(merge_conflict)`
- Human/agent resolves conflict in merge worktree
- Resume: re-attempts merge, continues if resolved

### Verification failure
- Pipeline runner spawns fix agent (like current merge.sh pattern)
- Retry verification up to 3 times
- If unfixable: downstream group marked `failure(verify_failed)`

### Pipeline crash
- State file written after each group completion
- On restart: `running` groups reset to `ready` (can't know if they finished)
- Session IDs preserved for agent-runner resumption

### Retry with no waste
```bash
# First run — curator fails
$ npx tsx pipeline-runner.ts config.yaml
# State: 5 reviewers=success, curator=failure

# Fix issue, resume — only retries curator
$ npx tsx pipeline-runner.ts config.yaml --resume
# State: 5 reviewers=success(skipped), curator=success
```

No `generate-retry-config.sh`. No manual cleanup. No re-running succeeded groups.

## What Changes

### New files (~500 lines total)

| File | Lines | Purpose |
|---|---|---|
| `scripts/sdk/dag.ts` | ~60 | YAML parser, validator, stages→DAG desugar |
| `scripts/sdk/scheduler.ts` | ~50 | Pure state machine: state → actions |
| `scripts/sdk/git-ops.ts` | ~80 | Typed interface over git/npm/cargo |
| `scripts/sdk/pipeline-runner.ts` | ~100 | Composition + CLI entry point |
| `scripts/sdk/observers/file-log.ts` | ~40 | Structured log files |
| `scripts/sdk/observers/tmux.ts` | ~100 | Tmux pane rendering |
| `scripts/sdk/observers/stdout.ts` | ~30 | CI summary output |
| `scripts/sdk/__tests__/dag.test.ts` | ~100 | Config parsing, cycle detection |
| `scripts/sdk/__tests__/scheduler.test.ts` | ~150 | State transitions, all edge cases |
| `scripts/sdk/__tests__/pipeline-runner.test.ts` | ~200 | Integration with mock executor |

### Unchanged (well-designed, keep as-is)

| File | Lines | Why |
|---|---|---|
| `agent-runner.ts` | 607 | Execution engine — already correct |
| `attempt-machine.ts` | 65 | Pure state machine — pattern for scheduler |
| `policy-registry.ts` | 46 | Open/closed — composable |
| `policies/*.ts` | 160 | Domain knowledge, correctly separated |
| `types.ts` | 100 | Clean, generic (expanded with GroupSpec, PipelineState) |
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
| `scripts/lib/agent.sh` (SDK path) | 80 | Direct `runAgent()` call |
| `scripts/lib/agent.sh` (legacy path) | 60 | Removed (SDK runner is only engine) |
| `scripts/lib/config.sh` | 135 | `dag.ts` |
| `scripts/launch-phase.sh` | 399 | CLI in `pipeline-runner.ts` (~30 lines) |
| `scripts/curate-skills.sh` | 96 | Config-only (YAML handles the flow) |
| `scripts/generate-retry-config.sh` | — | `--resume` reads state file |

### Kept but called from TypeScript instead of bash

| File | Purpose |
|---|---|
| `scripts/lib/merge.sh` core | Git merge + per-branch verification logic → `git-ops.ts` |
| `scripts/lib/worktree.sh` core | Worktree create/remove → `git-ops.ts` |
| `scripts/lib/validate.sh` core | tsc/vitest/cargo parallel run → `git-ops.ts` |
| `scripts/verify.sh` | Guard rebuild + verification (PostToolUse hook, unchanged) |
| `scripts/full-verify.sh` | Pre-commit verification (unchanged) |
| `scripts/test-hooks.sh` | Hook integration tests (unchanged) |

## Implementation Plan

### Phase 1: Core abstractions (testable without running agents)

**Files:** `types.ts` (expand), `dag.ts`, `scheduler.ts`, `git-ops.ts`
**Tests:** `dag.test.ts`, `scheduler.test.ts`

1. Add `GroupSpec`, `GroupState`, `RunIdentity`, `PipelineState`, `Action` to types.ts
2. Implement DAG parser with stages desugar and cycle detection
3. Implement scheduler as pure function with exhaustive tests
4. Implement GitOps interface with execSync (worktree, merge, verify, WASM)
5. Test DAG parser with curation config and phase 19 config
6. Test scheduler with: normal flow, partial failure, resume, deadlock, merge gating

**Validation:** `npx vitest run` — all new + existing tests pass.

### Phase 2: Pipeline runner + file observer

**Files:** `pipeline-runner.ts`, `observers/file-log.ts`
**Tests:** `pipeline-runner.test.ts`

1. Implement pipeline runner composition loop
2. Implement FileLogObserver (replaces current stream logger in agent-runner)
3. Move `canUseTool` and `includePartialMessages` config into executor adapter
4. Implement CLI entry point with `--resume` support
5. Integration test with mock executor (no real API calls)

**Validation:** Run curation test config end-to-end. Compare results with previous run.

### Phase 3: Tmux observer

**Files:** `observers/tmux.ts`
**Tests:** Manual — admin attaches and watches

1. Implement TmuxObserver: creates session, one window per running group
2. Renders `[turn N] [tool] [text]` events to pane
3. Shows status summary in first window
4. `--watch` flag selects this observer

**Validation:** Run with `--watch`, attach to tmux, verify rich output.

### Phase 4: Stdout observer + CI support

**Files:** `observers/stdout.ts`
**Tests:** `stdout-observer.test.ts`

1. Implement StdoutObserver: summary lines, progress, final status
2. Exit code: 0 = success, 1 = failed/partial
3. `--ci` flag selects this observer
4. Artifact collection: state file + logs in a known location

**Validation:** Run in simulated CI context.

### Phase 5: Migration + cleanup

1. Update `launch-phase.sh` to delegate to `pipeline-runner.ts`
2. Update `curate-skills.sh` to use new config format (or remove — config handles flow)
3. Update YAML configs (curation, phase 19) to new format
4. Update CLAUDE.md, skills, and docs to reference new architecture
5. Remove deprecated bash scripts after validation
6. Run full-verify.sh

**Validation:** Both curation and code-phase configs produce correct results.

### Phase 6: Polish

1. Update `generate-retry-config.sh` → remove (replaced by `--resume`)
2. Update orchestrator prompt to reference new CLI
3. Run curation on all 8 skills as final validation
4. Write debrief

## Test Strategy

| Component | Test type | Approach |
|---|---|---|
| DAG parser | Unit | Valid/invalid YAML, cycle detection, desugar |
| Scheduler | Unit | Exhaustive state transitions (like attempt-machine) |
| GitOps | Integration | Real git repo in /tmp |
| Pipeline runner | Integration | Mock executor returning canned results |
| FileLogObserver | Unit | Mock events → verify file output |
| TmuxObserver | Manual | Admin watches live run |
| StdoutObserver | Unit | Mock events → verify stdout |
| End-to-end | Integration | Real curation run (5 reviewers + 1 curator) |

## Success Criteria

- [ ] Curation pipeline (5 reviewers → 1 curator) runs with one command, no env vars
- [ ] Phase 19 config (3 parallel → 1 dependent) runs without modification
- [ ] `--resume` after partial failure retries only failed groups
- [ ] `--watch` shows tmux TUI equivalent to current WATCH mode
- [ ] All existing SDK tests pass (120 tests)
- [ ] Pipeline runner tests cover: normal, partial failure, resume, deadlock, merge gating
- [ ] Scheduler tests are exhaustive (like attempt-machine: ~150 lines for ~50 lines of code)
- [ ] No env var threading between components
- [ ] State file is queryable: `cat pipeline-state.json | jq '.groups | to_entries[] | "\(.key): \(.value.status)"'`
- [ ] full-verify.sh passes

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Tmux observer harder than expected | Phase 3 is independent — file log works without it |
| Agent-runner interface changes | Adapter pattern — GroupSpec→RunnerOptions is the seam |
| WATCH mode parity | TmuxObserver can call existing tmux-supervisor.sh functions |
| Merge logic is complex | GitOps wraps existing merge.sh logic, doesn't rewrite it |
| CI workflow untested | StdoutObserver is simple; real CI testing is Phase 4 |
