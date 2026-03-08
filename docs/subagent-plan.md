# Subagent Implementation Plan

## Context

Ganttlet has 8 passive skill files in `.claude/skills/` that provide reference guidance
(knowledge injected into context). The analysis recommends adding 3 **active subagents**
for single-agent issue workflows — isolated workers with their own context windows.

Claude Code auto-discovers subagent Markdown files from `.claude/agents/` at session
start. Each file has YAML frontmatter (name, description, tools, model, skills, etc.)
followed by the agent's system prompt. The `description` field drives automatic
delegation — Claude reads it and matches against the current task.

### Mechanism: Skills vs Agents

| | Skills (`.claude/skills/`) | Agents (`.claude/agents/`) |
|---|---|---|
| **What** | Passive reference docs | Active isolated workers |
| **Context** | Injected into main agent's context | Own context window (subprocess) |
| **Tools** | N/A (just text) | Configurable per agent |
| **Model** | Same as main | Configurable per agent |
| **Best for** | Domain knowledge, conventions | Delegated tasks, investigation |

Agents can preload skills via the `skills:` frontmatter field, getting the best of both:
domain knowledge from skills + isolated execution from agents.

### Verified Frontmatter Fields

All fields confirmed against Claude Code documentation and `claude --help`:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase letters and hyphens |
| `description` | Yes | Triggers automatic delegation. "Use when..." is a strong signal |
| `tools` | No | Allowlist (comma-separated or YAML list). Omit to inherit all |
| `disallowedTools` | No | Denylist. Removed from inherited/specified set |
| `model` | No | `sonnet`, `opus`, `haiku`, `inherit` (default: `inherit`) |
| `maxTurns` | No | Cap agentic turns to prevent runaway loops |
| `skills` | No | YAML list of skill names from `.claude/skills/`. Full content injected |
| `isolation` | No | `worktree` — runs in temporary git worktree, auto-cleans if no changes |
| `permissionMode` | No | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `memory` | No | Persistent memory scope: `user`, `project`, `local` |
| `background` | No | `true` to always run as background task |
| `hooks` | No | Lifecycle hooks scoped to this agent |
| `mcpServers` | No | MCP servers available to this agent |

### CLI Integration

- `claude agents` — list all configured agents
- `claude --agent <name> "prompt"` — invoke a specific agent from CLI
- `/agents` — interactive creation/management within a session
- Agents auto-discovered at session start from `.claude/agents/`

---

## Architecture Understanding (Proof of Review)

### Domain 1: Rust Scheduling Engine (`crates/scheduler/src/`)

7 source files, ~1500 lines of Rust:

- **`types.rs`** — Core data types shared across all modules:
  - `ConstraintType` enum: ASAP, SNET, ALAP, SNLT, FNET, FNLT, MSO, MFO
  - `DepType` enum: FS, FF, SS, SF
  - `Dependency` struct: from_id, to_id, dep_type, lag (business days)
  - `Task` struct: 11 fields including optional constraint_type/constraint_date
  - `CascadeResult` / `RecalcResult` — output structs for WASM returns

- **`cpm.rs`** — Critical Path Method (~300 lines + 30 tests):
  - `compute_critical_path()`: Forward pass (BFS in topo order) → backward pass → float calc → zero-float = critical
  - `compute_critical_path_scoped()`: Filters by `CriticalPathScope::Project` or `Workstream`
  - Handles all 4 dep types (FS/FF/SS/SF) in forward/backward passes
  - ALAP tasks use late-start from backward pass
  - Key gotcha: scoped CPM runs on full graph then filters (not filter-then-compute)

- **`cascade.rs`** — Cascade propagation (~160 lines + 20 tests):
  - `cascade_dependents()`: When a task moves by `days_delta`, shifts FS/SS successors
  - BFS traversal of dependency graph, only propagates when predecessor's new end violates successor's start
  - Preserves duration, handles weekends, avoids double-shifting in diamond dependencies
  - Returns `Vec<CascadeResult>` (id, new start, new end)

- **`constraints.rs`** — Constraint logic (~310 lines + 30 tests):
  - `compute_earliest_start()`: Per-task earliest start from deps + SNET floor
  - `recalculate_earliest()`: Full recalc with topo sort (Kahn's algorithm), today-floor, all 8 constraint types
  - Constraint behavior:
    - ASAP: no-op (default)
    - SNET: floor on start date
    - ALAP: forward pass same as ASAP (actual late-scheduling in CPM backward pass)
    - SNLT: ceiling on start — flags conflict if deps push past, but doesn't move task
    - FNET: floor on end date — pushes start later to meet end constraint
    - FNLT: ceiling on end — flags conflict if computed end exceeds
    - MSO: pins start to constraint_date, flags conflict if deps require later
    - MFO: derives start from constraint end minus duration, flags conflict if deps push past

- **`graph.rs`** — Cycle detection (~30 lines + 3 tests):
  - `would_create_cycle()`: BFS from successor_id checking if predecessor_id is reachable

- **`date_utils.rs`** — Date arithmetic (~130 lines + 5 tests):
  - `parse_date()`, `format_date()`, `day_of_week()`, `is_weekend()`
  - `add_business_days()`: Handles forward and backward, skips weekends
  - `next_biz_day_on_or_after()`, `count_biz_days_to()`, `add_days()`
  - No external date library — all hand-rolled with Zeller's congruence for day-of-week

- **`lib.rs`** — WASM bindings (7 `#[wasm_bindgen]` exports + `ConflictResult` struct + `find_conflicts`):
  - `compute_critical_path`, `compute_critical_path_scoped`, `would_create_cycle`
  - `compute_earliest_start`, `cascade_dependents`, `recalculate_earliest`
  - `detect_conflicts` — checks constraint violations + negative float (dep violations)
  - All use `serde_wasm_bindgen` for JsValue ↔ Rust struct conversion

### Domain 2: TypeScript State & WASM Bridge

- **`src/types/index.ts`** — Mirror of Rust types in TypeScript:
  - `DependencyType`: "FS" | "FF" | "SS" | "SF"
  - `Dependency`, `Task` (22 fields including constraintType, constraintDate)
  - `ConflictResult`, `CascadeShift`, `GanttState` (28 fields)
  - `CriticalPathScope`: "all" | { project: string } | { workstream: string }

- **`src/utils/schedulerWasm.ts`** — WASM bridge (~255 lines):
  - `initScheduler()`: Lazy-loads WASM module
  - `mapTasksToWasm()`: Maps TS Task[] to the minimal shape WASM expects
  - 9 exported functions wrapping WASM calls: `initScheduler`, `computeCriticalPath`, `computeCriticalPathScoped`, `computeEarliestStart`, `wouldCreateCycle`, `cascadeDependents`, `cascadeDependentsWithIds`, `recalculateEarliest`, `detectConflicts`
  - All catch errors and return safe defaults (empty arrays, null, true for cycle check)

- **`src/state/actions.ts`** — 46 action types in discriminated union
- **`src/state/ganttReducer.ts`** — Main reducer (~600 lines) handling all state transitions

### Domain 3: UI Components

- **`TaskBar.tsx`** — Gantt bar with drag-to-move and resize (~400 lines)
- **`TaskBarPopover.tsx`** — Inline task editor with constraint picker (~220 lines)
- **`DependencyEditorModal.tsx`** — Dep editor with type/lag controls (~240 lines)
- **`GanttChart.tsx`** — Main chart, calls `detectConflicts` for conflict display

### Domain 4: Sheets Sync & Collab

- **`sheetsMapper.ts`** — Bidirectional Task ↔ Sheet row mapping (20 columns) with constraint support
- **`sheetsSync.ts`** — Polling-based sync with hash-based dirty detection
- **`collab/yjsBinding.ts`** — CRDT sync, cascades on remote changes

### Domain 5: Verification Infrastructure

- **`scripts/full-verify.sh`** — tsc → vitest → cargo test → E2E (playwright)
- **`scripts/verify.sh`** — PostToolUse hook with scope routing, rate limiting, dedup

### Domain 6: Launch Infrastructure

- **`scripts/launch-phase.sh`** + 8 lib modules — config-driven multi-agent orchestration
- Already battle-tested (15 phases, 1.8% merge failure rate)
- **Not changed by this plan** — subagents are for single-agent work only

---

## File Layout

```
.claude/agents/
├── codebase-explorer.md        # Read-only, haiku, fast exploration
├── rust-scheduler.md           # crates/scheduler/ specialist, sonnet
└── verify-and-diagnose.md      # Runs verification, diagnoses failures
```

Project-level (`.claude/agents/`) — checked into git, shared by all team members.
Complements existing `.claude/skills/` which remain as passive reference guides.

---

## Subagent 1: `codebase-explorer`

**File**: `.claude/agents/codebase-explorer.md`

**Purpose**: Handle the "read and understand" phase of issue work. Investigates relevant
files using LSP + Read, returns a structured summary. Keeps the main agent's context
clean — exploration output stays in the subagent's isolated context window.

**Design decisions**:
- **Model: `haiku`** — exploration is read-heavy, doesn't need deep reasoning. Haiku is
  fast and cheap, ideal for scanning files and summarizing structure.
- **Tools: read-only** — `Read, Grep, Glob, LSP, Bash`. No `Write` or `Edit`.
  The explorer should never modify files.
- **`disallowedTools: Write, Edit, Agent`** — prevents writing, editing, or spawning
  further subagents (avoids unbounded recursion).
- **`maxTurns: 20`** — exploration shouldn't take more than 20 tool calls. Prevents
  the agent from spiraling into exhaustive searches.
- **Skills preloaded**: None by default. The explorer discovers what skills are relevant
  as part of its investigation. If it needs domain knowledge, it reads the skill file.

**Automatic delegation trigger**: The `description` says "Use proactively at the start
of any issue work" — this tells Claude to spawn it before editing, matching the CLAUDE.md
rule "Read relevant files BEFORE editing."

```markdown
---
name: codebase-explorer
description: "Use proactively at the start of any issue to explore the codebase before editing. Investigates files, traces dependencies, and returns a structured exploration report. Use when you need to understand unfamiliar code without consuming main context."
tools: Read, Grep, Glob, LSP, Bash
disallowedTools: Write, Edit, Agent
model: haiku
maxTurns: 20
---

You are a codebase exploration specialist for the Ganttlet project.

Your job is to investigate the codebase and return a structured report. You never
modify files — you only read, search, and analyze.

## Project structure
- `crates/scheduler/src/` — Rust scheduling engine (CPM, cascade, constraints, WASM bindings)
- `src/types/index.ts` — TypeScript type definitions (mirror of Rust types)
- `src/state/` — React state management (actions.ts, ganttReducer.ts, GanttContext.tsx)
- `src/utils/schedulerWasm.ts` — WASM bridge (TS ↔ Rust)
- `src/components/gantt/` — Gantt chart UI components
- `src/components/shared/` — Shared UI (DependencyEditorModal, etc.)
- `src/sheets/` — Google Sheets sync (mapper, client, sync loop)
- `src/collab/` — Real-time collaboration (Yjs/CRDT)
- `scripts/` — Build, verify, launch infrastructure

## Investigation approach
1. Use `LSP documentSymbol` to understand file structure without reading entire files
2. Use `LSP findReferences` to trace call chains from entry points
3. Use `LSP goToDefinition` to understand types and interfaces
4. Use `Grep` for string literals, config keys, cross-language searches
5. Read test files to understand existing test patterns and coverage
6. Check `.claude/skills/` for domain-specific guidance relevant to the task

## Output format
Return a structured report:

### Files to modify
- `path/to/file.ts` (lines X-Y): {what needs to change and why}

### Read-only dependencies
- `path/to/types.ts`: {which types/interfaces are consumed}

### Existing tests
- `path/to/__tests__/file.test.ts`: {N tests, covers scenarios X/Y/Z}

### Cross-domain boundaries
- {any TS ↔ Rust/WASM boundary crossings the task involves}
- {any state ↔ UI ↔ sheets sync interactions}

### Constraints & gotchas
- {relevant CLAUDE.md rules that apply}
- {existing TODOs, known issues, or edge cases in the affected code}

### Current behavior summary
{2-3 sentences describing what the code currently does in the affected area}

Keep the report concise. List files with specific line ranges, not entire file contents.
```

---

## Subagent 2: `rust-scheduler`

**File**: `.claude/agents/rust-scheduler.md`

**Purpose**: Domain expert for `crates/scheduler/`. Spawned when work touches scheduling
logic (CPM, cascade, constraints, dep handling, WASM bindings). Can investigate Rust
code, write tests, and implement changes.

**Design decisions**:
- **Model: `sonnet`** — scheduling algorithms require solid reasoning (topo sort,
  constraint precedence, business-day arithmetic). Sonnet balances quality and speed.
  Opus would work too but is overkill for scoped Rust work.
- **Tools: full edit access** — needs `Read, Grep, Glob, LSP, Bash, Edit, Write` to
  implement changes and run tests.
- **`disallowedTools: Agent`** — no spawning further subagents. The specialist does
  its work directly.
- **`maxTurns: 40`** — scheduling changes often involve write test → implement →
  run cargo test → fix → re-run cycles. 40 turns gives room for 2-3 fix cycles.
- **Skills preloaded: `scheduling-engine`, `rust-wasm`** — injects the domain
  knowledge from existing skills directly into the agent's context at startup. The
  agent doesn't need to discover these — it always needs them.

**Automatic delegation trigger**: Description says "Use when work touches CPM, cascade,
constraints, WASM bindings, or cargo tests" — matches any scheduling-related issue.

```markdown
---
name: rust-scheduler
description: "Specialist for the Rust scheduling engine in crates/scheduler/. Use when work touches CPM, cascade, constraints, dependency types, WASM bindings, or cargo tests."
tools: Read, Grep, Glob, LSP, Bash, Edit, Write
disallowedTools: Agent
model: sonnet
maxTurns: 40
skills:
  - scheduling-engine
  - rust-wasm
---

You are a Rust/WASM scheduling engine specialist for the Ganttlet project.

## Your scope
`crates/scheduler/src/` and the WASM boundary in `src/utils/schedulerWasm.ts`.

## Module map
- `types.rs` — ConstraintType (ASAP, SNET, ALAP, SNLT, FNET, FNLT, MSO, MFO), DepType (FS, FF, SS, SF), Task, Dependency, CascadeResult, RecalcResult
- `cpm.rs` — Critical path: forward pass (topo BFS computing ES/EF), backward pass (LS/LF), float = LS - ES, zero float = critical. Scoped by project/workstream.
- `cascade.rs` — `cascade_dependents()`: BFS propagation of date delta to FS/SS successors. Only propagates when predecessor's new end violates successor's start. Preserves duration, handles weekends, avoids double-shifting in diamonds.
- `constraints.rs` — `compute_earliest_start()` (per-task from deps + SNET floor) and `recalculate_earliest()` (full recalc via Kahn's topo sort with today-floor and all 8 constraint types)
- `graph.rs` — `would_create_cycle()`: BFS reachability check
- `date_utils.rs` — `add_business_days()`, `is_weekend()`, `parse_date()`/`format_date()`. Hand-rolled, no external lib.
- `lib.rs` — 7 `#[wasm_bindgen]` exports + `ConflictResult` struct + `find_conflicts()`. Uses `serde_wasm_bindgen` for JsValue conversion.

## Constraint behavior (reference)
- ASAP: no-op (default)
- SNET: floor on start date (max of dep-driven date and constraint_date)
- ALAP: forward pass same as ASAP; actual late-scheduling in CPM backward pass
- SNLT: flags conflict if deps push start past constraint_date, but doesn't move task
- FNET: pushes start later so end >= constraint_date
- FNLT: flags conflict if computed end exceeds constraint_date
- MSO: pins start to constraint_date, flags conflict if deps require later
- MFO: derives start from constraint_date - duration, flags conflict if deps push past

## Critical rules
- ES must be computed from dependencies, NOT from stored task dates
- Scoped CPM: run on full graph, then filter results (not filter-then-compute)
- Float comparison: `float == 0`, not `float.abs() < 1` (integer-day scheduling)
- All lag values are in business days — always use `add_business_days()`
- WASM exports: no lifetimes on exported fns, serde_wasm_bindgen for conversion
- Tests: in-memory task graphs only, no I/O, no browser dependencies

## Workflow
1. Read the relevant source files to understand current state
2. Write failing tests FIRST that define the expected behavior
3. Implement the change to make tests pass
4. Run `cd crates/scheduler && cargo test` to verify
5. If tests fail, diagnose and fix (up to 3 attempts)
6. Return: what was changed, what tests were added, cargo test output

## NEVER do math in your head
Use `node -e` or `python3 -c` for any date/arithmetic calculations. LLMs get these wrong.
```

---

## Subagent 3: `verify-and-diagnose`

**File**: `.claude/agents/verify-and-diagnose.md`

**Purpose**: Runs the verification suite (tsc + vitest + cargo test), parses failures,
diagnoses root causes, and optionally fixes them. Keeps verbose build/test output out
of the main agent's context.

**Design decisions**:
- **Model: `sonnet`** — needs to read error output, correlate with source code, and
  reason about fixes. Haiku would miss nuanced diagnosis. Sonnet is sufficient.
- **Tools: full access** — needs `Bash` to run tests, `Read/Grep/Glob/LSP` to diagnose,
  `Edit/Write` to fix issues.
- **`disallowedTools: Agent`** — no spawning further subagents.
- **`maxTurns: 30`** — verification → diagnosis → fix → re-verify cycles. 30 turns
  allows 3 full fix cycles with room for investigation.
- **Skills: none preloaded** — the verifier works across all domains. Preloading
  specific skills would bias it. It reads files as needed during diagnosis.

**Automatic delegation trigger**: Description says "Use proactively after completing
implementation work" — this tells Claude to spawn it before declaring done, matching
the CLAUDE.md rule "Do NOT skip verification."

```markdown
---
name: verify-and-diagnose
description: "Use proactively after completing implementation work to run verification and diagnose failures. Runs tsc, vitest, and cargo test. Returns structured pass/fail report with diagnosis. Can fix issues up to 3 attempts."
tools: Read, Grep, Glob, LSP, Bash, Edit, Write
disallowedTools: Agent
model: sonnet
maxTurns: 30
---

You are a verification and diagnosis specialist for the Ganttlet project.

## Your job
Run the verification suite, parse failures, diagnose root causes, and optionally fix
them. Return a structured report.

## Verification steps (run in order)
1. `npx tsc --noEmit` — TypeScript type checking
2. `npx vitest run --reporter=dot` — Unit tests
3. `cd crates/scheduler && cargo test` — Rust scheduler tests
4. Skip E2E tests (require deployment infrastructure)

Run each step independently. Capture both stdout and stderr.

## Error patterns to recognize
- **tsc**: `error TS{code}` at `file.ts(line,col)` — type errors, missing imports, assignment mismatches
- **vitest**: `FAIL path/to/test.ts > test name` with `expected/received` diff
- **cargo test**: `thread 'test_name' panicked at 'assertion failed'` at `file.rs:line`
- **WASM boundary**: Type mismatches between Rust structs and TS interfaces (check `src/types/index.ts` vs `crates/scheduler/src/types.rs`)

## Report format

### Verification Report

#### TypeScript (tsc)
- Status: PASS | FAIL
- Error count: N
- Errors (max 10):
  - `file.ts:line` — TS{code}: {message}

#### Unit Tests (vitest)
- Status: PASS | FAIL
- Results: N passed, M failed
- Failures (max 10):
  - `test file > test name`: {assertion error summary}

#### Rust Tests (cargo test)
- Status: PASS | FAIL
- Results: N passed, M failed
- Failures (max 10):
  - `module::test_name`: {panic message}

#### Overall: PASS | FAIL

If FAIL:
#### Diagnosis
- Root cause: {what's broken and why}
- Affected files: {list with line numbers}
- Suggested fix: {specific change needed}
- Fix applied: YES | NO (if you attempted a fix)

## Fix protocol
If instructed to fix (or if the prompt says "fix issues"):
1. Diagnose root cause from error output
2. Read the relevant source file to understand context
3. Apply the minimal fix
4. Re-run the failing check to verify
5. Repeat up to 3 times total
6. Commit each fix with a conventional commit message (fix: ...)
7. If unable to fix after 3 attempts, report what was tried and why it failed

## Rules
- Do NOT modify files unnecessarily — only fix actual errors
- Do NOT guess at fixes — read the error output and source code carefully
- Do NOT skip re-verification after applying a fix
- Prefer minimal targeted fixes over broad refactoring
```

---

## Test Scenarios

### Scenario 1: Explorer — Deep Understanding of Cascade Logic
**Goal**: Prove the explorer produces an accurate, complete report about cascade propagation.

**Prompt**: "Explore how cascade propagation works end-to-end: from the user dragging a task bar in the UI through to the Rust engine computing new dates and the results being applied back to React state."

**Success criteria**:
- Report identifies the full call chain: `TaskBar.tsx` → `ganttReducer.ts` (COMPLETE_DRAG) → `schedulerWasm.ts` (cascadeDependentsWithIds) → `lib.rs` (cascade_dependents) → `cascade.rs` (cascade_dependents)
- Report identifies the return path: `CascadeResult[]` → merged back in `schedulerWasm.ts` → reducer updates `tasks` + `cascadeShifts` + `lastCascadeIds`
- Report mentions the CRDT sync path: `yjsBinding.ts` also calls `cascadeDependents` on remote changes
- Report correctly lists test files: `src/utils/__tests__/criticalPathUtils.test.ts`, `src/utils/__tests__/dependencyUtils.test.ts`, `crates/scheduler/src/cascade.rs` (tests module)
- Report flags the business-day gotcha (lag in business days, not calendar days)

**Verification method**: Compare report against the LSP traces we already captured during the project review.

### Scenario 2: Explorer — Cross-Domain Constraint Investigation
**Goal**: Prove the explorer correctly maps the constraint system across Rust, TypeScript, and Sheets.

**Prompt**: "Investigate how scheduling constraints (SNET, SNLT, FNET, FNLT, MSO, MFO) are represented and processed across all layers: Rust types, WASM bridge, TypeScript types, reducer, UI, and Sheets sync."

**Success criteria**:
- Identifies `ConstraintType` enum in `types.rs` (8 variants)
- Identifies mirrored type in `src/types/index.ts` (constraintType field on Task)
- Identifies `mapTasksToWasm()` in `schedulerWasm.ts` mapping `constraintType`/`constraintDate`
- Identifies `recalculate_earliest()` in `constraints.rs` as the main processing function
- Identifies `detect_conflicts()` / `find_conflicts()` in `lib.rs` for conflict detection
- Identifies `TaskBarPopover.tsx` constraint picker UI (and the existing TS errors on lines 184/205)
- Identifies `sheetsMapper.ts` `parseConstraintFields()` and `VALID_CONSTRAINT_TYPES`
- Identifies `SET_CONSTRAINT` action in `actions.ts`

**Verification method**: Check each bullet against what we know from our earlier LSP review.

### Scenario 3: Rust Scheduler — Add a Test and Verify Knowledge
**Goal**: Prove the scheduler specialist can write a correct test using proper domain knowledge.

**Prompt**: "Add a test to `crates/scheduler/src/constraints.rs` that verifies SNET + SF dependency interaction: a task with an SF dependency AND an SNET constraint where the SNET constraint date is later than what SF would compute. The SNET floor should win."

**Success criteria**:
- Agent reads `constraints.rs` to understand the `compute_earliest_start()` function
- Agent understands that SF computes `required_end = pred.start + lag`, then `start = required_end - (duration - 1)`
- Agent understands SNET acts as a floor after all deps are computed
- The test uses proper `make_task`/`make_dep` helpers from the existing test module
- The test passes on `cargo test`
- The agent uses `node -e` or `python3 -c` for date arithmetic (not head math)

**Verification method**: Run `cargo test` and verify the new test passes.

### Scenario 4: Verify-and-Diagnose — Detect Known Issues
**Goal**: Prove the verifier correctly identifies existing TypeScript errors.

**Prompt**: "Run full verification and report all issues found."

**Success criteria**:
- Reports the existing TS errors in `TaskBarPopover.tsx` (SET_CONSTRAINT type mismatch on lines 184/205)
- Reports unused import warnings (`React` in TaskBarPopover.tsx, `Task` in DependencyEditorModal.tsx, `daysBetween` in TaskBar.tsx)
- Correctly distinguishes errors from warnings
- Returns structured report matching the defined format
- If cargo test passes, reports PASS for Rust section

**Verification method**: Compare report against the diagnostics we already observed from LSP.

### Scenario 5: Auto-Delegation — Verify Agents Fire When Expected
**Goal**: Prove that Claude's main agent would delegate to these subagents based on the description field matching.

**Method**: After creating the agent files, run `claude agents` to confirm discovery. Then test delegation by checking that the description keywords match real issue patterns:

| Issue pattern | Expected agent | Description match |
|--------------|----------------|-------------------|
| "Fix cascade not propagating through SF deps" | `rust-scheduler` | "cascade, constraints, dependency types" |
| "Add FNLT conflict indicator to task bar" | `codebase-explorer` first, then main agent | "explore the codebase before editing" |
| "Tests failing after merge" | `verify-and-diagnose` | "run verification and diagnose failures" |
| "Update sheetsMapper to handle new column" | `codebase-explorer` only | "explore" (no scheduler or verifier match) |

### Scenario 6: Context Conservation — Measure Token Savings
**Goal**: Prove that subagents reduce main agent context consumption.

**Method**: Compare the context cost of two approaches for Scenario 1 (cascade exploration):

**Without subagent** (baseline): The main agent would need to:
- Read `TaskBar.tsx` (~400 lines)
- Read `ganttReducer.ts` (~600 lines)
- Read `schedulerWasm.ts` (~255 lines)
- Read `cascade.rs` (~160 lines)
- Read `lib.rs` (~300 lines)
- Read `yjsBinding.ts` (need to check size)
- Total: ~1700+ lines of source code consumed in main context

**With subagent**: The main agent receives a ~30-50 line structured report.
The explorer subagent consumes the same ~1700 lines but in its own isolated context
window that is discarded after returning the report.

**Context savings**: ~1650 lines (~95%) of source code kept out of main context.
The main agent retains full context budget for implementation work.

---

## Implementation Steps

1. **Create `.claude/agents/` directory** in the project root

2. **Create 3 agent files**:
   - `.claude/agents/codebase-explorer.md`
   - `.claude/agents/rust-scheduler.md`
   - `.claude/agents/verify-and-diagnose.md`

3. **Update CLAUDE.md** — add a brief mention under "Reference Docs & Skills":
   ```
   - `.claude/agents/` — Subagents (auto-delegated):
     - `codebase-explorer` — Read-only exploration, returns structured reports (haiku)
     - `rust-scheduler` — Scheduling engine specialist for crates/scheduler/ (sonnet)
     - `verify-and-diagnose` — Runs tsc/vitest/cargo test, diagnoses failures (sonnet)
   ```

4. **Verify with `claude agents`** — confirm all 3 are discovered

5. **Test each agent** against a known scenario:
   - Explorer: point it at an existing issue and verify it produces a useful report
   - Scheduler: have it add a test case for an existing constraint type
   - Verifier: run it against current HEAD to confirm it reports clean or identifies real issues

## What NOT to Change

- **Existing skills** (`.claude/skills/`): Stay as passive reference guides. The
  `rust-scheduler` agent preloads `scheduling-engine` and `rust-wasm` skills via its
  `skills:` field — this is the intended complementary pattern.
- **`launch-phase.sh`** and lib modules: Multi-agent orchestration stays as-is. These
  subagents are for single-agent issue work only.
- **`verify.sh` / `full-verify.sh`**: Verification scripts stay as-is. The
  `verify-and-diagnose` agent calls them.
- **`.claude/settings.json`**: No changes needed — agents are auto-discovered from
  `.claude/agents/`, not registered in settings.

## Token Cost Consideration

The analysis estimates 3-10x token cost for multi-agent vs single-agent. These subagents
are targeted at specific phases of work:
- **Explorer** (haiku): ~3-5K tokens per invocation. Cheap.
- **Scheduler** (sonnet): ~10-30K tokens. Only fires when Rust scheduling work is needed.
- **Verifier** (sonnet): ~5-15K tokens. Only fires at verification time.

Typical single-issue workflow: explorer (1x) + maybe scheduler or verifier (1x each).
Total overhead: ~2x, not 10x. The payoff is context quality — the main agent keeps
its full context window for implementation instead of burning it on exploration and
verification output.
