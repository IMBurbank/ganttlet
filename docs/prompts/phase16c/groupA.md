---
phase: 16c
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - CLAUDE.md
    - crates/scheduler/src/date_utils.rs
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/graph.rs
    - crates/scheduler/src/types.rs
    - crates/scheduler/src/lib.rs
    - .claude/agents/rust-scheduler.md
  read_only:
    - crates/scheduler/src/cpm.rs
    - docs/tasks/phase16c.yaml
depends_on: []
tasks:
  - id: A1
    summary: "Add callsite-search rule to CLAUDE.md"
  - id: A2
    summary: "Add //! module docs to date_utils, cascade, constraints, graph, types"
  - id: A3
    summary: "Convert rust-scheduler.md from copy to pointer"
  - id: A4
    summary: "Add crate-level //! doc block to lib.rs"
---

# Phase 16c Group A — CLAUDE.md Callsite Rule + Module Docs

You are implementing Phase 16c Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

Phase 16 (inclusive end-date convention) required 5 code review rounds because agents
repeatedly fixed a pattern in one file but missed identical instances elsewhere. The
`workingDaysBetween` migration took 5 commits across 5 files that should have been 1.
This group adds a CLAUDE.md rule preventing that, adds `//!` module-level doc blocks
to the 5 undocumented Rust modules, and converts `rust-scheduler.md` from a manually
maintained function reference (which drifts) to a pointer directing agents to use LSP.

## Your files (ONLY modify these):

**Modify:**
- `CLAUDE.md` — add callsite-search rule to Agent Behavioral Rules
- `crates/scheduler/src/date_utils.rs` — add `//!` module doc block at top
- `crates/scheduler/src/cascade.rs` — add `//!` module doc block at top
- `crates/scheduler/src/constraints.rs` — add `//!` module doc block at top
- `crates/scheduler/src/graph.rs` — add `//!` module doc block at top
- `crates/scheduler/src/types.rs` — add `//!` module doc block at top
- `crates/scheduler/src/lib.rs` — add `//!` crate-level doc block at top
- `.claude/agents/rust-scheduler.md` — convert Date Convention Functions to LSP pointer

**Read-only:**
- `crates/scheduler/src/cpm.rs` — model `//!` block to follow
- `docs/tasks/phase16c.yaml` — full task details

## Tasks — execute in order:

### A1: Add callsite-search rule to CLAUDE.md

Add the following rule to the "Agent Behavioral Rules (Non-Negotiable)" section in
`CLAUDE.md`, after the existing bullet about conventional commits:

```
- **When fixing a pattern bug**, use LSP `findReferences` on the affected symbol to find
  all code callsites before committing. Fix all callsites atomically in one commit. Then
  use Grep for the same pattern in comments, docs, prompts, and cross-language boundaries
  (TS↔Rust/WASM) where LSP cannot reach.
```

Commit: `"docs: add callsite-search rule to CLAUDE.md Agent Behavioral Rules"`

### A2: Add //! module docs to 5 modules

Read `crates/scheduler/src/cpm.rs` first — its `//!` block is the model to follow.

Add `//!` doc blocks at the top of each file (before any `use` statements):

**date_utils.rs:** Explain the inclusive end-date convention, `shift_date` as the
`pub(crate)` primitive that all other functions are built on, and list the public API
categories: date↔duration conversion (`task_duration`, `task_end_date`, `task_start_date`),
business day snapping (`ensure_business_day`, `prev_business_day`), dependency helpers
(`fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`),
and shift counting (`business_day_delta`).

**cascade.rs:** Explain the cascade algorithm: when a predecessor moves forward, compute
`required_start` for each dependent using dep-type helpers, check for violation
(`required_start > current_start`), shift the whole task to preserve its date gap (not
its duration field). Mention it uses BFS/queue, processes transitive dependents, and
returns only tasks that actually moved.

**constraints.rs:** Explain: `compute_earliest_start` (single-task from deps + SNET
floor), `recalculate_earliest` (full topo-sort recalculation with today-floor and all
8 constraint types). List the constraint types: ASAP, ALAP, SNET, SNLT, FNET, FNLT,
MSO, MFO.

**graph.rs:** Explain: `would_create_cycle` uses BFS reachability to check if adding
a dependency would create a cycle in the task graph.

**types.rs:** Explain: core data structures (`Task`, `Dependency`, `DepType`,
`ConstraintType`) and result types (`CascadeResult`, `RecalcResult`, `ConflictResult`,
`CriticalPathResult`).

Commit: `"docs: add //! module doc blocks to 5 undocumented scheduler modules"`

### A3: Convert rust-scheduler.md from copy to pointer

Read `.claude/agents/rust-scheduler.md` in full. Make these changes:

1. **Replace the "Date Convention Functions" section** with:
```markdown
## Date Convention Functions
Use LSP `hover` on any function in `date_utils.rs` for its contract, or
`documentSymbol` to list all exports. The `///` doc comments are the source of truth.
Do NOT maintain a duplicate function list here — it drifts from source.
```

2. **Fix the module map** (the "Crate Modules" or similar section):
   - `is_weekend()` → `is_weekend_date()` (the private helper is `is_weekend(y,m,d)`;
     the public API is `is_weekend_date(date: &str)`)
   - `find_conflicts()` → `detect_conflicts()` (the `#[wasm_bindgen]` export wrapping
     the internal `find_conflicts` helper)
   - Add `add_days()` — `pub fn`, calendar-day (not business-day) shift
   - Add `shift_date()` — `pub(crate)`, low-level business-day shift primitive

3. **Remove stale historical notes** like "(replaces `next_biz_day_on_or_after`)"

Commit: `"docs: convert rust-scheduler.md Date Convention Functions to LSP pointer"`

### A4: Add crate-level //! doc block to lib.rs

Add a `//!` block at the very top of `crates/scheduler/src/lib.rs` (before any `use`
statements). Describe:
- The WASM scheduling engine and its purpose
- The 7 `#[wasm_bindgen]` exports by name: `compute_critical_path`,
  `compute_critical_path_scoped`, `would_create_cycle`, `compute_earliest_start`,
  `cascade_dependents`, `detect_conflicts`, `recalculate_earliest`
- Note: the internal helper is `find_conflicts()`; the WASM export is `detect_conflicts()`
- The inclusive end-date convention used throughout

Commit: `"docs: add //! crate-level doc block to lib.rs"`

### Final verification

```bash
cd crates/scheduler && cargo doc --no-deps 2>&1 | tail -5
cargo test 2>&1 | tail -5
```

Both must succeed with no warnings/failures.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupA saving work"`.
- **Calculations**: NEVER do mental math — use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic.
