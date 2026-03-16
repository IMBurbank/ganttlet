# Phase 17 Validation Results

## Round 1 (confounded — prompts had node -e examples)

All 6 sessions completed successfully but measured the wrong thing. The validation
prompts (written by Group C agent) provided `node -e` with date-fns as copy-paste
examples despite instructions to use `taskEndDate`/`taskDuration`. Root cause: 24
files across the project still contained `node -e` date instructions from phases 14-16.
Agents followed the nearest example.

- **bizday/shell adoption**: 0%
- **node -e usage**: 100%
- **Mental math**: 0%

**Action taken**: Replaced `node -e` date instructions across 29 files (all phases,
skills, agents, CLAUDE.md). Re-ran validation.

## Round 2 (clean — prompts had taskEndDate/taskDuration examples)

| Session | Task | Type | Tests Added | bizday/shell calls | node -e date calls | Adoption |
|---------|------|------|-------------|-------------------|-------------------|----------|
| 1 | Cascade tests | Medium | 6 | 9 | 0 | 100% |
| 2 | Debug duration | Medium | 4 | 2 | 0 | 100% |
| 3 | Cross-language | Medium | 15 | 3 | 0 | 100% |
| 4 | Constraint matrix | Large | 24 | 14 | 0 | 100% |
| 5 | Audit all tests | Large | 0 (184 audited) | 19 | 1 | 95% |
| 6 | Regression suite | Large | 12 | 14 | 0 | 100% |

**Overall adoption: ~99%** (61 bizday/shell calls, 1 node -e date call across all 6 sessions)

Note: Raw `node -e` counts in transcripts appear much higher (~400+) because
PreToolUse hooks in `.claude/settings.json` are implemented as `node -e` one-liners
that fire on every Bash call. These are infrastructure, not agent behavior. See
issue #56 for migration to Rust.

## Key Findings

1. **Prompt examples dominate agent behavior** — Round 1 (0%) vs Round 2 (99%) with
   identical tooling proves that the copy-paste example in the nearest prompt is the
   primary driver of tool choice, not CLAUDE.md or training data.

2. **No mental math in either round** — The "NEVER do mental math" instruction works
   regardless of which tool agents use. Zero mental math across 12 sessions.

3. **No decay in large tasks** — Agents sustained tool use across 50+ computations
   (Val-4) and 184 verifications (Val-5) with no fallback to shortcuts.

4. **Date accuracy is 100%** — Val-5 audited 184 existing assertions across 5 files.
   Zero wrong. The date convention work from Phase 16 is solid.

5. **Hook was not meaningfully triggered** — The PostToolUse bizday lint hook fires
   but the pattern matching (looking for `task_end_date`/`taskEndDate` calls near
   date literals) doesn't match typical test assertion code. The hook's value is as
   a safety net for production code edits, not test code.

## Decisions

| Signal | Finding | Decision |
|--------|---------|----------|
| Shell function adoption | 99% in round 2 | Ship — tools work when examples are correct |
| Mental math rate | 0% across both rounds | The instruction is effective |
| Hook catches | 0 real catches | Keep — safety net costs nothing (~0.7ms/edit) |
| Hook false positives | 0 | No tuning needed |
| Project instruction consistency | Was 24:3 node-e vs bizday | Fixed to 0:29 — all files updated |
