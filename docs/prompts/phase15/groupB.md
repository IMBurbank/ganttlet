---
phase: 15
group: B
stage: 2
agent_count: 1
scope:
  modify:
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/graph.rs
    - crates/scheduler/src/lib.rs
  read_only:
    - crates/scheduler/src/types.rs
    - crates/scheduler/src/constraints.rs
    - crates/scheduler/src/cpm.rs
    - crates/scheduler/src/date_utils.rs
depends_on: [A]
tasks:
  - id: B1
    summary: "Read cascade.rs, graph.rs, lib.rs"
  - id: B2
    summary: "Implement SF in cascade.rs"
  - id: B3
    summary: "Implement SF in graph.rs"
  - id: B4
    summary: "Add detect_conflicts to lib.rs"
  - id: B5
    summary: "Verify cascade handles all 4 dep types"
---

# Phase 15 Group B — SF Cascade + Graph + Conflict Detection (Rust)

You are implementing Phase 15 Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart where multiple users edit the same schedule simultaneously
(CRDT-based sync via Yjs). The scheduling engine runs as Rust→WASM in each user's browser.

## Prerequisites

Group A (Stage 1) has already been merged. The following are now available:
- `ConstraintType` has 8 variants: ASAP, SNET, ALAP, SNLT, FNET, FNLT, MSO, MFO
- `DepType` has 4 variants: FS, FF, SS, SF
- `constraints.rs` handles all constraint types and SF in `compute_earliest_start`
- `cpm.rs` handles SF in forward/backward pass

## Your files (ONLY modify these):
- `crates/scheduler/src/cascade.rs` — cascade logic for dependency-driven date propagation
- `crates/scheduler/src/graph.rs` — cycle detection
- `crates/scheduler/src/lib.rs` — WASM exports

Read-only (understand but do NOT modify):
- `crates/scheduler/src/types.rs` — Task struct, ConstraintType, DepType (modified by Group A)
- `crates/scheduler/src/constraints.rs` — constraint computation (modified by Group A)
- `crates/scheduler/src/cpm.rs` — critical path (modified by Group A)
- `crates/scheduler/src/date_utils.rs` — business day helpers

## Success Criteria (you're done when ALL of these are true):
1. SF cascade works: when predecessor's start moves, successor's end is adjusted
2. SF cascade respects slack (doesn't cascade if slack absorbs the change)
3. `would_create_cycle` detects cycles involving SF edges
4. `detect_conflicts` WASM export exists and returns conflict information
5. `cascade_dependents` works for all 4 dep types (FS, SS, FF, SF)
6. All existing cascade/graph tests still pass
7. All changes committed with descriptive messages

## Tasks — execute in order:

### B1: Read and understand the current code

1. Read `crates/scheduler/src/cascade.rs` — understand `cascade_dependents` function
   - Note: it builds an adjacency list (HashMap) for O(1) lookups
   - Handles FS, SS, FF with slack absorption
   - Returns `Vec<CascadeResult>` with task_id, new_start, new_end
2. Read `crates/scheduler/src/graph.rs` — understand `would_create_cycle` (DFS-based)
3. Read `crates/scheduler/src/lib.rs` — understand existing WASM exports and serialization pattern
4. Read `crates/scheduler/src/types.rs` — verify Group A's changes are merged (8 constraint types, SF dep type)

### B2: Implement SF in cascade.rs

SF (Start-to-Finish): predecessor's START constrains successor's FINISH.
When predecessor moves, successor's end date must be adjusted.

Semantics: `successor.end >= next_business_day(add_business_days(predecessor.start, lag))`

In `cascade_dependents`:
1. Add SF case to the match on dep_type in the inner cascade function
2. For SF: `required_end = next_business_day(add_business_days(pred.start, lag))`
3. If `current_end < required_end`, push successor's end to `required_end` and derive new start from `end - duration`
4. Respect slack: if successor already ends after required_end, no cascade needed

Add tests:
- Basic SF cascade: A starts Mar 10 → B (SF, lag 0) must end >= Mar 10
- SF with lag: A starts Mar 10, SF lag 2 → B must end >= Mar 12
- SF slack absorption: B already ends Mar 15, A starts Mar 10, SF lag 0 → no cascade
- SF + diamond deps: A→(SF)→B, A→(FS)→B — both constraints satisfied

Commit: `"feat: implement SF dependency in cascade_dependents"`

### B3: Implement SF in graph.rs

`would_create_cycle` does DFS over dependency edges. It needs to traverse SF edges too.

In `would_create_cycle`:
1. Verify the DFS traverses ALL dependency types including SF
2. SF creates an edge from predecessor to successor (same direction as other dep types for cycle detection purposes)
3. The existing code likely iterates over `task.dependencies` which includes all dep types — verify SF is naturally handled

Add test: A→(SF)→B→(FS)→A should be detected as a cycle.

Commit: `"feat: handle SF edges in cycle detection"`

### B4: Add detect_conflicts to lib.rs

Create a new WASM-exported function that detects scheduling conflicts (negative float).

1. Define a result type:
```rust
#[derive(Serialize, Deserialize)]
pub struct ConflictResult {
    pub task_id: String,
    pub conflict_type: String,  // "SNLT_VIOLATED", "FNLT_VIOLATED", "MSO_CONFLICT", "MFO_CONFLICT"
    pub constraint_date: String,
    pub actual_date: String,
    pub message: String,
}
```

2. Implement `detect_conflicts`:
```rust
#[wasm_bindgen]
pub fn detect_conflicts(tasks_js: JsValue) -> Result<JsValue, JsValue> {
    let tasks: Vec<Task> = serde_wasm_bindgen::from_value(tasks_js)?;
    let conflicts = find_conflicts(&tasks);
    Ok(serde_wasm_bindgen::to_value(&conflicts)?)
}
```

3. The `find_conflicts` function should:
   - For each task, check if its scheduled dates violate its constraint:
     - SNLT: start > constraint_date → conflict
     - FNLT: end > constraint_date → conflict
     - MSO: start != constraint_date → conflict
     - MFO: end != constraint_date → conflict
   - Also detect negative float from CPM (tasks where ES > LS)
   - Return a Vec of all conflicts found

Add tests:
- MSO task with dep pushing past constraint date → conflict detected
- FNLT task with end past constraint date → conflict detected
- No constraints violated → empty result
- Multiple conflicts in one schedule → all returned

Commit: `"feat: add detect_conflicts WASM export for negative float detection"`

### B5: Verify cascade_dependents handles all 4 dep types

Run the full test suite and verify:
1. FS cascade: existing tests pass
2. SS cascade: existing tests pass
3. FF cascade: existing tests pass
4. SF cascade: new tests from B2 pass
5. Mixed dependency types in same graph: cascade propagates correctly

Run `cargo test` and fix any failures.

Commit if fixes needed: `"fix: cascade_dependents handles all 4 dep types correctly"`

## Progress Tracking

After completing each major task (B1-B5), update `.agent-status.json` in the worktree root:

```json
{
  "group": "B",
  "phase": 15,
  "tasks": {
    "B1": { "status": "done" },
    "B2": { "status": "in_progress" }
  },
  "last_updated": "2026-03-08T10:30:00Z"
}
```

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK.
- Level 3 (blocked): Commit, update .agent-status.json with "status": "blocked", skip dependent tasks.
- Emergency: `git add -A && git commit -m "emergency: groupB saving work"`.
- **Calculations**: NEVER do mental math or date arithmetic. Use `node -e` or `python3 -c`.

## Design Notes

### SF Cascade Direction
SF is the inverse of FS in terms of which date drives what:
- FS: pred.end → succ.start (predecessor finishes, then successor starts)
- SF: pred.start → succ.end (predecessor starts, then successor can finish)

When predecessor moves RIGHT by N days:
- FS: successor start moves right (if needed)
- SF: successor END moves right (if needed), and start is derived from end - duration

### Conflict Detection Scope
`detect_conflicts` should be a pure function that examines current task dates against constraints.
It does NOT reschedule — it only reports. The UI will display these conflicts to users.
