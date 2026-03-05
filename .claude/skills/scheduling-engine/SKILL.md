---
name: scheduling-engine
description: "Use when working on CPM (critical path), cascade, constraints, or any scheduling logic in crates/scheduler/. Covers the Rust→WASM scheduling engine architecture, known gotchas, and test patterns."
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

## Known Gotchas
- ES must be computed from dependencies, NOT from stored task dates
- Scoped CPM must run on full graph then filter results (not filter-then-compute)
- `float.abs() < 1` is wrong for integer-day scheduling — use `float == 0`

## Testing
- `cd crates/scheduler && cargo test` — run all unit tests
- `cargo clippy` — must pass with no warnings
- Tests use in-memory task graphs — no I/O, no browser dependencies
