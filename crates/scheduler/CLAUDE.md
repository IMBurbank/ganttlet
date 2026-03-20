# Scheduling Engine

## Constraints
- Pure Rust — no external date/time crates (chrono, time)
- Integer-day scheduling — float comparison is `== 0`, not `abs() < epsilon`
- All lag values in business days — use dep-type helpers (`fs_successor_start`, etc.), not raw `shift_date()`
- ES is computed from dependencies, never from stored task dates
- Scoped CPM: run on full graph, then filter (not filter-then-compute)

## Commands
- `cargo test` — Run all scheduler unit tests
- `cargo check` — Type-check without building

## Never
- Add external date/time crates

## Date Conventions
See scheduling-engine skill for full date conventions, shell tools, and API guidance.

## Skill
See `.claude/skills/scheduling-engine/` for detailed domain knowledge.
