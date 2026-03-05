# Phase 13: Agent Infrastructure Improvements — Planning Summary

## Overview

Phase 13 implements the recommendations from `docs/agent-orchestration-recommendations.md`
to improve agent reliability, context management, and the GitHub issue-to-agent pipeline.
This is a meta-phase — agents are improving the agent infrastructure itself.

## Structure

**Single stage with 4 parallel groups + validation.** All groups have zero file overlap,
so parallel execution is safe.

```
Stage 1 (4 groups, parallel)
├── Group A: CLAUDE.md + Skills Pattern (CLAUDE.md, .claude/skills/, docs/)
├── Group B: Orchestrator (scripts/launch-phase.sh)
├── Group C: Hooks & Guardrails (scripts/verify.sh, scripts/pre-commit-hook.sh)
└── Group D: GitHub Pipeline (.github/)

Stage 2: Validation (1 group, after merge)
└── 12-point checklist covering all deliverables
```

## launch-phase.sh Config Block

Replace the config block at the top of `scripts/launch-phase.sh` with:

```bash
PROMPTS_DIR="${PROMPTS_DIR:-docs/prompts/phase13}"
PHASE="phase13"

# Stage 1: Infrastructure improvements (4 groups, parallel, zero file overlap)
STAGE1_GROUPS=("groupA" "groupB" "groupC" "groupD")
STAGE1_BRANCHES=(
  "feature/phase13-claude-skills"
  "feature/phase13-orchestrator"
  "feature/phase13-hooks-guardrails"
  "feature/phase13-github-pipeline"
)
STAGE1_MERGE_MESSAGES=(
  "Merge feature/phase13-claude-skills: restructure CLAUDE.md to lean core, create .claude/skills/ with 7 domain skills, extract reference docs"
  "Merge feature/phase13-orchestrator: enrich retry context, add --max-turns/budget, improve merge conflict context, partial stage success, preflight, model selection, stall detection"
  "Merge feature/phase13-hooks-guardrails: scope-aware verify.sh, output dedup, rate limiting, compact output, pre-commit hook"
  "Merge feature/phase13-github-pipeline: issue template, quality gate workflow, overhaul agent-work.yml with retry and complexity routing"
)

# No Stage 2 or 3 needed — single parallel stage
STAGE2_GROUPS=()
STAGE2_BRANCHES=()
STAGE2_MERGE_MESSAGES=()
STAGE3_GROUPS=()
STAGE3_BRANCHES=()
STAGE3_MERGE_MESSAGES=()
```

## Assumptions

1. **Phase numbering**: Phase 13 is the next phase (phases 0-12 are done per CLAUDE.md and TASKS.md).

2. **Skills directory**: `.claude/skills/<name>/SKILL.md` is the correct Claude Code skills convention. This follows the pattern documented in the Anthropic skills architecture. If the project uses a different convention, the skill file locations can be adjusted during validation.

3. **Pre-commit hook is a portable script, not installed to .git/hooks/**: The hook is created as `scripts/pre-commit-hook.sh` and can be symlinked (`ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit`). This keeps it in version control. We do NOT add husky or lefthook as a dependency — that would violate the "minimal dependencies" architecture constraint.

4. **No application code changes**: This phase modifies only infrastructure files (scripts, config, docs, workflows). No `.ts`, `.tsx`, `.rs`, or other application source files are changed.

5. **launch-phase.sh is self-modifying safe**: Group B modifies `launch-phase.sh` in a worktree. The running orchestrator uses the copy on `main`, not the worktree copy. After merge, the improvements take effect for the next phase.

6. **CLAUDE.md restructuring preserves all content**: Nothing is deleted — content moves to skill files, reference docs, or stays in the lean core. The validation agent (V4) explicitly checks for completeness.

7. **verify.sh changes are backward compatible**: The `AGENT_SCOPE` env var defaults to `full` (current behavior). Existing workflows that don't set `AGENT_SCOPE` see no change.

8. **agent-work.yml uses raw CLI, not claude-code-action**: The raw `claude -p` approach gives more control over flags (`--max-turns`, `--max-budget-usd`, `--model`), retry logic, and prompt construction. `claude-code-action` is better for interactive comment-based workflows, which Ganttlet doesn't use.

## Alternatives Not Picked

### 1. Multi-stage sequential execution (A → B → C → D)
**Why considered**: The user specified "safety > parallelism." Sequential execution eliminates all merge risk.
**Why rejected**: There is literally zero file overlap between the four groups. Parallel execution is safe by construction — each group touches completely different files. Running sequentially would quadruple wall-clock time for no safety benefit.

### 2. Two phases instead of one (Phase 13a: foundation, Phase 13b: everything else)
**Why considered**: "Agents should take advantage of improvements from each phase in the next." If CLAUDE.md restructuring happened first, later agents would benefit from the leaner context.
**Why rejected**: These agents run in worktrees branched from `main`. They read the CURRENT `CLAUDE.md`, not the restructured one. The improvements only take effect after merge — which happens at the same time regardless of whether we run 1 phase or 2. Split phases would add overhead (merge, validate, commit, re-launch) without benefit.

### 3. Include a dry-run/smoke-test mode (P3 recommendation)
**Why considered**: §11 recommends testing the orchestration itself.
**Why rejected**: Low impact relative to effort. The orchestrator has worked reliably for 12 phases. The more impactful improvements (retry context, partial success, preflight) address the actual pain points. Dry-run mode can be added later if orchestrator bugs become a problem.

### 4. Include auto-compaction guidance in CLAUDE.md (P3 recommendation)
**Why rejected**: Group A is already doing significant work restructuring CLAUDE.md. Adding more content risks exceeding the target line count. The "Context Conservation Guide" section in the new CLAUDE.md covers the essentials. Extended guidance can go in the issue-workflow skill.

### 5. Use husky/lefthook for the pre-commit hook
**Why rejected**: Adds a dependency, violating the "minimal dependencies, high security posture" architecture constraint. A simple bash script that can be symlinked is sufficient.

### 6. Split Group B (orchestrator) into two agents
**Why considered**: Group B has 7 subtasks modifying a single 867-line file — that's a lot of work.
**Why rejected**: All 7 changes are to the same file. Two agents can't modify `launch-phase.sh` simultaneously without creating merge conflicts. One agent working sequentially through 7 well-defined changes is the only safe approach.

## Workload Assessment

| Group | Est. Subtasks | Est. Files Modified | Est. Files Created | Complexity |
|-------|--------------|--------------------|--------------------|------------|
| A     | 5            | 1                  | 9                  | Medium — mostly extraction and restructuring |
| B     | 7            | 1                  | 0                  | Medium-High — multiple edits to complex script |
| C     | 6            | 1                  | 1                  | Medium — well-defined improvements |
| D     | 3            | 1                  | 2                  | Medium — YAML workflows with clear templates |

No group is dramatically larger than the others. Group B has the most subtasks but they're
all modifications to one file with clear specifications.

## How to Launch

```bash
# 1. Commit all planning files
git add docs/prompts/phase13/ docs/TASKS.md
git commit -m "prep: phase 13 planning — prompts, tasks, launch config"

# 2. Update launch-phase.sh config block (see above)
# Edit the PROMPTS_DIR, PHASE, and STAGE*_* arrays

# 3. Commit config change
git add scripts/launch-phase.sh
git commit -m "prep: update launch-phase.sh config for phase 13"

# 4. Verify clean state
git status  # should show nothing

# 5. Launch
./scripts/launch-phase.sh all
# or with live output:
WATCH=1 ./scripts/launch-phase.sh all
```

## Post-Phase Benefits

After Phase 13 merges and validates:

1. **All future agents** benefit from:
   - Lean CLAUDE.md (~1,200 tokens vs ~2,500) — more room for actual work
   - Skills pattern — domain knowledge loads on demand
   - Behavioral guardrails — less likely to delete tests or produce stubs
   - Pre-commit hook — deterministic rejection of hollow implementations

2. **Future orchestrated phases** benefit from:
   - Rich retry context — agents don't repeat the same mistakes
   - Partial stage success — one failed group doesn't block others
   - Preflight checks — no more launching into broken environments
   - Stall detection — stuck agents get flagged early
   - Model selection — right-size compute per task

3. **Issue-driven agent work** benefits from:
   - Structured issue templates — agents get enough context
   - Quality gate — vague issues get flagged before agents start
   - Rich prompts with scope rules and error handling
   - Retry logic — one failure doesn't waste the whole run
   - Complexity routing — small issues get small budgets
