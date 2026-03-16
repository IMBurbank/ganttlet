---
phase: 17
group: V
stage: 2
agent_count: 1
scope:
  modify:
    - docs/plans/datecalc-tool.md
    - docs/plans/datecalc-validation/results.md
  read_only:
    - docs/plans/datecalc-validation/validation-01-cascade-tests.md
    - docs/plans/datecalc-validation/validation-02-debug-duration.md
    - docs/plans/datecalc-validation/validation-03-cross-lang.md
    - docs/plans/datecalc-validation/validation-04-constraint-matrix.md
    - docs/plans/datecalc-validation/validation-05-audit-all.md
    - docs/plans/datecalc-validation/validation-06-regression.md
    - .claude/logs/bizday.log
depends_on: [A, B, C]
tasks:
  - id: V1
    summary: "Run 6 validation agent sessions"
  - id: V2
    summary: "Analyze results and document findings"
---

# Phase 17 Group V — Validation

You are running Phase 17 validation for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/datecalc-tool.md` — especially Steps 5, 6, and 7.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

Validation sub-agents must also run in worktrees branched from this worktree's
branch (`feature/phase17-datecalc`), NOT from `main`. This is critical — they
need the Stage 1 code (bizday binary, shell functions, hook registration).

## Context

Stage 1 built the `bizday` binary, shell function aliases, PostToolUse hook,
and CLAUDE.md updates. This stage validates whether agents
actually use these tools by running 6 agent sessions (3 medium, 3 large)
with date-heavy tasks and analyzing the results.

## Prerequisites

Before starting, verify Stage 1 merged successfully:
```bash
cargo build --release -p bizday
./target/release/bizday 2026-03-11 10  # must return 2026-03-24
source scripts/datecalc-functions.sh
taskEndDate 2026-03-11 10  # must return 2026-03-24
```

## Tasks — execute in order:

### V1: Run 6 validation agent sessions

Launch each session in an isolated worktree **branched from this worktree's
branch** (so they inherit the Stage 1 code). Run medium tasks first (faster),
then large tasks.

**Important**: Each agent session must run in a SEPARATE worktree so logs
don't collide. The `BIZDAY_LOG_DIR` should be set to a per-session directory
OR all sessions can share `.claude/logs/` if session markers distinguish them.

**Important**: All worktrees MUST branch from the current branch (which has
the merged Stage 1 code), NOT from `main`. Use the explicit base ref.

```bash
# Get the current branch name (should be feature/phase17-datecalc or similar)
PHASE17_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Medium tasks (run first — faster feedback)
for i in 1 2 3; do
  git worktree add "$(pwd)/../datecalc-val-$i" -b datecalc-val-$i "$PHASE17_BRANCH"
  claude --dangerously-skip-permissions \
    -p docs/plans/datecalc-validation/validation-0${i}-*.md \
    --cwd "$(pwd)/../datecalc-val-$i" &
done
wait

# Large tasks (run after medium complete)
for i in 4 5 6; do
  git worktree add "$(pwd)/../datecalc-val-$i" -b datecalc-val-$i "$PHASE17_BRANCH"
  claude --dangerously-skip-permissions \
    -p docs/plans/datecalc-validation/validation-0${i}-*.md \
    --cwd "$(pwd)/../datecalc-val-$i" &
done
wait
```

After each batch completes, check that logs exist:
```bash
ls -la .claude/logs/bizday.log
wc -l .claude/logs/bizday.log
```

### V2: Analyze results and document findings

Run the analysis commands from Step 6 of the plan:

```bash
# Overall tool usage
bizday report --trend

# Name preference
grep "COMPUTE" .claude/logs/bizday.log | \
  sed 's/.*COMPUTE  //' | cut -d' ' -f1 | sort | uniq -c | sort -rn

# Node fallback check — search worktree session histories
for i in 1 2 3 4 5 6; do
  echo "=== Session $i ==="
  grep -r "node -e.*date-fns\|node -e.*addBusinessDays\|node -e.*differenceInBusiness" \
    "$(pwd)/../datecalc-val-$i/" 2>/dev/null | wc -l
done

# Mental math rate
bizday report --unverified

# Hook catches
bizday report --mismatches

# False positives
bizday report --false-matches
```

**Compare medium vs large tasks:**

For each session, count:
- Total date computations (COMPUTE events in log)
- Dates written in code (from hook VERIFIED/UNVERIFIABLE events)
- Tool calls per date written (adoption rate)
- For large tasks: compare first half vs second half of session

Create `docs/plans/datecalc-validation/results.md` with:

```markdown
# Phase 17 Validation Results

## Summary

| Session | Task | Type | Dates | Tool calls | Adoption % | Mismatches | FP |
|---------|------|------|-------|-----------|-----------|-----------|-----|
| 1 | Cascade tests | Medium | ? | ? | ? | ? | ? |
| 2 | Debug duration | Medium | ? | ? | ? | ? | ? |
| 3 | Cross-language | Medium | ? | ? | ? | ? | ? |
| 4 | Constraint matrix | Large | ? | ? | ? | ? | ? |
| 5 | Audit all tests | Large | ? | ? | ? | ? | ? |
| 6 | Regression suite | Large | ? | ? | ? | ? | ? |

## Name Preference
[Which names did agents use? Counts per name.]

## Node Fallback
[Did any agent use raw node -e with date-fns? How many times?]

## Mental Math Rate
[How many dates were written without a preceding tool call?]

## Decay Signal (Large Tasks Only)
[For tasks 4-6: did tool usage decline in later edits?]

## Hook Effectiveness
[Did the hook catch any real errors? Any false positives?]

## Decisions
[Based on data: what should change before PR?]
```

Fill in the table with actual data from the analysis.

Then update `docs/plans/datecalc-tool.md` — add a "Validation Results" section
near the end with a summary of findings and any changes made.

Commit: `"docs: Phase 17 validation results — agent tool adoption data"`

### Final verification

```bash
bizday report --eval
cat docs/plans/datecalc-validation/results.md
```

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- **Calculations**: NEVER do mental math — use `taskEndDate`/`taskDuration` shell functions for dates, `python3 -c` for arithmetic
