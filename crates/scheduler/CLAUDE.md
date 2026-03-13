# Scheduling Engine

## Constraints
- Pure Rust — no external date/time crates (chrono, time)
- Integer-day scheduling — float comparison is `== 0`, not `abs() < epsilon`
- All lag values in business days — always use `add_business_days()`
- ES is computed from dependencies, never from stored task dates
- Scoped CPM: run on full graph, then filter (not filter-then-compute)

## Commands
- `cargo test` — Run all scheduler unit tests
- `cargo check` — Type-check without building

## Never
- Add external date/time crates
- Do arithmetic in your head — use `node -e` or `python3 -c`

## Date Convention
- `end_date` is INCLUSIVE — last working day of the task.
- `duration` = business days in [start_date, end_date] counting both.
- End from start+dur: `task_end_date(start, duration)` — NEVER use `shift_date(start, duration)` directly.
- Duration from dates: `task_duration(start, end)`.
- `shift_date(date, n)` is `pub(crate)` — the low-level shift primitive. External code should never call it directly.
- Dep-type helpers: `fs_successor_start`, `ss_successor_start`, `ff_successor_start`, `sf_successor_start`.
  NEVER hand-write FS/SS/FF/SF arithmetic.
- CPM uses exclusive integer model internally — do NOT apply inclusive convention to cpm.rs.

## Skill
See `.claude/skills/scheduling-engine/` for detailed domain knowledge.
