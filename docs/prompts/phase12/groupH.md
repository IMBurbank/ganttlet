# Phase 12 Group H — Cascade Bug Fix + Asymmetric Cascade

You are implementing Phase 12 Group H for the Ganttlet project.
Read CLAUDE.md and docs/TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync). The scheduling engine runs as a
Rust→WASM module in each user's browser. All scheduling computations must be deterministic —
every client must produce the same result for the same input.

The scheduling engine currently **does not work correctly as real scheduling software**. This
phase is about fixing it. Your group focuses on the cascade system, which is the core mechanism
that keeps dependent tasks aligned when a predecessor moves.

## Your files (ONLY modify these):
- `crates/scheduler/src/cascade.rs`

Do NOT modify any other file. Especially do NOT modify `types.rs`, `lib.rs`, `cpm.rs`, or any
frontend file — other agents own those.

## Current state of cascade

Read `crates/scheduler/src/cascade.rs` carefully. The current implementation:
- Does a DFS through dependents, applying the same `days_delta` to every downstream task
- Applies the delta in BOTH directions (forward and backward) — **this is wrong**
- Has a bug where task durations can change during cascade — **this must be fixed**
- Returns `Vec<CascadeResult>` with `{ id, start_date, end_date }` for each shifted task

The function signature is `cascade_dependents(tasks, moved_task_id, days_delta) -> Vec<CascadeResult>`.
The WASM binding in lib.rs calls this function and returns the results to JavaScript. You do NOT
need to change the function signature or the return type — the behavioral changes happen inside
the function.

## Tasks — execute in order:

### H1: Fix cascade duration bug

The cascade shifts both start_date and end_date by the delta, but there is a bug where the
duration of downstream tasks can change. This happens because the cascade operates on mutable
dates in a HashMap and may process tasks in an order that causes double-shifts or incorrect
arithmetic.

1. Read the existing cascade tests to understand the expected behavior
2. Write a new test that explicitly asserts: for every task in cascade results, the number of
   days between start_date and end_date must equal the original task duration
3. Run `cd crates/scheduler && cargo test` — the test may or may not fail (the bug may be
   data-dependent). If it passes, add a more complex chain (3+ tasks with varying durations)
4. Fix the bug: ensure the cascade computes each task's new dates as:
   - `new_start = old_start + delta`
   - `new_end = old_end + delta`
   - The duration (end - start) must be identical before and after
5. Verify the fix: all tests pass

### H2: Implement asymmetric cascade

In professional scheduling software, cascade behavior is asymmetric:
- **Forward moves** (positive delta): Push all dependents forward. This is the current behavior
  and it is correct — keep it.
- **Backward moves** (negative delta): Do NOT pull dependents backward. Instead, return an
  empty results vec. The newly exposed slack between the moved task and its dependents will be
  visualized by the frontend separately (using `compute_earliest_start()`).

This is critical for a multi-user scheduling tool — if one user moves a task backward, it should
NOT silently rearrange the entire downstream schedule. It should expose float/slack so users can
see the opportunity and decide what to do.

Implementation:
1. At the top of `cascade_dependents()`, check if `days_delta <= 0`
2. If so, return an empty `Vec<CascadeResult>` immediately
3. The rest of the function (forward cascade) stays the same
4. Write tests:
   - Forward cascade (+5 days): dependents shift forward (existing behavior, verify it still works)
   - Backward cascade (-3 days): returns empty vec, no dependents move
   - Zero delta: returns empty vec (no-op)

### H3: Commit and verify
- Run `cd crates/scheduler && cargo test` — ALL tests pass (existing + new)
- Run `cd crates/scheduler && cargo clippy` — no warnings
- Commit with message: "fix: cascade duration bug, implement asymmetric cascade (forward-only)"
