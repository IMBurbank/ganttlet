# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to `[x]` when you claim a task.

---

## Phase 11: Testing Infrastructure & Presence Fix — DONE
See `docs/completed-phases.md` for details.

---

## Phase 12: Scheduling Engine Overhaul — DONE
See `docs/completed-phases.md` for details.

---

## Phase 13: Agent Infrastructure Improvements

Improve the multi-agent orchestration system based on recommendations from
`docs/agent-orchestration-recommendations.md`. Single stage with 4 parallel groups
(zero file overlap) + validation.

### Context

After 12 phases of multi-agent development, several patterns of agent failure have been
identified: retry context poverty (agents restart blind after crashes), missing behavioral
guardrails (agents delete tests or produce stubs under pressure), context window exhaustion
(oversized CLAUDE.md and verbose hooks), thin GitHub issue pipeline (no templates, no retry,
generic prompts), and weak progress observability (no progress files, no stall detection).

This phase addresses all of these with infrastructure improvements that benefit all future
agent work — both orchestrated phases and issue-driven single-agent work.

### Agent Groups & File Ownership

```
Stage 1 (Infrastructure — 4 groups, parallel, zero file overlap)

Group A (CLAUDE.md + Skills)           Group B (Orchestrator)
  CLAUDE.md                              scripts/launch-phase.sh
  .claude/skills/*/SKILL.md
  docs/architecture.md (new)
  docs/multi-agent-guide.md (new)

Group C (Hooks & Guardrails)           Group D (GitHub Pipeline)
  scripts/verify.sh                      .github/workflows/agent-work.yml
  scripts/pre-commit-hook.sh (new)       .github/workflows/agent-gate.yml (new)
  .claude/settings.local.json            .github/ISSUE_TEMPLATE/agent-task.yml (new)
```

No file overlap between any groups. All 4 run in parallel.

### Group A: CLAUDE.md Restructure + Skills Pattern

Restructure project knowledge for optimal agent context usage.

**A1: Audit current CLAUDE.md and plan content mapping**
- [x] Read current CLAUDE.md (210 lines), map each section to destination

**A2: Create reference docs**
- [x] Create `docs/architecture.md` with extracted architecture content
- [x] Create `docs/multi-agent-guide.md` with extracted multi-agent content

**A3: Create skill files (8 skills, with "Lessons Learned" sections in orchestration/workflow/shell skills)**
- [x] `.claude/skills/scheduling-engine/SKILL.md`
- [x] `.claude/skills/e2e-testing/SKILL.md`
- [x] `.claude/skills/multi-agent-orchestration/SKILL.md` — must include Lessons Learned (PIPESTATUS, heredoc quoting, stdout pollution, etc.)
- [x] `.claude/skills/google-sheets-sync/SKILL.md`
- [x] `.claude/skills/cloud-deployment/SKILL.md`
- [x] `.claude/skills/issue-workflow/SKILL.md` — must include Lessons Learned (shell injection, max-turns, PR body structure)
- [x] `.claude/skills/rust-wasm/SKILL.md`
- [x] `.claude/skills/shell-scripting/SKILL.md` — cross-cutting bash gotchas (pipe exit codes, heredoc quoting, pipefail, sed placeholders, stdout pollution, tee vs script)

**A4: Rewrite CLAUDE.md to lean core (~110-130 lines)**
- [x] Behavioral rules at top, error protocol, commands, constraints, workflow, conservation

**A5: Verify completeness**
- [x] No content lost — everything exists in lean core, skill, or reference doc

Execution: A1 → A2 → A3 → A4 → A5

### Group B: Orchestrator Improvements (launch-phase.sh)

Harden the multi-agent orchestrator with better retry, observability, and resilience.

**B1: Enrich retry context**
- [x] Inject last 80 lines of log + progress file into retry prompt
- [x] Improve validation retry with structured error extraction

**B2: Add --max-turns and --max-budget-usd**
- [x] Add flags to all claude invocations (run_agent, build_claude_cmd, validate)

**B3: Enrich merge conflict context**
- [x] Inject conflict diffs and branch commit summaries into merge-fix prompt

**B4: Partial stage success**
- [x] Track succeeded/failed groups; merge successful groups, skip failed

**B5: Preflight checks**
- [x] Clean git state, prompt files exist, WASM builds

**B6: Model selection**
- [x] Support MODEL env var passed through to --model flag

**B7: Stall detection watchdog**
- [x] Monitor log file growth; warn if no activity for 30 minutes

Execution: B1 → B2 → B3 → B4 → B5 → B6 → B7

### Group C: Hooks & Guardrails

Reduce hook noise and enforce code quality deterministically.

**C1: Agent-scope awareness in verify.sh**
- [x] AGENT_SCOPE env var (rust, ts, full) routes verification appropriately

**C2: Output deduplication**
- [x] Same result as previous run → 1-line summary instead of full output

**C3: Rate limiting**
- [x] 30-second cooldown between verify.sh runs

**C4: Compact output format**
- [x] Error count + first 5 errors for tsc; pass count or failure list for vitest

**C5: Pre-commit hook**
- [x] `scripts/pre-commit-hook.sh` rejects todo!(), unimplemented!(), commented-out tests

**C6: Validate settings**
- [x] Verify .claude/settings.local.json still works after verify.sh changes

Execution: C1 → C2 → C3 → C4 → C5 → C6

### Group D: GitHub Pipeline

Build a robust issue-to-PR pipeline for single-agent work.

**D1: Issue template**
- [x] `.github/ISSUE_TEMPLATE/agent-task.yml` with summary, acceptance criteria, scope, files, complexity

**D2: Issue quality gate**
- [x] `.github/workflows/agent-gate.yml` validates issues before agent launch

**D3: Overhaul agent-work.yml**
- [x] Rich prompt construction with env vars (not template interpolation)
- [x] Retry loop (2 attempts with error context)
- [x] --max-turns and --max-budget-usd
- [x] .agent-summary.md for PR body
- [x] Complexity-based config from labels

Execution: D1 → D2 → D3

### Validation Agent (runs automatically after final merge)

**Checks:**
- [x] V1: CLAUDE.md structure (100-150 lines, correct sections)
- [x] V2: Skills directory (≥6 skills with YAML frontmatter)
- [x] V3: Reference docs exist (architecture.md, multi-agent-guide.md)
- [x] V4: Content completeness (nothing lost from original CLAUDE.md)
- [x] V5: launch-phase.sh syntax (`bash -n`)
- [x] V6: launch-phase.sh features (retry context, --max-turns, merge context, partial success, preflight, model, watchdog)
- [x] V7: verify.sh syntax + features (scope, dedup, rate limit, compact output)
- [x] V8: Pre-commit hook syntax + logic
- [x] V9: Issue template (all required fields)
- [x] V10: GitHub workflows (gate + overhauled agent-work)
- [x] V11: Build verification (WASM, tsc, vitest, cargo test)
- [x] V12: Settings JSON valid

---

## Phase 13a: Post-Implementation Cleanup

Addendum stage to fix cross-group inconsistencies identified in the Phase 13 post-implementation
review (`docs/phase13-review.md`). Two parallel groups (zero file overlap).

### Context

Phase 13 ran 4 parallel agents that couldn't coordinate. The review found:
- `docs/multi-agent-guide.md` doesn't reflect Group B's new launch-phase.sh features
- `docs/multi-agent-guide.md` contradicts itself about WATCH mode output (line 34 vs 74)
- `CLAUDE.md` doesn't mention the pre-commit hook
- `google-sheets-sync` and `cloud-deployment` skills are lightweight compared to others

### Agent Groups & File Ownership

```
Stage 1 (Cleanup — 2 groups, parallel, zero file overlap)

Group E (Doc Alignment)                Group F (Skill Enrichment)
  docs/multi-agent-guide.md              .claude/skills/google-sheets-sync/SKILL.md
  CLAUDE.md                              .claude/skills/cloud-deployment/SKILL.md
```

### Group E: Documentation Alignment

Sync `docs/multi-agent-guide.md` with the actual state of `scripts/launch-phase.sh` and
add pre-commit hook reference to `CLAUDE.md`.

**E1: Update multi-agent-guide.md with Group B's new features**
- [x] Add section on preflight checks (`preflight_check()`)
- [x] Add section on partial stage success (succeeded/failed group tracking, merge skipping)
- [x] Add section on stall detection watchdog (`monitor_agent()`, `STALL_TIMEOUT` env var)
- [x] Add section on model selection (`MODEL` env var → `--model` flag)
- [x] Add `resume` command to the launch-phase.sh commands list
- [x] Document new env vars: `DEFAULT_MAX_TURNS`, `DEFAULT_MAX_BUDGET`, `STALL_TIMEOUT`, `MODEL`
- [x] Add `--max-turns` to the CLI reference key flags list

**E2: Fix WATCH mode description contradiction**
- [x] Line 34 says "full interactive output (tool calls, diffs, thinking)" — this is wrong
- [x] Line 74 correctly says "-p mode shows streaming text, not the full rich TUI"
- [x] Make both descriptions consistent: WATCH mode shows streaming text output, not full TUI
- [x] Note this is a known limitation — `-p` is required for auto-exit and `--max-budget-usd`

**E3: Add pre-commit hook reference to CLAUDE.md**
- [x] Add `scripts/pre-commit-hook.sh` to the Development Environment section
- [x] Include install command: `ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit`

Execution: E1 → E2 → E3

### Group F: Skill Enrichment

Bring `google-sheets-sync` and `cloud-deployment` skills up to the quality level of the
other skills (multi-agent-orchestration, shell-scripting, issue-workflow).

**F1: Enrich google-sheets-sync skill**
- [x] Add specific gotchas section (column name conventions, date serialization format, row ordering)
- [x] Document the actual data mapping between Ganttlet task fields and Sheets columns
- [x] Add known failure modes (token expiry during sync, rate limiting, concurrent edits)
- [x] Reference actual source files: `sheetsClient.ts`, `sheetsMapper.ts`, `sheetsSync.ts`

**F2: Enrich cloud-deployment skill**
- [x] Add deployment troubleshooting patterns (common Cloud Run failures, health check debugging)
- [x] Document specific `gcloud` commands used in the deploy pipeline
- [x] Add the staging → production promotion flow
- [x] Reference actual files: `deploy.yml`, `Dockerfile.server`, `deploy/frontend/Dockerfile`
- [x] Add gotchas from deploy workflow (WIF auth, artifact registry paths, env var injection)

Execution: F1 → F2

---

## Resource Assignment & Leveling
Basic resource tracking and overallocation detection.

- [ ] Define resource data model (id, name, capacity, calendar)
- [ ] Add resource assignment UI (task → resource mapping)
- [ ] Implement overallocation detection (flag tasks exceeding capacity)
- [ ] Implement basic resource leveling (delay tasks to resolve conflicts)

## Baseline Tracking
Save and compare schedule snapshots.

- [ ] Define baseline data model (snapshot of dates per task)
- [ ] Add "Save Baseline" action (store current dates)
- [ ] Render baseline bars on Gantt chart (ghost bars behind actuals)
- [ ] Add variance columns (planned vs. actual start/finish delta)

## Export
Generate shareable outputs from the Gantt chart.

- [ ] Export to PDF (print-friendly layout with headers/legend)
- [ ] Export to PNG (rasterize SVG at chosen resolution)
- [ ] Export to CSV (flat table of task data)
