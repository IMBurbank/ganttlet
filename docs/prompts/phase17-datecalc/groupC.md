---
phase: 17
group: C
stage: 1
agent_count: 1
scope:
  modify:
    - .claude/settings.json
    - docs/plans/datecalc-validation/validation-01-cascade-tests.md
    - docs/plans/datecalc-validation/validation-02-debug-duration.md
    - docs/plans/datecalc-validation/validation-03-cross-lang.md
    - docs/plans/datecalc-validation/validation-04-constraint-matrix.md
    - docs/plans/datecalc-validation/validation-05-audit-all.md
    - docs/plans/datecalc-validation/validation-06-regression.md
  read_only:
    - docs/plans/datecalc-tool.md
    - crates/scheduler/src/date_utils.rs
    - crates/scheduler/src/cascade.rs
    - crates/scheduler/src/constraints.rs
    - src/utils/__tests__/dateUtils.test.ts
    - src/state/__tests__/ganttReducer.test.ts
depends_on: []
tasks:
  - id: C1
    summary: "Register PostToolUse hook"
  - id: C2
    summary: "Create 6 validation prompt files"
---

# Phase 17 Group C — Hook Registration + Validation Prompts

You are implementing Phase 17 Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/datecalc-tool.md` for the detailed plan — especially
the "Step 4: Validation prompts" section for task specifications and
the "Step 5: Run validation sessions" section for orchestration.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Context

This group does two things: (1) register the PostToolUse hook so the `bizday`
binary fires on every Edit/Write, and (2) create 6 validation prompt files
that will be used in Stage 2 to test whether agents actually use the date
math tools.

## Your files (ONLY modify these):

**Modify (paths relative to worktree root):**
- `.claude/settings.json`

**Create:**
- `docs/plans/datecalc-validation/validation-01-cascade-tests.md`
- `docs/plans/datecalc-validation/validation-02-debug-duration.md`
- `docs/plans/datecalc-validation/validation-03-cross-lang.md`
- `docs/plans/datecalc-validation/validation-04-constraint-matrix.md`
- `docs/plans/datecalc-validation/validation-05-audit-all.md`
- `docs/plans/datecalc-validation/validation-06-regression.md`

**Read-only:**
- `docs/plans/datecalc-tool.md`
- `crates/scheduler/src/date_utils.rs`
- `crates/scheduler/src/cascade.rs`
- `crates/scheduler/src/constraints.rs`
- `src/utils/__tests__/dateUtils.test.ts`
- `src/state/__tests__/ganttReducer.test.ts`

## Tasks — execute in order:

### C1: Register PostToolUse hook

Read `.claude/settings.json`. It has a `"hooks"` key with
`"PreToolUse"` entries. Add a `"PostToolUse"` sibling key:

```json
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
```

Make sure the existing PreToolUse hooks are untouched. The JSON must be valid.
The hook will exit silently if the `bizday` binary doesn't exist yet.

Verify the JSON is valid:
```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid JSON')"
```

Commit: `"feat: register bizday PostToolUse hook for Edit/Write"`

### C2: Create 6 validation prompt files

Read the existing code to understand what tests exist, then create prompts
that generate NEW tests requiring extensive date computation. Each prompt
must be a standalone instruction file for an agent session.

**Read first:**
- `crates/scheduler/src/date_utils.rs` — understand available functions and existing tests
- `crates/scheduler/src/cascade.rs` — understand cascade logic for Task 1 and 6
- `crates/scheduler/src/constraints.rs` — understand constraint types for Task 4
- `src/utils/__tests__/dateUtils.test.ts` — understand cross-language test format for Task 3
- `src/state/__tests__/ganttReducer.test.ts` — understand reducer test patterns

**Each prompt must include:**
1. Clear task description with specific deliverables
2. Instruction to use `taskEndDate`/`task_end_date` or `taskDuration`/`task_duration` shell functions for ALL date computations — NEVER mental math
3. Instruction to read CLAUDE.md first
4. Specific files to create/modify
5. Expected number of date computations
6. Verification commands to run at the end

**Create these 6 files:**

#### validation-01-cascade-tests.md (MEDIUM — ~12-16 date computations)

Write 6 new test cases for cascade logic in `crates/scheduler/`. Cover:
- FS dependency where predecessor ends Friday, lag 0 → successor starts Monday
- FS dependency with lag 2 crossing a weekend
- SS dependency where predecessor starts Monday, lag 3 → successor starts Thursday
- FF dependency where predecessor ends Wednesday, lag 0, successor duration 5
- SF dependency where predecessor starts Monday, lag 1, successor duration 3
- FS chain: 3 tasks linked FS with lag 0, first starts Monday — compute all end/start dates

Each test requires computing start dates, end dates, and durations using the
shell functions. Agent must verify every expected value with a tool call.

#### validation-02-debug-duration.md (MEDIUM — ~10-12 date computations)

"A user reports that a task from 2026-04-06 to 2026-04-24 shows duration 15
in the UI but they expected 14. Investigate whether 15 is correct."

The agent must:
1. Compute `taskDuration 2026-04-06 2026-04-24` to check the answer
2. Count the business days manually with a tool to explain WHY
3. Write a definitive test in `date_utils.rs`
4. Write 3 more edge-case tests: same-start-and-end, cross-month boundary,
   task spanning a holiday-adjacent period (no holidays — just weekends)

#### validation-03-cross-lang.md (MEDIUM — ~15 date computations)

Add 5 new canonical date pairs to both `date_utils.rs::cross_language_tests`
and `dateUtils.test.ts` cross-language consistency tests. Choose dates that:
1. Cross a month boundary (e.g., March 28 + duration → April)
2. Cross a quarter boundary (e.g., June 29 + duration → July)
3. Start on a Monday with a long duration (20+ days)
4. Start on a Friday with duration 1 (same day — edge case)
5. Cross year-end (e.g., December 29 + duration → January)

Each pair needs start date, duration, and end date — ALL computed with tools,
NEVER mentally. Follow the exact format of existing cross-language tests.

#### validation-04-constraint-matrix.md (LARGE — ~40-50 date computations)

Write tests for all 6 constraint types (FNET, FNLT, SNET, SNLT, MFO, MSO)
× 3 date positions (constraint falls on Friday, Monday, mid-week Wednesday).
That's 18 test cases minimum.

For each test case:
1. Choose a task with start date, duration (compute end date with tool)
2. Choose a constraint date (Friday/Monday/Wednesday as specified)
3. Compute the expected constrained start/end dates
4. Write the assertion

Then add 6 more tests with FS dependencies + constraints to test interaction.
Total: ~24 test cases, each requiring 2-3 date computations = ~50 total.

This task is deliberately repetitive. The agent should sustain tool use across
all 24 cases — watch for mental-math shortcuts in the later cases.

#### validation-05-audit-all.md (LARGE — ~50+ date verifications)

Review every `assert_eq!` containing a date literal or duration in these files:
- `crates/scheduler/src/date_utils.rs` (convention_tests, tests, cross_language_tests)
- `crates/scheduler/src/cascade.rs` (all test modules)
- `crates/scheduler/src/constraints.rs` (all test modules)

For EACH assertion:
1. Extract the function call and expected value
2. Compute the expected value independently using `taskEndDate`/`taskDuration`
3. Mark as CORRECT or WRONG
4. If WRONG, fix the assertion

Produce a summary at the end:
```
Total assertions verified: N
Correct: N
Wrong: N (list each with file:line and correct value)
```

Also verify all date assertions in:
- `src/utils/__tests__/dateUtils.test.ts`
- `src/state/__tests__/ganttReducer.test.ts`

This is ~50+ individual date computations. Every single one must use a tool.

#### validation-06-regression.md (LARGE — ~30-40 date computations)

Reconstruct the 3 historical bugs and write comprehensive regression tests:

**Bug 1 (`1880999`)**: Duration computed in calendar days instead of business days.
- Reconstruct: create a task spanning a weekend, show that calendar days ≠ business days
- Write 4 regression tests: Mon-Fri (5 days), Fri-Tue (3 days, crosses weekend),
  Mon-Mon next week (6 days), 2-week span (10 days)
- Each test uses `taskDuration` to compute expected value

**Bug 2 (`8ee19f8`)**: FS lag treated as calendar days, cascade lands on weekend.
- Reconstruct: FS predecessor ends Friday, lag 0 → successor starts Saturday (BUG)
- Write 4 regression tests: lag 0 (Mon), lag 1 (Tue), lag 2 (Wed), lag 5 (Mon next week)
- Each test uses `fs_successor_start` function and verifies result is a weekday

**Bug 3 (`23ad90b`)**: Cascade over-aggressive due to wrong slack.
- Reconstruct: create a chain where slack should absorb a move but cascade shifts anyway
- Write 4 regression tests varying the slack amount and shift direction
- Each requires computing predecessor end, successor required start, and slack

For each test, compute ALL expected values with shell functions before writing assertions.

Commit: `"docs: create 6 validation prompts for Phase 17 agent testing"`

### Final verification

```bash
# Verify settings.json is valid
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid JSON')"

# Verify all 6 prompt files exist
ls -la docs/plans/datecalc-validation/validation-0*.md | wc -l  # should be 6
```

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- **Calculations**: NEVER do mental math — use `node -e` or `python3 -c`
