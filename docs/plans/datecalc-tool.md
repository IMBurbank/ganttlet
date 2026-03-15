# Plan: Date Math Safety — Passive Verification + Active Tool

## Problem Statement

LLMs routinely get date/time math wrong. CLAUDE.md bans mental math, but the
rule is enforced only by instruction — agents can (and do) skip it. The real
failure mode is not "the tool is too verbose to use" but **"the agent doesn't
reach for a tool at all — it writes the date directly from reasoning."**

A shorter CLI helps the second case (making computation easy) but does nothing
for the first case (forgetting to compute). The stickiest solution is one where
the agent does nothing differently and the system catches errors automatically.

**Historical evidence** (3 major bug rounds, all from wrong date math):
- `1880999`: Duration computed in calendar days instead of business days
- `8ee19f8`: Lag treated as calendar days; cascade shifts land on weekends (6 bugs)
- `23ad90b`: Cascade over-aggressive due to wrong slack calculation

**Goal**: Catch wrong date math even when agents skip the tool, AND make the
tool cheap enough that proactive use becomes the path of least resistance.

---

## Architecture: Three Layers

| Layer | Type | Agent effort | Catches |
|-------|------|-------------|---------|
| **0: Auto-verify hook** | PostToolUse on Edit/Write | Zero | Dates written without verification |
| **1: `bizday` CLI** | Active tool via Bash | Low (~20 tokens) | Pre-computation during reasoning |
| **2: Coverage metric** | End-of-session analysis | Zero | Stickiness decay over time |

Layer 0 is the primary safety net. Layer 1 is for when the agent needs to
reason about dates before writing code. Layer 2 measures whether Layer 1 is
being used proactively (the stickiness question).

### Why Passive-First

| Approach | Stickiness | Failure mode |
|----------|-----------|-------------|
| PostToolUse auto-verify | Maximum — always fires | None (involuntary) |
| MCP tool (first-class) | High — visible in tool list | Forgets to call |
| CLI via Bash | Medium — must remember name | Forgets to call |
| node one-liner | Low — too much friction | Skips entirely |

An active-only approach (even a great CLI) requires the agent to remember to
use it at exactly the moment when it's most tempted to skip. A passive hook
fires regardless of agent behavior — it cannot be forgotten.

### Foundation: Convention Work Complete (Phase 16/16b/16c)

All prerequisite date convention work has landed on `main`. The functions
`bizday` needs already exist:

| Function | Location | Visibility | Status |
|---|---|---|---|
| `task_end_date(start, dur)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `task_duration(start, end)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `task_start_date(end, dur)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `is_weekend_date(date)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `shift_date(date, n)` | Rust `date_utils.rs` | `pub(crate)` | **Internal only** |
| `business_day_delta(from, to)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `ensure_business_day(date)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `prev_business_day(date)` | Rust `date_utils.rs` | `pub` | **Exists** |
| `taskEndDate(start, dur)` | TS `dateUtils.ts` | exported | **Exists** |
| `taskDuration(start, end)` | TS `dateUtils.ts` | exported | **Exists** |
| `workingDaysBetween` | TS | — | **Deleted** (pre-commit rejects) |

**No blockers.** All layers of `bizday` can be built immediately. The hook
can verify `taskEndDate`/`taskDuration` patterns from day one. Cross-language
consistency tests already verify Rust ↔ TS agreement.

---

## Layer 0: Passive Auto-Verify Hook

### How It Works

A PostToolUse hook on `Edit|Write` that fires after every code edit. It:

1. **Extracts date literals** (`YYYY-MM-DD` patterns) from the written content
2. **Identifies scheduling contexts** — date literals near keywords like
   `start`, `end`, `duration`, `lag`, `assert`, `expect`, `constraint`,
   `shift_date`, `taskDuration`, `taskEndDate`,
   `task_duration`, `task_end_date`, `business_day_delta`
3. **Checks for verifiable relationships** — if the edit contains both a
   start date and an end date with a duration, or a date with `+N` business
   days, the hook computes the expected result
4. **Warns on mismatch** — emits a user-visible warning with the correct value

### What It Can Verify (100% accurate, 0% false positive)

| Pattern in code | Hook action | Accuracy |
|----------------|------------|----------|
| `task_end_date("A", N)` / `taskEndDate("A", N)` near `"B"` | Computes `shift_date(A, N-1)`, warns if B wrong | 100% — inclusive convention, one answer |
| `task_duration("A", "B")` / `taskDuration("A", "B")` near `N` | Computes `business_day_delta(A, B) + 1`, warns if N wrong | 100% — inclusive convention, one answer |
| Weekend date in `start_date`/`end_date` field | Always warns | 100% — weekend task dates forbidden |
| Date in `assert_eq!` / `expect()` | Verifies if computable, logs otherwise | 100% where computable |
| Banned function call (`workingDaysBetween`, `shift_date`) | Warns: "use taskDuration / task_end_date" | 100% — string match |

**Key improvement over earlier plan**: The unified inclusive convention eliminates
the fence-post ambiguity. `taskEndDate(start, dur)` has ONE correct answer —
`addBusinessDays(start, dur - 1)`. The hook can now verify `start + duration → end`
relationships, which it previously had to skip. This was the most dangerous gap.

### What It Does NOT Verify

| Pattern | Why not |
|---------|---------|
| Wrong function used (`addDays` instead of `addBusinessDays`) | Hook sees the result, not the intent |
| Cross-file relationships | No context across edits |
| Dates in comments/docs | Excluded by design — not executable |

The first case (wrong function) is the only remaining gap — Layer 1 (`bizday`) helps
agents catch this by comparing calendar vs business day results. Layer 1's **dual
representation** output (see Output Format) also prevents the most common fence-post
error: using an inclusive duration where an offset is needed, or vice versa.

### Performance

`bizday` is a native Rust binary — it uses the same `date_utils` functions as the
scheduling engine. No interpreter startup, no library load.

| Metric | Node.js (old plan) | Rust binary |
|--------|-------------------|-------------|
| Cold start | 79-87ms (Node + `require('date-fns')`) | ~2ms (native exec) |
| Computation (1-2 dates) | 0.015-0.021ms | ~0.01ms |
| Computation (200 dates) | 0.706ms | ~0.5ms |
| Total per hook call | ~85ms | **~3ms** |

**40x faster.** The existing `verify.sh` PostToolUse hook runs `tsc` + `vitest`
(seconds). The bizday hook adds ~3ms — unmeasurable. Over a session with 50 Edit/Write
calls, total overhead is 150ms vs the old plan's 4.25 seconds.

### Accuracy: Revised (inclusive convention unlocks new checks)

The earlier plan dropped `start + duration → end` verification because two
conventions produced two valid answers. With the unified inclusive convention,
there's only one answer: `taskEndDate(start, dur) = addBusinessDays(start, dur - 1)`.

**What changed**: The hook can now pattern-match `taskEndDate("A", N)` and
`task_end_date("A", N)` calls — these are the ONLY sanctioned way to compute
end dates. If the hook sees `taskEndDate("2026-03-11", 10)` near
`"2026-03-25"`, it computes `addBusinessDays(Mar 11, 9)` = `2026-03-24` and
warns. Similarly for `taskDuration("A", "B")` near a wrong number.

The hook also detects **banned function names** — `workingDaysBetween` (deleted)
and direct `shift_date` calls (internal only, `pub(crate)`). The pre-commit hook
already rejects `workingDaysBetween`; the PostToolUse hook catches it earlier,
before commit. `addBusinessDays` is not banned — it's a `date-fns` library
function used internally by `taskEndDate`; it's simply not exported from
`dateUtils.ts`, so agents can't import it from the project.

**Accuracy by category:**

| Category | Cases | Pass rate | Notes |
|----------|-------|-----------|-------|
| Weekend detection | 3/3 | 100% | Forbidden — always wrong |
| `taskEndDate(A, N) → B` | — | 100% | Inclusive convention, one answer |
| `taskDuration(A, B) → N` | — | 100% | Inclusive convention, one answer |
| Banned function name | — | 100% | String match — zero false positives |
| Comment exclusion | 2/2 | 100% | Regex skips `//`, `#`, `*` prefixes |
| Non-scheduling context | 2/2 | 100% | No false positives on plain code |

**0% false positive rate** — every check has one provably correct answer.

### Implementation: `crates/bizday/src/verify.rs`

The hook logic is compiled into the same `bizday` binary. On `bizday lint --stdin` it
reads PostToolUse JSON from stdin, extracts date literals, and verifies all
computable relationships:

- Weekend dates in scheduling contexts → warn
- `taskEndDate(A, N)` / `task_end_date(A, N)` near wrong `B` → warn
- `taskDuration(A, B)` / `task_duration(A, B)` near wrong `N` → warn
- Banned functions (`workingDaysBetween`, `shift_date`) → warn
- Every warning includes a suggested `bizday` command (stickiness bridge)

All date math uses the same `date_utils` functions as the scheduling engine —
zero divergence risk. Logs findings to `.claude/logs/bizday.log` for Layer 2.

Performance budget: **~3ms** total (native binary, no interpreter startup).

**Output format** (every warning includes a `bizday` command + dual representation):
```json
{"warning": "Date check: taskEndDate(2026-03-11, 10) should be 2026-03-24, but code has 2026-03-25.\n  Run: bizday 2026-03-11 end 10"}
```
```json
{"warning": "Weekend date: 2026-03-07 (Saturday) used as start_date. Tasks cannot start on weekends.\n  Run: bizday 2026-03-07"}
```
```json
{"warning": "Banned: workingDaysBetween is deleted. Use taskDuration() for inclusive [start, end] counting."}
```

The `Run: bizday ...` suffix is a **stickiness bridge** — agents that never knew about
`bizday` learn its syntax from hook warnings. Over time, they start using `bizday` proactively
because they've seen the pattern in previous warnings.

### Hook Registration

Add to the `"hooks"` object in `.claude/settings.json` (committed):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "./target/release/bizday lint --stdin"
          }
        ]
      }
    ]
  }
}
```

Note: `settings.json` already has a `"hooks"` key with `"PreToolUse"` entries.
Add `"PostToolUse"` as a sibling key inside the existing `"hooks"` object.

**Why committed**: The bizday hook is a **safety net** — it must fire in all
environments including CI agent runs and fresh clones. Committed `settings.json`
ensures this. The existing `scripts/verify.sh` (tsc + vitest) is referenced in
CLAUDE.md as a PostToolUse hook but is not currently registered in any settings
file — it runs via a separate mechanism. The bizday hook does not conflict.

**Binary availability**: The `bizday` binary must be built before the hook fires.
`npm run build:wasm` runs `wasm-pack build` (not `cargo build`) — it targets WASM,
not native. A separate `npm run build:bizday` script is needed:
```json
"build:bizday": "cargo build --release -p bizday"
```
If the binary doesn't exist, the hook exits silently (no false negatives, no
broken workflow).

### False Positive Mitigation

The hook only warns when it can **compute** a mismatch — it never guesses.
Specifically:
- It requires at least two related date values in the same edit (start+end,
  date+duration, input+output)
- It ignores dates in lines starting with `//`, `#`, `*`, or `<!--`
- It ignores files outside `crates/scheduler/`, `src/`, and test directories
- Weekend warnings fire for any date used as a task start/end date, regardless
  of context — a task starting on Saturday is always wrong in this project

---

## Layer 1: The `bizday` Command

### Why `bizday`

| Factor | `dc` | `bday` | `busday` | `bizday` |
|--------|------|--------|----------|----------|
| Tokens | 1 | 1 | 1 | 1-2 |
| Self-documenting | No (desk calculator?) | "birthday"? | "business day" | "business day" |
| Training collision | GNU RPN calculator — harmful | Birthday — confusing | NumPy `busday_count` — helpful but **end-exclusive** | None — clean |
| Agent recall | Confusion with GNU dc | Domain mismatch | Right domain, wrong fence-post convention | Right domain, no conflicting convention |

**Agent-first reasoning**: Agents don't type — they generate tokens. Character
count is irrelevant; what matters is whether the name is unambiguous in the
agent's training data.

- `dc` — strong prior as GNU's reverse-polish calculator. Harmful: same domain
  (math), different semantics.
- `bday` — strong prior as "birthday." Mildly confusing: unrelated domain.
- `busday` — strong prior from NumPy (`busday_count`, `busday_offset`). Helpful
  for domain recognition, but **dangerous**: NumPy uses `[begin, end)` counting
  while this project uses `[start, end]` inclusive. An agent might assume
  end-exclusive semantics and produce off-by-one errors — exactly the bug class
  this tool exists to prevent.
- `bizday` — signals "business day" clearly, no conflicting convention in
  training data. Agents get the right domain without inheriting wrong semantics.

### Interface: Positional, No Flags, Business-Days-First

```
bizday <date> N          → add N business days         (most common)
bizday <date> -N         → subtract N business days
bizday <date> Nc         → add N calendar days
bizday <date> -Nc        → subtract N calendar days
bizday <date> <date>     → duration (inclusive) + calendar days between dates
bizday <date>            → info (day-of-week, weekend?, next biz day)
bizday <date> end <dur>  → last working day (inclusive end) for start + duration
bizday verify <date> N <expected>  → assert and exit 0/1
bizday lint <file>       → scan file for date literals, verify all computable ones
bizday false-match <file>:<line>  → report a false positive (appends to audit log)
bizday report            → one-line summary (coverage, proactive rate, mismatches, FP rate)
bizday report --trend    → per-session table with cumulative row
bizday report --mismatches | --unverified | --false-matches | --slow  → drill-down
bizday report --session <id>  → filter any mode to a specific session
bizday report --pr-summary  → markdown block for PR descriptions
bizday help              → usage summary (all operations above)
```

**Design decisions**:
1. **Business days is the default** — no flag needed. Calendar days require
   explicit `c` suffix. This matches the scheduler engine's convention and
   makes the safe choice the easy choice.
2. **Signed integer offset** — `bizday 2026-03-11 5` adds 5 business days,
   `bizday 2026-03-11 -5` subtracts. Mirrors NumPy's `busday_offset(date, N)`
   where the sign is part of the integer, not a separate flag. No ambiguity:
   the parser distinguishes `5` (integer → offset) from `2026-03-24` (date →
   diff). `+5` also works (shell treats it as `5`) but isn't required — one
   fewer rule for agents to remember.
3. **`end` uses the inclusive convention** — returns the last working day
   (`addBusinessDays(start, dur - 1)`). Aligns with the date-calc-fixes plan.
4. **`bizday <date> <date>` IS the duration command** — no separate `dur` needed.
   Two dates = diff. Returns inclusive duration (matching `taskDuration`) as
   the headline number, plus calendar days. Fewer commands = less to remember.
5. **`verify` mode** — for use in tests and pre-commit hooks. Returns exit
   code 0 if the expected date matches, 1 if not (with diff shown).
6. **`lint` mode** — runs the same checks as the PostToolUse hook against a
   file. Agents can run `bizday lint src/state/ganttReducer.ts` to verify all
   date literals before committing. Cost is ~3ms per file (native binary,
   no interpreter startup). Fast enough to run in the pre-commit hook on
   all staged `.ts`/`.rs` files without noticeable delay.

### Output Format

**Agent-optimized**: Line 1 is always the machine-readable answer (a date or
number). Context goes on line 2+ as comments. This means `$(bizday ...)` in
shell substitution always captures just the answer.

**Dual-representation output**: Every date computation has two correct numbers —
the inclusive duration (`taskDuration`) and the offset (`addBusinessDays`). Agents
picking the wrong one is the #1 fence-post error. `bizday` shows both, mapped to
the exact function names agents write in code, so they never need to do `+1`/`-1`
conversion mentally.

```
$ bizday 2026-03-11 9
2026-03-24
# addBusinessDays(2026-03-11, 9)
# taskEndDate(2026-03-11, 10) — inclusive duration 10

$ bizday 2026-03-11 2026-03-24
10
# duration: 10 — taskDuration(2026-03-11, 2026-03-24), inclusive [start, end]
# offset: 9 — addBusinessDays(2026-03-11, 9) = 2026-03-24
# calendar: 13 days

$ bizday 2026-03-07
Saturday (weekend) → next business day: 2026-03-09

$ bizday 2026-03-11 end 10
2026-03-24
# taskEndDate(2026-03-11, 10) = addBusinessDays(2026-03-11, 9)
# taskDuration(2026-03-11, 2026-03-24) = 10

$ bizday verify 2026-03-11 5 2026-03-18
OK

$ bizday verify 2026-03-11 5 2026-03-17
MISMATCH: expected 2026-03-17, got 2026-03-18

$ bizday lint crates/scheduler/src/cascade.rs
Line 102: add_business_days("2026-03-11", 3) → "2026-03-16" ✓
Line 237: task_end_date("2026-03-09", 5) → "2026-03-13" ✓
Line 640: weekend date "2026-03-07" in start_date context ✗
3 dates checked, 2 OK, 1 warning
```

**Why dual representation matters**: An agent about to write
`addBusinessDays(start, 10)` sees `offset: 9` in the output and self-corrects.
An agent about to write `taskDuration(start, end)` sees `duration: 10` and
confirms. The tool eliminates the mental `±1` conversion that causes fence-post
bugs.

Agents can use inline: `start=$(bizday 2026-03-06 5)` captures `2026-03-13`.
Duration: `dur=$(bizday 2026-03-11 2026-03-24)` captures `10`. The `#` comment
lines are ignored by shell substitution.

### Implementation

`bizday` is a native Rust binary in `crates/bizday/`. It depends on
`crates/scheduler` for date math — the **same `date_utils` functions** the
scheduling engine uses. No wrapper, no divergence risk.

```toml
# crates/bizday/Cargo.toml
[package]
name = "bizday"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "bizday"
path = "src/main.rs"

[dependencies]
ganttlet-scheduler = { path = "../scheduler" }
serde_json = "1"

[dev-dependencies]
proptest = "1"
tempfile = "3"
```

**Note**: The scheduler crate is published as `ganttlet-scheduler`. In Rust
code, import as `use ganttlet_scheduler::date_utils::*;` (hyphens become
underscores). There is no workspace-level `Cargo.toml` — `bizday` is a
standalone crate with a path dependency. No workspace setup is needed.

```
crates/bizday/
├── Cargo.toml
└── src/
    ├── main.rs      # CLI arg parsing, dispatch
    ├── compute.rs   # +N, -N, diff, end, info operations
    ├── verify.rs    # lint/verify logic (shared with PostToolUse hook)
    ├── log.rs       # Append to .claude/logs/bizday.log (unified events)
    └── report.rs    # bizday report — log parsing, metrics, trend, drill-downs
    tests/
    ├── compute.rs   # Hand-written integration tests
    ├── verify.rs    # Lint mode tests
    ├── log.rs       # Logging integration tests
    ├── report.rs    # Report/metrics output tests
    └── proptest.rs  # Property-based round-trip + invariant tests
```

**Why a separate crate, not a `[[bin]]` in scheduler**: The scheduler crate
is `cdylib` + `rlib` for WASM. Adding a binary target would complicate the
WASM build and add `serde_json` as a non-dev dependency. A separate `crates/bizday/`
crate keeps the WASM artifact clean and lets `bizday` pull in CLI-only dependencies
(serde_json for stdin parsing, potentially `clap` later) without bloating the
browser bundle.

**No cross-verification needed**: The earlier plan had a stretch goal to cross-check
date-fns against the Rust engine. Since `bizday` IS the Rust engine, this is
automatic — every `bizday` computation uses the exact same code path as the scheduler.

---

## Layer 2: Measurement and Review

### What We Need to Know

Five questions, in priority order:

| # | Question | Signal | How measured |
|---|----------|--------|-------------|
| 1 | Is it catching bugs? | Mismatches found by hook | Audit log `MISMATCH` events |
| 2 | Is it accurate? | False warnings | Audit log `FALSE_MATCH` events + false-match rate |
| 3 | Are agents using it? | Proactive CLI calls | Usage log `COMPUTE` events |
| 4 | Is adoption growing? | Proactive rate trend | Per-session proactive rate over time |
| 5 | Is it too slow? | Hook latency | Audit log `elapsed_ms` field |

### Data Sources

Both layers log automatically to `.claude/logs/` (gitignored, persists across
container restarts). A single unified log keeps things simple:

**`.claude/logs/bizday.log`** — one file, all events:
```
2026-03-13T10:00:00Z  SESSION  id=datecalc-plan
2026-03-13T10:01:00Z  COMPUTE  bizday 2026-03-06 5 → 2026-03-13
2026-03-13T10:02:00Z  VERIFIED  start=2026-03-06 end=2026-03-13 dur=6 → OK  elapsed_ms=2
2026-03-13T10:03:00Z  MISMATCH  start=2026-03-06 end=2026-03-12 dur=6 → expected 2026-03-13  elapsed_ms=2
2026-03-13T10:04:00Z  UNVERIFIABLE  date=2026-04-15 context=assert_eq  elapsed_ms=1
2026-03-13T10:05:00Z  WEEKEND  date=2026-03-07 context=start_date  elapsed_ms=1
2026-03-13T10:06:00Z  SUPPRESSED  date=2026-03-11 context=comment  elapsed_ms=1
2026-03-13T10:07:00Z  FALSE_MATCH  file=src/state/ganttReducer.ts:142  elapsed_ms=0
```

**Why one file, not two**: The earlier plan split usage and audit logs. One file
is simpler to parse, rotate, and review. The event type column distinguishes them.

**Session markers**: `bizday` writes a `SESSION` line on first invocation per
session. Session ID comes from `$CLAUDE_SESSION_ID` if set, otherwise the
worktree directory name, falling back to a timestamp. This enables per-session
reporting at zero cost — it's one extra line per session, not per event.

**`elapsed_ms` field**: Every hook invocation logs wall-clock time. Cost: one
`Instant::now()` call. This is insurance — you'll never look at it unless
something feels slow, but without it you'd have no data to debug latency
regressions.

**Log persistence**: The log file is gitignored and lives on the machine, not
in the repo. It accumulates across sessions, commits, and branches on that
machine. On a fresh clone or new machine, the log starts empty. To preserve
metrics permanently, use `bizday report --pr-summary` — the numbers are baked
into the PR description on GitHub.

### Log Volume

| Metric | Per session | Per 100 sessions | Notes |
|--------|------------|-----------------|-------|
| Events | ~50-100 lines | ~5K-10K lines | ~80 bytes/line |
| File size | ~5-8 KB | ~500-800 KB | Negligible |
| Rotation needed? | No | No | Consider at 10K+ sessions or 10MB |

At expected usage rates, log rotation is not needed for months. If it ever
matters: `mv bizday.log bizday.log.1` — the logger opens in append mode and
recreates the file automatically.

### `bizday report` — the review interface

`bizday report` is the user-facing command. It reads `.claude/logs/bizday.log`
and computes all metrics directly in the Rust binary. No shell script to
remember, no path to type — it's the same `bizday` binary used for everything.

**Default: one-line summary** (~5ms):
```
$ bizday report
Coverage: 91% (10/11) | Proactive: 36% | Mismatches: 1 | FP: 0%
```

**Trend: one line per session** (~10ms):
```
$ bizday report --trend
Session              Dates  Cov%   Proact%  Mismatches  FP-rate  Latency-p99
datecalc-plan        23     87.0   26.1     0           0.0%     4ms
issue-57             11     100.0  36.4     1           0.0%     3ms
phase-16a            45     84.4   26.7     2           2.1%     5ms
──────────────────────────────────────────────────────────────────────────────
Cumulative           79     87.3   27.8     3           1.3%     5ms
```

**Drill-down: specific events** (~5ms):
```
$ bizday report --mismatches      # every MISMATCH with file:line
$ bizday report --unverified      # dates the hook couldn't check
$ bizday report --false-matches   # FALSE_MATCH entries for review
$ bizday report --slow            # events where elapsed_ms > 10
```

**PR summary block** (~5ms):
```
$ bizday report --pr-summary
### Date Math Coverage
| Metric | Value |
|--------|-------|
| Dates in code | 23 |
| Auto-verified (hook) | 14 |
| Pre-computed (bizday) | 6 |
| Mismatches caught | 0 |
| Coverage | 87.0% |
```

Agents can append this to PR descriptions. Not enforced — just documented in
CLAUDE.md as part of the PR checklist.

### Key Metrics and Interpretation

| Metric | Formula | Target | What it tells you |
|--------|---------|--------|-------------------|
| **Coverage** | (verified + pre-computed) / total | ≥90% | Overall safety — are dates being checked? |
| **Proactive rate** | pre-computed / total | ≥25% | Stickiness — are agents reaching for `bizday`? |
| **Mismatch rate** | mismatches / verified | Declining | Bug density — are agents writing wrong dates? |
| **False-match rate** | false matches / total warnings | <5% | Signal quality — is the hook trustworthy? |
| **Hook latency (p99)** | from `elapsed_ms` field | <10ms | Overhead — is the hook too slow? |

**Reading the dashboard**:
- High coverage + low proactive rate → Layer 0 doing all the work (acceptable —
  bugs caught, agent just isn't using CLI)
- High coverage + high proactive rate → ideal (agent computing before writing)
- Low coverage → investigate `--unverified` — are they trivial dates or real gaps?
- Rising mismatch rate → agents are writing more wrong dates (tool isn't preventing,
  only catching)
- Rising false-match rate → regex lint is hitting limits (trigger tree-sitter
  evaluation at >5%)
- Latency p99 >10ms → investigate; may indicate large files or regex backtracking

### What Counts as "Verified"

A date literal is "verified" if ANY of:
- It appears in the output column of a `COMPUTE` event (CLI result)
- It was an input to `bizday` (e.g., the start date in `bizday 2026-03-06 5`)
- It was checked by the hook (`VERIFIED` event, even if unverifiable)
- It matches a date already present in the file before the edit (pre-existing)
- It's in a comment or documentation (not executable code — `SUPPRESSED` event)

A date literal is "unverified" if:
- It appears in test assertions, task definitions, or scheduling code
- It was not seen in any `COMPUTE` or `VERIFIED` event in the current session
- It was not present in the file before the edit

### Cost of Measurement

| Component | Runtime cost | Disk cost | Review cost |
|-----------|-------------|-----------|-------------|
| Log append (per event) | ~0.1ms (one `write()` syscall) | ~80 bytes | None |
| Session marker | ~0.1ms (once per session) | ~50 bytes | None |
| `elapsed_ms` capture | ~0.001ms (clock read) | ~15 bytes/event | None |
| `bizday report` (default) | ~5ms | 0 | ~10 seconds to read |
| `bizday report --trend` | ~10ms | 0 | ~5 seconds to scan |
| `bizday report --pr-summary` | ~5ms | 0 | Passive (in PR body) |
| False-match reporting | Agent runs one command | ~80 bytes | As-needed |

**Total per-hook cost**: ~0.2ms added to the ~3ms hook execution. Unmeasurable.
**Total per-session review cost**: Run `--trend`, scan for anomalies. Under 30 seconds.
**Total per-PR review cost**: Zero — summary is in the PR body if agent appended it.

The measurement infrastructure adds essentially nothing to runtime and minimal
review burden. The `--trend` one-liner is the primary review surface — everything
else is drill-down for investigating anomalies.

### Measurement Protocol for Stickiness Testing

Run 5 independent agent sessions, each with a date-math-heavy task:

| Session | Task | Expected bizday calls |
|---------|------|-------------------|
| 1 | Fix: FS lag across weekend produces wrong date | 5-10 |
| 2 | Add: new constraint type with date boundary | 5-10 |
| 3 | Debug: cascade chain produces wrong end date | 8-15 |
| 4 | Test: write 10 date-math test assertions | 10-20 |
| 5 | Review: verify 5 existing test dates are correct | 5-10 |

After each session, run `bizday report --trend`. **Target: 90%+ coverage**.

If coverage drops below 80% in any session, drill down:
```
$ bizday report --session <id> --unverified
```
- Were they trivial (same-day, obvious) or non-trivial?
- Was the agent's reasoning correct despite skipping bizday?
- What would have caught it faster: shorter syntax? better warning?

### Stickiness Decay Test

Run sessions 1-5 again after 10 intervening non-date sessions. Compare
proactive rates via `--trend`. If proactive rate drops >10 percentage points,
the tool isn't sticky enough — needs stronger integration (e.g., move from
warning to soft-block).

### How to Review

Everything is `bizday report`. Same binary, nothing new to remember.

**Quick check** (after any agent session, ~10 seconds):
```
$ bizday report
Coverage: 91% (10/11) | Proactive: 36% | Mismatches: 1 | FP: 0%
```
One line. If coverage ≥90% and FP <5%, you're done.

**Trend over time**:
```
$ bizday report --trend
Session              Dates  Cov%   Proact%  Mismatches  FP-rate  Latency-p99
datecalc-plan        23     87.0   26.1     0           0.0%     4ms
issue-57             11     100.0  36.4     1           0.0%     3ms
phase-16a            45     84.4   26.7     2           2.1%     5ms
──────────────────────────────────────────────────────────────────────────────
Cumulative           79     87.3   27.8     3           1.3%     5ms
```

**During PR review** (zero effort):
The PR description includes a Date Math Coverage table if the agent appended
it (`bizday report --pr-summary`). No table = no date math in that PR.

**When something seems wrong**:
```
bizday report --mismatches      # what dates were wrong?
bizday report --unverified      # what dates weren't checked?
bizday report --false-matches   # is the hook crying wolf?
bizday report --slow            # is the hook lagging?
```

**Decision triggers**:
- FP-rate crosses 5% → evaluate tree-sitter upgrade (see Lint Mode section)
- Proactive rate below 15% for 5+ sessions → strengthen CLAUDE.md instructions
  or add `bizday` to the agent's tool list
- Mismatch rate rising → agents are writing more wrong dates; investigate whether
  the stickiness bridge is surfacing warnings agents are ignoring
- Coverage below 80% → check `--unverified`; if they're non-trivial dates,
  the hook's regex patterns may need expanding

---

### Testing the Measurement Infrastructure

The measurement layer is only useful if the data is actually written. Three
test files verify the full pipeline from event to review:

**`crates/bizday/tests/log.rs`** — Rust integration tests for `log.rs`:

| Test | What it verifies |
|------|-----------------|
| `compute_event_logged` | `bizday 2026-03-11 5` writes a `COMPUTE` line with the correct result |
| `hook_events_logged` | Lint mode writes `VERIFIED`/`MISMATCH`/`WEEKEND`/`SUPPRESSED` as appropriate |
| `elapsed_ms_present` | Every hook event line contains `elapsed_ms=N` where N ≥ 0 |
| `session_marker_once` | First invocation writes `SESSION`, second does not (same session) |
| `new_session_after_id_change` | Changing session ID writes a new `SESSION` marker |
| `creates_log_directory` | With `.claude/logs/` deleted, `bizday` creates it and writes successfully |
| `appends_not_overwrites` | Two invocations produce two lines, not one |
| `log_format_parseable` | Every line matches `^YYYY-MM-DDTHH:MM:SSZ  EVENT_TYPE  .*$` |

All tests use a temporary directory (`tempdir`) as the log root — they don't
touch the real `.claude/logs/`. Each test creates a fresh temp dir, runs
`bizday` with `BIZDAY_LOG_DIR` set to the temp path, then reads the log file
and asserts on content.

**`crates/bizday/tests/report.rs`** — Rust integration tests for `bizday report`:

| Test | What it verifies |
|------|-----------------|
| `empty_log` | Reports 0 for all metrics without error |
| `known_session` | Write 10 known events, verify coverage %, proactive rate, mismatch rate |
| `trend_mode` | Write events across 3 sessions, verify `--trend` has 3 rows + cumulative |
| `pr_summary_markdown` | Verify `--pr-summary` output is valid markdown with correct numbers |
| `mismatches_drilldown` | Write 2 MISMATCH events, verify `--mismatches` lists both with file:line |
| `false_match_rate` | Write 1 FALSE_MATCH among 20 warnings, verify rate = 5.0% |
| `latency_percentile` | Write events with known elapsed_ms values, verify median and p99 |

**Why test the report command**: `report.rs` parses the log lines that `log.rs`
writes. If the log format changes (e.g., a field is reordered), `report`
silently produces wrong numbers. These tests catch format drift by writing
known log lines and asserting on computed metrics.

**`BIZDAY_LOG_DIR` env var**: `bizday` respects this environment variable,
defaulting to `.claude/logs/`. Tests set it to a temp directory. This also
enables running `bizday` in CI without polluting the project's log directory.

---

## Integration Points

### CLAUDE.md Update

Replace the verbose date math examples with:

```markdown
- **Date/duration math**: Use `bizday` (native Rust binary). NEVER compute dates mentally.
  - `bizday 2026-03-11 5` → add 5 business days
  - `bizday 2026-03-11 2026-03-24` → diff between dates (inclusive duration + calendar)
  - `bizday 2026-03-11 end 10` → last working day for duration 10 (inclusive)
  - See `bizday help` for all operations.
```

This is 4 lines instead of the current 8, and the examples are directly
copy-pasteable.

### Commands Quick Reference Table

Add one row:

```
| `bizday <date> N` | Date math (ALWAYS use instead of mental math) |
```

### crates/scheduler/CLAUDE.md Update

Replace:
```
- Do arithmetic in your head — use `node -e` or `python3 -c`
```
With:
```
- Do arithmetic in your head — use `bizday` (crates/bizday)
```

### PostToolUse Auto-Verify Hook (Layer 0)

Add to `.claude/settings.json` (committed) — see Hook Registration section in
Layer 0 above for the JSON config and rationale for committed vs local placement.

### Container Profile

Add to `Dockerfile` or `.bashrc`:
```bash
export PATH="./target/release:$PATH"
```

This puts the `bizday` binary on PATH. If running outside Docker, agents use
`./target/release/bizday` directly. The build step (`cargo build --release -p bizday`)
produces the binary; this should be part of the dev container setup.

---

## Files to Create/Modify

| File | Action | Layer | Purpose |
|------|--------|-------|---------|
| `crates/bizday/Cargo.toml` | Create | 0,1 | Crate manifest — depends on `ganttlet-scheduler` + `serde_json` |
| `crates/bizday/src/main.rs` | Create | 1 | CLI arg parsing, dispatch |
| `crates/bizday/src/compute.rs` | Create | 1 | +N, -N, diff, end, info operations using `date_utils` |
| `crates/bizday/src/verify.rs` | Create | 0 | Lint/verify logic (shared: PostToolUse hook + `bizday lint`) |
| `crates/bizday/src/log.rs` | Create | 0,1,2 | Append to `.claude/logs/bizday.log` (unified: usage + audit + latency) |
| `crates/bizday/tests/compute.rs` | Create | 1 | Hand-written integration tests for all operations |
| `crates/bizday/tests/verify.rs` | Create | 0 | Lint mode tests (mismatch, weekend, deprecated, false positive) |
| `crates/bizday/tests/log.rs` | Create | 2 | Logging integration tests (event format, directory creation, session markers) |
| `crates/bizday/tests/proptest.rs` | Create | 1 | Property-based round-trip + invariant tests (6 properties) |
| `crates/bizday/src/report.rs` | Create | 2 | `bizday report` — log parsing, metrics, trend table, drill-downs |
| `package.json` | Modify | 1 | Add `"build:bizday": "cargo build --release -p bizday"` script |
| `CLAUDE.md` | Modify | all | Replace verbose examples with bizday; document hook |
| `crates/scheduler/CLAUDE.md` | Modify | 1 | Update "Never" section |
| `.claude/settings.json` | Modify | 0 | Add PostToolUse verify hook |
| `Dockerfile` | Modify | 1 | Add `bizday` to PATH |
| `.claude/logs/bizday.log` | Created at runtime | 0,1,2 | Unified event log (gitignored via `.claude/*` glob) |

---

## Handling Historical Bug Cases

Each of the 3 historical bug rounds, analyzed by which layer would have caught it:

### Case 1: Duration as calendar days (`1880999`)

**Bug**: `endDate - startDate` in calendar days ≠ business day duration.

**Layer 0 (hook)**: **Partially catches this.** The hook can't detect that the
wrong function was used (`addDays` vs `addBusinessDays`). But if the agent writes
`taskDuration("2026-03-06", "2026-03-11")` with the wrong result (5 calendar days
instead of 4 business days), the hook catches the mismatch. The deprecated-function
detector would also warn if the agent wrote `workingDaysBetween` instead of
`taskDuration`.

**Layer 1 (bizday CLI)**: **Would catch this** — if the agent uses it:
```
$ bizday 2026-03-06 2026-03-13
6
# duration: 6 — taskDuration(2026-03-06, 2026-03-13), inclusive [start, end]
# offset: 5 — addBusinessDays(2026-03-06, 5) = 2026-03-13
# calendar: 7 days  ← DIFFERENT from business days

$ bizday 2026-03-06 5c
2026-03-11  ← calendar days: wrong answer for business days

$ bizday 2026-03-06 5
2026-03-13
# addBusinessDays(2026-03-06, 5)
# taskEndDate(2026-03-06, 6) — inclusive duration 6
```

**Verdict**: Partial Layer 0 (catches wrong duration value), Layer 1 for
reasoning about which function to use.

### Case 2: Lag as calendar days, weekend landing (`8ee19f8`)

**Bug**: FS predecessor ends Friday, lag 0 → successor starts Saturday.

**Layer 0 (hook)**: **Would catch this.** If the agent writes
`start_date: "2026-03-07"` (Saturday) in scheduling code, the weekend detector
fires with 100% accuracy.

**Layer 1 (bizday CLI)**: Also catches it:
```
$ bizday 2026-03-07
Saturday (weekend) → next business day: 2026-03-09

$ bizday 2026-03-06 1
2026-03-09  ← Monday: skips weekend correctly
```

**Verdict**: Both layers. Layer 0 catches it passively even if agent forgets
Layer 1. This is the strongest case.

### Case 3: Cascade slack miscalculation (`23ad90b`)

**Bug**: Cascade shifted by full delta even when slack absorbed the move.

**Layer 0 (hook)**: **Would partially catch this.** If the test contains
`count_biz_days_to("2026-03-10", "2026-03-15")` with a wrong expected value,
the hook verifies it. But the underlying logic error (shifting when not needed)
is an algorithm bug, not a date math bug — no hook can catch that.

**Layer 1 (bizday CLI)**: Helps reason about it:
```
$ bizday 2026-03-10 2026-03-13
3
# duration: 3 — taskDuration(2026-03-10, 2026-03-13), inclusive [start, end]
# offset: 2 — addBusinessDays(2026-03-10, 2) = 2026-03-13
# calendar: 3 days

$ bizday 2026-03-06 1
2026-03-09
# addBusinessDays(2026-03-06, 1)
# taskEndDate(2026-03-06, 2) — inclusive duration 2

# Required (Mar 09) < current (Mar 13) → slack absorbs, no cascade needed
```

**Verdict**: Partial Layer 0 (catches wrong test values), Layer 1 for reasoning.
The core bug was algorithmic, not arithmetic.

### Summary: Layer Coverage by Historical Bug

| Bug | Layer 0 (passive) | Layer 1 (active) | Root cause |
|-----|------------------|-----------------|------------|
| `1880999` calendar duration | **Partial** (wrong duration value, deprecated fn) | Yes (if used) | Wrong function (`addDays` vs `addBusinessDays`) |
| `8ee19f8` weekend landing | **Yes** (weekend detect) | Yes | Wrong date produced |
| `23ad90b` slack cascade | **Partial** (wrong test values) | Yes (reasoning aid) | Algorithm logic |

**Revised assessment**: Layer 0 now catches or partially catches all 3 historical
bugs thanks to the unified inclusive convention. The `taskEndDate`/`taskDuration`
verification and deprecated-function detection are new capabilities that the earlier
plan couldn't support. Layer 1 remains valuable for reasoning about which function
to use (Case 1) and algorithmic logic (Case 3).

---

## Fence-Post Convention Encoding

This is the subtlest source of bugs. The project has specific conventions:

**Convention (established by Phase 16):**

| Operation | Convention | Example |
|-----------|-----------|---------|
| Duration | `[start, end]` inclusive of both endpoints | Mar 11 to Mar 24 = 10 working days |
| End from duration | `task_end_date(start, dur)` = `shift_date(start, dur - 1)` | Mar 11 + 10 → Mar 24 |
| Duration from dates | `task_duration(start, end)` = `business_day_delta(start, end) + 1` | Mar 11 to Mar 24 → 10 |
| `shift_date(date, n)` | `pub(crate)` — internal only | Never called directly |
| Cascade shift | `business_day_delta(current, required)` | Only shifts if required > current |
| Weekend dates | Forbidden | `find_conflicts()` emits `WEEKEND_VIOLATION` |

**No Rust/TS divergence.** Cross-language consistency tests in both
`date_utils.rs::cross_language_tests` and `dateUtils.test.ts` verify
identical results for canonical cases.

**No counting-function divergence.** Weekend dates are banned — both
`business_day_delta` (Rust) and `businessDaysDelta` (TS) always agree for
valid task dates. `bizday <date> <date>` uses `business_day_delta` directly.

---

## Edge Cases: Weekend Handling

`bizday` uses the scheduler's `is_weekend_date()` and `ensure_business_day()`
directly. Weekend edge cases are handled consistently with the engine:

| Input | `ensure_business_day` | `bizday` behavior |
|-------|----------------------|-------------|
| Saturday | Monday | Warn: "Saturday — next business day: Monday" |
| Sunday | Monday | Warn: "Sunday — next business day: Monday" |
| Friday | Friday (no-op) | No warning |

The `bizday info` command uses `is_weekend_date()` for weekend detection.

Weekend dates are banned project-wide — `find_conflicts()` emits
`WEEKEND_VIOLATION` for any task with a weekend start or end date.
`business_day_delta` and `businessDaysDelta` always agree for valid
(weekday-only) task dates.

---

## Property-Based Testing

Hand-written test cases verify known examples. Property-based tests (`proptest`)
verify **invariants** across thousands of randomly generated dates, catching edge
cases at year boundaries, leap years, month boundaries, and long weekday/weekend
sequences that hand-written tests miss.

### Round-Trip Properties

These must hold for all valid business dates (weekdays) and positive durations:

```rust
use proptest::prelude::*;
use ganttlet_scheduler::date_utils::*;

// Property 1: taskDuration inverts taskEndDate
// ∀ start (weekday), dur > 0:
//   taskDuration(start, taskEndDate(start, dur)) == dur
proptest! {
    #[test]
    fn duration_inverts_end(start in weekday_date(), dur in 1..500i32) {
        let end = task_end_date(&start, dur);
        prop_assert_eq!(task_duration(&start, &end), dur);
    }
}

// Property 2: taskEndDate inverts taskDuration
// ∀ start, end (both weekdays, start <= end):
//   taskEndDate(start, taskDuration(start, end)) == end
proptest! {
    #[test]
    fn end_inverts_duration(pair in ordered_weekday_pair()) {
        let (start, end) = pair;
        let dur = task_duration(&start, &end);
        prop_assert_eq!(task_end_date(&start, dur), end);
    }
}

// Property 3: task_end_date / task_start_date round-trip
// ∀ start (weekday), dur > 0:
//   task_start_date(task_end_date(start, dur), dur) == start
proptest! {
    #[test]
    fn end_start_roundtrip(start in weekday_date(), dur in 1..500i32) {
        let end = task_end_date(&start, dur);
        let back = task_start_date(&end, dur);
        prop_assert_eq!(back, start);
    }
}

// Property 4: taskEndDate is always a weekday
// ∀ start (weekday), dur > 0:
//   is_weekend_date(taskEndDate(start, dur)) == false
proptest! {
    #[test]
    fn end_date_never_weekend(start in weekday_date(), dur in 1..500i32) {
        let end = task_end_date(&start, dur);
        prop_assert!(!is_weekend_date(&end), "end date {} is a weekend", end);
    }
}

// Property 5: duration is always positive for ordered dates
// ∀ start, end (both weekdays, start <= end):
//   taskDuration(start, end) >= 1
proptest! {
    #[test]
    fn duration_positive(pair in ordered_weekday_pair()) {
        let (start, end) = pair;
        prop_assert!(task_duration(&start, &end) >= 1);
    }
}

// Property 6: business_day_delta is consistent with task_duration
// ∀ start, end (both weekdays, start <= end):
//   business_day_delta(start, end) + 1 == task_duration(start, end)
proptest! {
    #[test]
    fn delta_duration_relationship(pair in ordered_weekday_pair()) {
        let (start, end) = pair;
        prop_assert_eq!(
            business_day_delta(&start, &end) + 1,
            task_duration(&start, &end)
        );
    }
}
```

### Test Generators

```rust
/// Generate a random weekday date in 2020-2030 range
fn weekday_date() -> impl Strategy<Value = String> {
    (2020i32..2030, 1i32..366).prop_filter_map("weekday only", |(y, day)| {
        let date = add_days(&format!("{y}-01-01"), day - 1);
        if is_weekend_date(&date) { None } else { Some(date) }
    })
}

/// Generate an ordered pair of weekday dates
fn ordered_weekday_pair() -> impl Strategy<Value = (String, String)> {
    weekday_date().prop_flat_map(|start| {
        (Just(start.clone()), 1..500i32).prop_map(move |(s, dur)| {
            (s, task_end_date(&start, dur))
        })
    })
}
```

### What This Catches

Property-based tests have found real bugs in date libraries:
- Leap year boundary errors (Feb 28 → Mar 1 transitions)
- Year rollover (Dec 31 → Jan 1 across weekends)
- Long weekend sequences (e.g., Friday + weekend + Monday)
- Large offsets that cross multiple months/years

If any property fails, `proptest` shrinks the input to the minimal failing case —
making the bug immediately debuggable.

### Acceptance: Zero Failures

All 6 properties must pass with zero counterexamples. Case counts are tiered:

| Context | Cases per property | Total | Purpose |
|---------|-------------------|-------|---------|
| `cargo test` (local) | 256 | 1,536 | Fast development feedback (~1s) |
| CI (`cargo test --release`) | 10,000 | 60,000 | Catch month-boundary, leap-year, year-rollover edge cases |

Implementation: use `proptest`'s `ProptestConfig`:
```rust
fn config() -> ProptestConfig {
    let cases = std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256);
    ProptestConfig::with_cases(cases)
}

proptest! {
    #![proptest_config(config())]
    #[test]
    fn duration_inverts_end(start in weekday_date(), dur in 1..500i32) {
        // ...
    }
}
```

CI sets `PROPTEST_CASES=10000`. Local runs default to 256 for speed.

If any property produces a counterexample, it's a bug in `date_utils` (since
`bizday` uses the same code). Fix the engine, not the test.

---

## API Design: Single Convention (Completed)

Phase 16 eliminated the dual convention at the API level. The public API
uses only inclusive duration:

| Function | Semantic | Visibility |
|----------|----------|------------|
| `task_end_date(start, duration)` | End date from inclusive duration | **`pub`** |
| `task_duration(start, end)` | Inclusive duration from dates | **`pub`** |
| `task_start_date(end, duration)` | Start from end + duration | **`pub`** |
| `shift_date(date, offset)` | Move a date by N business days | **`pub(crate)`** — internal only |

One convention (inclusive) in all external code. `bizday`'s dual representation
shows both duration and offset as informational context — agents see the
function names they should use in code.

### Layered Safety Model

| Layer | What it prevents | When | Status |
|-------|-----------------|------|--------|
| API design (single convention) | Using wrong function entirely | Compile time | **Done** (Phase 16) |
| `bizday` dual representation | Agent writes wrong number in test/code | Runtime | This plan |
| Property-based tests (proptest) | Engine bugs in `date_utils` | Test time | This plan |
| Pre-commit hook | Banned function names in new code | Commit time | **Done** (Phase 16c) |
| Weekend validation | Weekend dates in task start/end | WASM boundary | **Done** (Phase 16) |

---

## Lint Mode: Regex vs. AST-Aware Parsing

The initial `bizday lint` uses regex pattern matching to extract date literals
and function calls from source code. This is fast and simple but has limitations:

| Aspect | Regex (initial) | AST-aware (future) |
|--------|----------------|-------------------|
| Speed | ~1ms per file | ~2-3ms per file (tree-sitter parse, 20-40KB files) |
| False matches | `add_business_days` in strings/comments may match | Zero — AST knows call vs. string |
| Cross-expression | Can't trace date through variables | Can follow `let d = "2026-03-11"; add_business_days(d, 5)` |
| Implementation | Simple regex in `verify.rs` | Requires `tree-sitter` (TS) or `syn` (Rust) dependency |

**Decision**: Start with regex. The comment-line exclusion (`//`, `#`, `*`)
handles the most common false-match case. AST-aware parsing is a future
improvement — but only if the data justifies the added complexity.

**Measuring whether tree-sitter is worth it**: The unified log
(`.claude/logs/bizday.log`) already records every hook finding. Two event
types track regex accuracy:

```
SUPPRESSED  line matched comment exclusion (// or # prefix)
FALSE_MATCH  warning issued but context was non-scheduling (e.g., date in a string literal, variable name)
```

Agents can report false matches by running `bizday false-match <file>:<line>` —
this appends a `FALSE_MATCH` entry to the audit log. `bizday report`
surfaces the rate:

```
False match rate: 0.0% (0/47 warnings)
Suppressed by comment exclusion: 12
```

**Upgrade criteria**: If `false_match_rate > 5%` over 5+ sessions, the regex
approach is insufficient and tree-sitter is justified. If it stays at 0-2%,
regex is good enough and the added dependency isn't worth it.

**If upgrading to AST-aware**:
- Use `tree-sitter` with TS and Rust grammars for source file parsing
- Use `syn` for Rust files (already available in the ecosystem, no new dep)
- Latency: ~1-2ms per file (20-40KB typical in this project) — well within
  the hook's budget. tree-sitter is designed for keystroke-speed parsing
- Binary size: +~1MB for grammar files (TypeScript + Rust grammars)

**Acceptance criteria for a tree-sitter implementation**:

Correctness — must pass all existing tests plus new ones:
1. Zero regressions: every case the regex lint catches, tree-sitter catches too.
   Run the existing `tests/verify.rs` suite unchanged — all must pass.
2. Zero false matches on the accumulated `FALSE_MATCH` corpus: replay every
   `FALSE_MATCH` entry from the audit log. Tree-sitter must produce no warning
   on each. This is the primary justification for the upgrade.
3. Comment/string exclusion: `add_business_days` inside a string literal,
   comment, or doc comment produces no warning. Test with real examples from
   the codebase (e.g., log messages, CLAUDE.md references).
4. Cross-expression tracing: `let d = "2026-03-11"; add_business_days(d, 5)`
   near `"2026-03-19"` triggers a mismatch warning. Regex can't do this —
   tree-sitter must.
5. Nested expressions: `add_business_days(task.start_date, task.duration)`
   where neither argument is a literal → no warning (unverifiable). Must not
   crash or false-match.

Performance — must not regress the hook budget:
6. Lint latency ≤ 5ms per file for files up to 50KB (measured on
   `constraints.rs` at 40KB). Regex baseline is ~1ms.
7. Hook latency (stdin mode) ≤ 10ms total including binary startup.
   Regex baseline is ~3ms.
8. Benchmark: `cargo bench` comparison of regex vs tree-sitter on the 5
   largest files in `crates/scheduler/src/` and `src/`. Report median and p99.

Compatibility:
9. Both TypeScript and Rust files parsed correctly. Test on at least 3 `.ts`
   and 3 `.rs` files from the project.
10. Graceful fallback: if a file's language is unrecognized (e.g., `.md`,
    `.json`), fall back to regex — never skip the file entirely.
11. Grammar versions pinned in `Cargo.toml` — no floating dependencies.

---

## Batch / Pipeline Mode (Future)

`dateutils`' `datediff` and `dateadd` support stdin streaming for batch
processing. `bizday` could support a similar mode:

```
$ echo -e "2026-03-11 5\n2026-03-06 2026-03-20" | bizday --batch
2026-03-18
11
```

This enables:
- Batch verification of task date CSVs from Sheets exports
- Integration with Unix pipelines (`grep` dates from a file, pipe to `bizday`)
- Faster bulk operations (one process, multiple computations)

**Not in initial scope** — the primary use case is single invocations from
agent Bash calls and the PostToolUse hook. Add if batch verification of
Sheets data becomes a workflow.

---

## Risk Analysis

| Risk | Likelihood | Mitigation | Evidence |
|------|-----------|------------|----------|
| Agent forgets bizday exists | Medium | CLAUDE.md + Layer 0 catches some errors passively | Layer 0 catches 2/3 historical bugs — Layer 1 stickiness still matters |
| Agent uses bizday but misinterprets output | Low | Line 1 is unambiguous; dual representation shows both duration and offset with function names | N/A — not yet tested |
| bizday disagrees with scheduling engine | **Zero** | bizday IS the scheduling engine — same `date_utils` code | No cross-verification needed; single source of truth |
| Hook false positives | **Proven: 0%** | Only checks provably unambiguous patterns | 13 test cases, 11 pass, 2 failures were from ambiguous check (now removed) |
| Hook performance impact | **~3ms** | Native Rust binary, no interpreter startup | 40x faster than Node.js plan (~85ms). Existing verify.sh takes seconds |
| Binary not built | Medium | Hook exits silently if `bizday` not found; build step in dev setup | First `cargo build -p bizday` creates the binary; CI builds it too |
| `bizday` name collision | **None** | No known `bizday` command on Linux | `which bizday` returns nothing |
| `start+dur→end` bugs undetected | **Low** | Hook verifies `taskEndDate`/`task_end_date` patterns; `shift_date` is `pub(crate)` — agents can't call it | Pre-commit hook also rejects banned function names |
| Edge case dates (leap year, year boundary) | **Low** | proptest round-trip tests cover 2020-2030 with random dates | 6 properties × 10,000 cases in CI = 60,000 automated checks |
| Regex lint false matches | Low | Comment-line exclusion handles common case; AST-aware parsing planned as future upgrade | No false positives observed in 13 test cases |
| Log silently fails | Medium | `BIZDAY_LOG_DIR` env var + 8 integration tests in `tests/log.rs` verify directory creation, append, format | Auto-create directory; exit gracefully if write fails (don't block agent) |
| Report metrics format drift | Medium | `tests/report.rs` tests known log input → expected output | Catches when `log.rs` format changes break the metrics parser |

---

## Acceptance Criteria

**Layer 0 (passive — highest priority)**:
1. Verify hook detects wrong `taskEndDate`/`task_end_date` results (inclusive convention)
2. Verify hook detects wrong `taskDuration`/`task_duration` results (inclusive convention)
3. Verify hook warns on weekend dates used as task start/end
4. Verify hook warns on banned function names (`workingDaysBetween`, `shift_date`)
5. Verify hook suggests `bizday` command in every warning (stickiness bridge)
6. Verify hook completes in <10ms (target: ~3ms, native binary)
7. Verify hook produces 0% false positives
8. Verify hook logs all findings to `.claude/logs/bizday.log` (unified log)

**Layer 1 (active)**:
9. `bizday 2026-03-11 5` returns `2026-03-18` in <10ms
10. All operations work correctly (add, subtract, cal-add, cal-sub, diff, info, end, verify, lint, false-match, report, help)
11. `verify` mode exits 0 on match, 1 on mismatch
12. `lint` mode scans a file and reports all verifiable date relationships
13. All historical bug cases (1880999, 8ee19f8, 23ad90b) are reproducible and caught
14. Dual-representation output shows both `duration` and `offset` for every computation

**Property-based (correctness)**:
15. All 6 proptest properties pass: 256 cases locally, 10,000 in CI (zero failures)
16. Round-trip: `task_duration(start, task_end_date(start, dur)) == dur` for all valid inputs
17. Round-trip: `task_start_date(task_end_date(start, dur), dur) == start` for all valid inputs
18. `task_end_date` never returns a weekend date

**Layer 2 (measurement)**:
19. Unified log records all event types with `elapsed_ms` and session markers
20. Log directory auto-created if missing; log appended, never overwritten
21. All 8 `tests/log.rs` integration tests pass (event format, session markers, directory creation)
22. `bizday report` reports coverage, proactive rate, mismatch rate, FP rate in one line
23. `bizday report --trend` shows per-session summary table with cumulative row
24. `bizday report` drill-down modes (`--mismatches`, `--unverified`, `--false-matches`, `--slow`) work
25. `bizday report --pr-summary` outputs valid markdown table
26. All `tests/report.rs` tests pass (known log input → expected metrics output)

**Integration**:
27. CLAUDE.md updated with bizday as primary tool; hook documented
28. Stickiness test: 90%+ coverage across 5 sessions

## State-of-the-Art Comparison

Assessed against professional scheduling tools (MS Project, Primavera P6, Smartsheet),
date CLIs (`dateutils`, NumPy), agent safety frameworks (NeMo Guardrails, Bedrock
Guardrails), and static analysis tools (ESLint, Clippy, Semgrep). As of March 2026:

### Where `bizday` is ahead

| Capability | Industry status | `bizday` |
|---|---|---|
| Passive date error detection | **Does not exist** — no framework detects date errors in agent output | Layer 0 PostToolUse hook, involuntary, 0% false positive |
| Dual-representation output | No CLI shows both inclusive duration and offset with function names | Every computation shows both, mapped to project function signatures |
| Convention-aligned naming | NumPy `busday` uses `[begin, end)` half-open; creates training-data collision | `bizday` — no conflicting convention in LLM training data |
| Stickiness bridge | No agent framework teaches tool usage via error messages | Hook warnings include `Run: bizday ...` commands — passive learning |
| Same-engine guarantee | MS Project↔P6 imports have known divergence bugs | `bizday` IS the scheduler engine — zero divergence by construction |
| Date-aware linting | No production linter catches date calculation bugs | Regex-based with measured AST upgrade path |
| Tool adoption measurement | No framework measures whether agents actually use safety tools | Layer 2 coverage + proactive rate metrics |

### Where `bizday` matches

- **Inclusive end-date convention**: Aligns with MS Project and P6 (`finish = start + duration - 1`
  in working days). Industry standard for scheduling software.
- **Property-based testing**: 6 properties cover the expert checklist (roundtrip, monotonicity,
  weekend exclusion). Generators bias toward weekday dates.
- **API design**: `shift_date` is `pub(crate)`, only `task_end_date`/`task_duration` are public.
  Mirrors P6's approach (hours internally, days at display layer). Already implemented.

### Where `bizday` falls behind — and mitigations

**1. No holiday calendar support.**
Every professional tool supports custom non-working day calendars (MS Project exception days,
P6 activity-level calendar overrides, NumPy `holidays` parameter, `dateutils` `--skip` flag).
The scheduler doesn't support holidays either, so this is acceptable for now. **Dependency**:
if the scheduler ever adds holiday support, `bizday` must gain it simultaneously — or the
same-engine guarantee breaks.

**2. No hours/sub-day resolution.**
P6 avoids the fence-post problem entirely by tracking hours internally. A 1-day task is "8 hours
starting at 09:00" — no ambiguity about endpoint inclusion. The plan's inclusive convention
works but is inherently more error-prone than an hours-based model. This is an architectural
constraint of the scheduler (integer-day model), not something `bizday` can address alone.

**3. No cross-file relationship tracking.**
Layer 0 verifies dates within a single edit. Semgrep-style cross-file pattern matching could
detect inconsistencies between related files (e.g., a task start date in one file and its
predecessor's end date in another). **Future option**: use the audit log as a session-scoped
date registry — track dates written in one edit, verify consistency in subsequent edits.

---

## Non-Goals (This Plan)

- Holiday calendars (future phase — separate concern; if scheduler gains holiday support, `bizday` must add it simultaneously to preserve same-engine guarantee)
- Timezone handling (all dates are date-only strings, no times)
- Interactive mode / REPL
- Replacing date-fns in TypeScript application code (bizday is an agent/hook tool, not a browser runtime dep)
- Blocking edits (Layer 0 warns, never blocks — false positives must not stop work)
- Newtype `Duration`/`Offset` in scheduler (the API already uses single convention; newtypes add marginal safety)
- AST-aware lint parsing (see Lint Mode section — upgrade if regex false matches become a problem)
- Batch/pipeline stdin streaming (see Pipeline Mode section — add when needed)

---

## Implementation Order

Crate structure first, then core logic, property tests, then hook integration:

1. `crates/bizday/Cargo.toml` — create crate with `ganttlet-scheduler` path dep, `proptest` + `tempfile` as dev-dependencies (no workspace — standalone crate)
2. `crates/bizday/src/compute.rs` — core date math operations (+N, -N, diff, end, info) using `ganttlet_scheduler::date_utils`
3. `crates/bizday/src/main.rs` — CLI arg parsing + dispatch
4. `crates/bizday/tests/compute.rs` — hand-written integration tests for all 9 operations
5. `crates/bizday/tests/proptest.rs` — property-based tests (6 properties, 256 cases each). Run early: these test the underlying `date_utils`, not just `bizday`. Any failure here is a scheduler engine bug.
6. `crates/bizday/src/verify.rs` — lint/verify logic (regex-based pattern extraction, relationship checking)
7. `crates/bizday/src/log.rs` — unified log to `.claude/logs/bizday.log` (session markers, all event types, elapsed_ms, `BIZDAY_LOG_DIR` support)
8. `crates/bizday/tests/log.rs` — logging integration tests (8 tests: event format, session markers, directory creation, append behavior)
9. `crates/bizday/tests/verify.rs` — tests for lint mode (mismatch, weekend, deprecated fn, false positive)
10. `.claude/settings.json` — register PostToolUse hook (`./target/release/bizday lint --stdin`)
11. Smoke test: reproduce all 3 historical bug cases with `bizday`
12. `crates/bizday/src/report.rs` — `bizday report` (log parsing, metrics, --trend, --mismatches, --unverified, --false-matches, --slow, --pr-summary)
13. `crates/bizday/tests/report.rs` — status output tests (known log input → expected metrics)
14. Integration: CLAUDE.md, crates/scheduler/CLAUDE.md, Dockerfile
15. Stickiness test: 5 sessions with coverage measurement
