# Phase 13 Validation — Agent Infrastructure Improvements

You are the validation agent for Phase 13. Your job is to verify that all four agent groups
completed their work correctly, fix any issues from the merge, and ensure everything works together.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.

## Phase 1: Diagnostic (do NOT fix anything yet)

Run each check below. Record PASS or FAIL. Do not attempt any fixes until all checks are done.

### V1: CLAUDE.md Structure
- Read `CLAUDE.md`. Verify it is approximately 100-150 lines.
- Verify it contains these sections (in order): Behavioral Rules, Error Protocol, Commands, Architecture Constraints, Single-Agent Workflow, Context Conservation, Reference Pointers
- PASS/FAIL: ___

### V2: Skills Directory
- Verify `.claude/skills/` directory exists
- Verify at least 7 skill files exist with proper YAML frontmatter (name + description)
- Check these skills exist: scheduling-engine, e2e-testing, multi-agent-orchestration, google-sheets-sync, cloud-deployment, issue-workflow, rust-wasm, shell-scripting
- Verify multi-agent-orchestration and issue-workflow skills contain "Lessons Learned" sections with specific gotchas
- Verify shell-scripting skill covers: PIPESTATUS, heredoc quoting, pipefail, sed placeholders, stdout pollution
- PASS/FAIL: ___

### V3: Reference Docs
- Verify `docs/architecture.md` exists and contains architecture content
- Verify `docs/multi-agent-guide.md` exists and contains multi-agent orchestration content
- PASS/FAIL: ___

### V4: Content Completeness
- Verify no critical content was lost from the original CLAUDE.md:
  - Tech stack info exists somewhere (CLAUDE.md or docs/architecture.md)
  - Architecture constraints exist in CLAUDE.md (brief) and docs/architecture.md (detailed)
  - Multi-agent orchestration exists in docs/multi-agent-guide.md
  - Claude CLI reference exists in docs/multi-agent-guide.md or a skill
  - E2E testing info exists in docs/architecture.md or e2e-testing skill
  - Single-agent issue workflow exists in CLAUDE.md (expanded)
- PASS/FAIL: ___

### V5: launch-phase.sh Syntax
- Run `bash -n scripts/launch-phase.sh`
- PASS/FAIL: ___

### V6: launch-phase.sh Features
- Read `scripts/launch-phase.sh` and verify these features exist:
  - Rich retry context (log tails in run_agent retry)
  - `--max-turns` flag in agent invocations
  - `--max-budget-usd` flag in agent invocations
  - Enriched merge conflict context (diffs + branch summary)
  - Partial stage success logic
  - `preflight_check()` function
  - `MODEL` env var support
  - Stall detection (`monitor_agent()` or equivalent)
- PASS/FAIL: ___

### V7: verify.sh Syntax and Features
- Run `bash -n scripts/verify.sh`
- Read `scripts/verify.sh` and verify:
  - `AGENT_SCOPE` env var support (rust, ts, full)
  - Output deduplication (same result → 1-line summary)
  - Rate limiting (cooldown between runs)
  - Compact output (error count, not full dump)
- PASS/FAIL: ___

### V8: Pre-commit Hook
- Run `bash -n scripts/pre-commit-hook.sh`
- Verify it checks for: `todo!()`, `unimplemented!()`, commented-out tests
- PASS/FAIL: ___

### V9: GitHub Issue Template
- Verify `.github/ISSUE_TEMPLATE/agent-task.yml` exists
- Verify it has required fields: summary, acceptance criteria, scope, complexity
- PASS/FAIL: ___

### V10: GitHub Workflows
- Verify `.github/workflows/agent-gate.yml` exists and has quality gate logic
- Verify `.github/workflows/agent-work.yml` has: retry loop, --max-turns, --max-budget-usd, .agent-summary.md, complexity routing
- Verify existing workflows (`ci.yml`, `deploy.yml`, `e2e.yml`) are UNMODIFIED
- PASS/FAIL: ___

### V11: Build Verification
- Run `npm run build:wasm` — PASS/FAIL: ___
- Run `npx tsc --noEmit` — PASS/FAIL: ___
- Run `npm run test` — PASS/FAIL: ___
- Run `cd crates/scheduler && cargo test` — PASS/FAIL: ___

### V12: .claude/settings.local.json
- Verify it is valid JSON
- Verify PostToolUse hooks still reference verify.sh
- PASS/FAIL: ___

## Phase 2: Fix and Verify

For each FAILED check from Phase 1:
1. Diagnose the root cause
2. Fix it
3. Re-run THAT check to confirm the fix
4. Re-run ALL checks to verify no regressions

Common issues to expect after merging 4 parallel branches:
- CLAUDE.md merge conflicts (Group A restructured it)
- settings.local.json might need manual merging
- launch-phase.sh might have section ordering issues from multiple additions

## Phase 3: Final Report

Re-run ALL 12 checks one final time. Print a summary table:

```
╔══════════════════════════════════════════════════╗
║ Phase 13 Validation Report                       ║
╠═════════════════════════╦═══════╦════════════════╣
║ CHECK                   ║ RESULT║ NOTES          ║
╠═════════════════════════╬═══════╬════════════════╣
║ V1  CLAUDE.md structure ║       ║                ║
║ V2  Skills directory    ║       ║                ║
║ V3  Reference docs      ║       ║                ║
║ V4  Content completeness║       ║                ║
║ V5  launch-phase.sh syn ║       ║                ║
║ V6  launch-phase.sh feat║       ║                ║
║ V7  verify.sh           ║       ║                ║
║ V8  Pre-commit hook     ║       ║                ║
║ V9  Issue template      ║       ║                ║
║ V10 GitHub workflows    ║       ║                ║
║ V11 Build verification  ║       ║                ║
║ V12 Settings JSON       ║       ║                ║
╠═════════════════════════╬═══════╬════════════════╣
║ OVERALL                 ║       ║                ║
╚═════════════════════════╩═══════╩════════════════╝
```

If ALL checks pass, commit any fixes with: `"fix: phase 13 validation — [description of fixes]"`

If any check still fails after your fixes, mark it FAIL in the table with an explanation.
