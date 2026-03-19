---
name: scheduling-engine
description: "Use when working on CPM (critical path), cascade, constraints, any scheduling logic in crates/scheduler/, or building/debugging WASM. Covers architecture, date conventions, WASM build, gotchas, and test patterns."
---

# Scheduling Engine Guide

## Architecture
The scheduling engine is a pure Rust→WASM module in `crates/scheduler/`.
All scheduling computations are deterministic. The engine exposes functions
via wasm-bindgen in `src/lib.rs`.

## Module Map
- `src/cpm.rs` — Critical path method (forward/backward pass, float, scoping)
- `src/cascade.rs` — Cascade propagation (date changes ripple to successors)
- `src/constraints.rs` — Scheduling constraints (ASAP, SNET, etc.)
- `src/graph.rs` — Dependency graph traversal (topological sort, cycle detection)
- `src/types.rs` — Shared types (Task, Dependency, ScheduleDirection)
- `src/date_utils.rs` — Date arithmetic helpers
- `src/lib.rs` — WASM bindings (public API surface)

## Key Algorithms
- **Forward pass**: Topological BFS, compute ES/EF from predecessors
- **Backward pass**: Reverse topological, compute LS/LF from successors
- **Float**: LS - ES; zero float = critical path
- **Cascade**: Propagate date delta to FS successors only (asymmetric — forward only)
- **Constraint types**: ASAP (default), SNET (start no earlier than), FNLT (finish no later than), etc.

## Date Conventions (Non-Negotiable)
<!-- Moved from root CLAUDE.md — curator cleanup pending in step 12 -->
- **end_date is INCLUSIVE** — the last working day the task occupies, not the day after.
- **duration** = business days in [startDate, endDate] counting both endpoints.
  `taskDuration('2026-03-02', '2026-03-06') = 5` (Mon–Fri).
- **End from start+dur:** `taskEndDate(start, duration)` — the only public API for this. `shift_date` (Rust) and `addBusinessDays` (date-fns) are internal primitives; never call them directly.
- **Duration from dates:** `taskDuration(start, end)` — NEVER `workingDaysBetween` (deleted) or raw `differenceInBusinessDays`.
- **No weekend dates.** Tasks must not start or end on Sat/Sun. Use `ensureBusinessDay()` for starts, `prevBusinessDay()` for ends.
- **Dependency helpers (Rust):** Always use `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start` — NEVER hand-write FS/SS/FF/SF formulas.
- **CPM exception:** `cpm.rs` uses a standard exclusive integer model internally. Do NOT apply inclusive convention to CPM — it's an abstract graph algorithm, not a date calculation.

### Date/Arithmetic Shell Tools
- **Any arithmetic**: `python3 -c "print(17 * 3 + 42)"` or `node -e "console.log(...)"`
- **Date/time math**: NEVER compute dates mentally. Use the shell functions:
  - `taskEndDate 2026-03-11 10` → `2026-03-24` (end date for 10-day task)
  - `taskDuration 2026-03-11 2026-03-24` → `10` (inclusive duration)
  - Also available as `task_end_date`, `task_duration`, `bizday`
  - `bizday 2026-03-07` → Saturday — next business day: `2026-03-09`
  - `bizday verify 2026-03-11 10 2026-03-24` → OK (assert in scripts)
- **In code**: use `taskEndDate`/`taskDuration` (TS) or `task_end_date`/`task_duration` (Rust). NEVER use `addBusinessDays` directly for end dates — `taskEndDate` handles the inclusive convention.

## Known Gotchas
- ES must be computed from dependencies, NOT from stored task dates
- Scoped CPM must run on full graph then filter results (not filter-then-compute)
- `float.abs() < 1` is wrong for integer-day scheduling — use `float == 0`
- **end_date is inclusive** — the last working day, not the day after. duration = business days in [start, end].
- **taskEndDate ≠ addBusinessDays(start, dur)** — it's `addBusinessDays(start, dur - 1)`. Off-by-one if you use the wrong one.
- **Cascade preserves date gap, not duration field.** If duration is stale (not recomputed from dates), cascade and recalculate will disagree.
- **FF/SF formulas use `-(duration-1)` not `-(duration)`.** This is correct for inclusive convention. The minus sign derives start from end, and inclusive duration is 1 larger than the gap.
- **CPM is exclusive internally.** The integer model in cpm.rs uses exclusive convention — this is standard and intentional. Don't "fix" it.

## WASM Build & Debug
<!-- Absorbed from rust-wasm skill -->

**Build:** `npm run build:wasm` — runs wasm-pack in `crates/scheduler/`, targeting browser ES modules.

**wasm-pack options:** `--target web` (browser-native), debug for dev, release for production.

**wasm-bindgen patterns:**
- `#[wasm_bindgen]` on pub functions → JS exports
- Complex types: `serde` serialization (JsValue ↔ Rust structs)
- `lib.rs` is the public API surface — all exports go through here
- Structs with `#[wasm_bindgen]` get JS class wrappers

**Generated files:** `src/wasm/scheduler/` — `scheduler.js` (glue), `scheduler_bg.wasm` (binary), `scheduler.d.ts` (types)

**Debugging build failures:**
- Missing wasm-pack: `curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh`
- Compilation errors: `cargo check` in `crates/scheduler/` for better messages
- Binding errors: no lifetimes or generics on `#[wasm_bindgen]` exported fns
- Size issues: check for unnecessary dependencies in `Cargo.toml`

## Testing
- `cd crates/scheduler && cargo test` — run all unit tests
- `cargo clippy` — must pass with no warnings
- Tests use in-memory task graphs — no I/O, no browser dependencies

## Lessons Learned
<!-- Agents: append here ONLY after confirming the behavior by reading source or running a test. Format: YYYY-MM-DD: description -->
- 2026-03-01: `cascade_dependents` silently skips tasks with no start date. Always validate dates before cascade.
- 2026-03-01: Scoped CPM on a single-task workstream returns empty critical path. Need ≥2 tasks.
- 2026-03-01: Cascade is asymmetric: forward moves propagate, backward moves expose slack. Don't expect backward cascade.
- Three FS formulas diverged (compute_earliest_start, cascade_dependents, find_conflicts) because there was no shared helper. Use `fs_successor_start` etc. to prevent divergence.
- `workingDaysBetween` counted [start, end) exclusive, causing duration to be 1 too low. Replaced by `taskDuration` which counts [start, end] inclusive.
