---
phase: 15
group: A
stage: 1
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/types.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/cpm.rs
  read_only:
    - crates/scheduler/src/lib.rs
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/date_utils.rs
depends_on: []
tasks:
  - id: A1
    summary: "Read types.rs, constraints.rs, cpm.rs, cascade.rs"
  - id: A2
    summary: "Add ALAP/SNLT/FNET/FNLT/MSO/MFO + SF to types.rs"
  - id: A3
    summary: "Implement ALAP"
  - id: A4
    summary: "Implement SNLT"
  - id: A5
    summary: "Implement FNET"
  - id: A6
    summary: "Implement FNLT"
  - id: A7
    summary: "Implement MSO"
  - id: A8
    summary: "Implement MFO"
  - id: A9
    summary: "Implement SF in compute_earliest_start"
  - id: A10
    summary: "Update recalculate_earliest for all constraints"
  - id: A11
    summary: "Update CPM for new constraints + SF"
---

# Phase 15 Group A — Type Definitions + Constraint Engine + CPM

You are implementing Phase 15 Group A for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart where multiple users edit the same schedule simultaneously
(CRDT-based sync via Yjs). The scheduling engine runs as Rust→WASM in each user's browser.

## Your files (ONLY modify these):
- `crates/scheduler/src/types.rs` — Task struct, ConstraintType enum, DepType enum
- `crates/scheduler/src/constraints.rs` — constraint application, earliest start computation
- `crates/scheduler/src/cpm.rs` — critical path method forward/backward pass

Read-only (understand but do NOT modify):
- `crates/scheduler/src/lib.rs` — WASM exports
- `crates/scheduler/src/cascade.rs` — cascade logic (owned by Group B in Stage 2)
- `crates/scheduler/src/date_utils.rs` — business day helpers

## Success Criteria (you're done when ALL of these are true):
1. `ConstraintType` has 8 variants: ASAP, SNET, ALAP, SNLT, FNET, FNLT, MSO, MFO
2. `DepType` has 4 variants: FS, FF, SS, SF
3. Serde round-trip works for both enums (serialize + deserialize)
4. ALAP schedules tasks as late as possible without delaying successors
5. SNLT flags conflict when deps push start past constraint_date
6. FNET pushes task end to at least constraint_date
7. FNLT flags conflict when deps push end past constraint_date
8. MSO pins start to exact constraint_date, flags conflict if deps conflict
9. MFO pins end to exact constraint_date, flags conflict if impossible
10. SF dependency handled in compute_earliest_start
11. recalculate_earliest applies all 8 constraint types correctly
12. CPM forward/backward pass handles SF deps and new constraints
13. All existing tests still pass (`cargo test`)
14. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- Any new constraint type not tested
- SF not handled in compute_earliest_start
- Existing ASAP/SNET tests broken
- Uncommitted changes

## Tasks — execute in order:

### A1: Read and understand the current code

1. Read `crates/scheduler/src/types.rs` — understand Task struct, ConstraintType (ASAP/SNET), DepType (FS/FF/SS)
2. Read `crates/scheduler/src/constraints.rs` — understand `compute_earliest_start` and `recalculate_earliest`
3. Read `crates/scheduler/src/cpm.rs` — understand forward/backward pass, float computation
4. Read `crates/scheduler/src/cascade.rs` — understand how FS/SS/FF cascade works (you won't modify this, but need context)
5. Read `crates/scheduler/src/date_utils.rs` — understand `add_business_days`, `working_days_between`, `next_business_day`

### A2: Add new enum variants to types.rs

In `types.rs`:

1. Add new variants to `ConstraintType`:
```rust
pub enum ConstraintType {
    ASAP,   // As Soon As Possible (default)
    SNET,   // Start No Earlier Than
    ALAP,   // As Late As Possible
    SNLT,   // Start No Later Than
    FNET,   // Finish No Earlier Than
    FNLT,   // Finish No Later Than
    MSO,    // Must Start On
    MFO,    // Must Finish On
}
```

2. Add SF to `DepType`:
```rust
pub enum DepType {
    FS,  // Finish-to-Start
    FF,  // Finish-to-Finish
    SS,  // Start-to-Start
    SF,  // Start-to-Finish
}
```

3. Run `cargo test` to verify serde still works. Add a test for SF serde round-trip if none exists.

4. Commit: `"feat: add ALAP/SNLT/FNET/FNLT/MSO/MFO constraint types and SF dep type"`

### A3: Implement ALAP in constraints.rs

ALAP (As Late As Possible) schedules a task as late as possible without delaying any successor.

Implementation approach:
- During the forward pass in `recalculate_earliest`, ALAP tasks should NOT be scheduled at their earliest possible date — they need special handling
- ALAP is primarily resolved during the backward pass (CPM), where the task's late start becomes its scheduled start
- In `constraints.rs`, for the forward pass: ALAP tasks still compute their earliest start from deps (they can't start before deps allow), but the actual scheduling to "as late as possible" happens in CPM
- The key is: after CPM computes LS/LF, an ALAP task's scheduled start = LS (not ES)

For now in `constraints.rs`:
- `compute_earliest_start`: ALAP tasks compute earliest start normally from deps (the floor), but mark that they want late scheduling
- `recalculate_earliest`: ALAP tasks get their earliest start from deps like ASAP, but the caller (CPM) will override with late start

Add test: A(5d)→B(3d, ALAP) in a project — B should be scheduled at the latest possible date that doesn't delay the project end.

Commit: `"feat: implement ALAP constraint — schedule as late as possible"`

### A4: Implement SNLT (Start No Later Than)

SNLT is a ceiling constraint on start date. If dependencies push the start past constraint_date, that's a conflict (negative float).

In `constraints.rs`:
- `compute_earliest_start`: If SNLT, compute earliest from deps. If earliest > constraint_date, return the dep-driven date but flag the conflict via return value (you may need to change the return type to include a conflict flag, or return a struct)
- Consider adding a `ConstraintResult` struct: `{ date: String, conflict: Option<String> }`

Add test: task with SNLT Mar 20, dep pushes to Mar 25 → conflict detected.
Add test: task with SNLT Mar 20, dep pushes to Mar 15 → scheduled at Mar 15, no conflict.

Commit: `"feat: implement SNLT constraint — start no later than"`

### A5: Implement FNET (Finish No Earlier Than)

FNET is a floor constraint on end date. The task's end date must be >= constraint_date.

In `constraints.rs`:
- If FNET and computed end < constraint_date, push the task's start later so that end >= constraint_date
- The start adjustment: new_start = constraint_date - duration (in business days)

Add test: 3d task starting Mar 10 with FNET Mar 20 → end date = Mar 20, start pushed accordingly.

Commit: `"feat: implement FNET constraint — finish no earlier than"`

### A6: Implement FNLT (Finish No Later Than)

FNLT is a ceiling constraint on end date. If computed end > constraint_date, that's a conflict.

In `constraints.rs`:
- Compute end from deps + duration. If end > constraint_date, flag conflict.
- Do NOT move the task — just record the conflict.

Add test: task with FNLT Mar 15, deps push end to Mar 18 → conflict flagged.

Commit: `"feat: implement FNLT constraint — finish no later than"`

### A7: Implement MSO (Must Start On)

MSO pins the start to an exact date. Any deviation is a conflict.

In `constraints.rs`:
- Set start = constraint_date regardless of deps
- If deps would push start past constraint_date, flag conflict (negative float)
- If deps allow earlier start, still pin to constraint_date

Add test: MSO Mar 15, no deps → starts Mar 15.
Add test: MSO Mar 15, dep requires Mar 18 → starts Mar 15 but conflict flagged.

Commit: `"feat: implement MSO constraint — must start on"`

### A8: Implement MFO (Must Finish On)

MFO pins the end to an exact date. Start is derived from end - duration.

In `constraints.rs`:
- Set end = constraint_date, derive start = end - duration (business days)
- If deps conflict, flag it

Add test: MFO Mar 15, 5d task → start derived correctly (compute using date_utils).
Add test: MFO Mar 15, dep pushes start past derived start → conflict flagged.

Commit: `"feat: implement MFO constraint — must finish on"`

### A9: Implement SF in compute_earliest_start

SF (Start-to-Finish): the predecessor's START constrains the successor's FINISH.
Meaning: successor cannot finish until predecessor starts (+ lag).

In `constraints.rs` `compute_earliest_start`:
- For SF deps: `required_end = add_business_days(pred.start, lag)`, then `required_start = required_end - duration`
- The successor's earliest start is driven by when its end must be

Add test: A starts Mar 10 (3d), SF lag 0 to B (2d) → B's end must be >= Mar 10, so B's start = Mar 10 - 2d = Mar 6.

Commit: `"feat: implement SF dependency in compute_earliest_start"`

### A10: Update recalculate_earliest for all constraint types

`recalculate_earliest` does a topological pass applying constraints. Update it to handle all 8 types:
- ASAP: no change (default behavior)
- SNET: existing logic (floor on start)
- ALAP: compute earliest from deps (actual late scheduling done in CPM)
- SNLT: compute from deps, flag if start > constraint_date
- FNET: push start so end >= constraint_date
- FNLT: compute from deps, flag if end > constraint_date
- MSO: pin start to constraint_date
- MFO: pin end to constraint_date, derive start

Ensure existing ASAP/SNET tests still pass.

Commit: `"feat: update recalculate_earliest for all 8 constraint types"`

### A11: Update CPM for new constraints + SF

In `cpm.rs`:

1. Forward pass: add SF handling alongside FS/SS/FF
   - SF: `EF_successor >= ES_predecessor + lag`
   - So: `ES_successor = max(ES_successor, ES_predecessor + lag - duration_successor)`

2. Backward pass: add SF handling
   - SF: `LF_predecessor >= LS_successor` (reverse of forward logic)

3. ALAP resolution: after backward pass, ALAP tasks should have their ES set to LS
   - This makes them start as late as possible

4. Float computation: ensure constrained tasks (MSO, MFO, SNLT, FNLT) have correct float
   - Hard constraints (MSO, MFO) may have negative float if deps conflict

5. Run `cargo test` — all existing CPM tests must pass.

Add tests:
- SF dep in forward pass: A(3d)→SF→B(2d), verify B's ES/EF
- ALAP task in CPM: verify LS becomes ES after resolution
- MSO with conflicting dep: verify negative float

Commit: `"feat: update CPM forward/backward pass for SF deps and new constraints"`

## Progress Tracking

After completing each major task (A1-A11), update `.agent-status.json` in the worktree root:

```json
{
  "group": "A",
  "phase": 15,
  "tasks": {
    "A1": { "status": "done" },
    "A2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-08T10:30:00Z"
}
```

On restart, read `.agent-status.json` (fall back to `claude-progress.txt`) and `git log --oneline -10` first. Skip completed tasks.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: groupA saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic. Example: `taskEndDate 2026-03-11 10` → `2026-03-24`.

## Design Notes

### Conflict Return Type
You will likely need to change the return type of `compute_earliest_start` to return both a date AND a conflict indicator. Options:
1. Return a struct: `ComputeResult { start_date: String, end_date: String, conflict: Option<ConflictInfo> }`
2. Return a tuple: `(Option<String>, Vec<Conflict>)`

Choose whichever integrates cleanly with the existing callers. Check `recalculate_earliest` and `lib.rs` to see how the return value is consumed.

### ALAP Strategy
ALAP is unique — it requires the backward pass (CPM) to determine the actual schedule. In the forward pass:
- Compute the earliest possible start from deps (this is the floor — ALAP can't start before deps allow)
- Don't apply ALAP logic yet — just treat it like ASAP for the forward pass
- After CPM backward pass, set ALAP task's scheduled start = LS (late start)

### SF Dependency Semantics
SF means: "Successor cannot finish until predecessor starts."
- Forward: `EF_succ >= ES_pred + lag` → `ES_succ >= ES_pred + lag - duration_succ`
- Backward: `LS_pred >= LF_succ - lag` (predecessor can't start later than what successor's finish allows)
- Cascade: handled by Group B in Stage 2 (you only handle constraints.rs and cpm.rs)
