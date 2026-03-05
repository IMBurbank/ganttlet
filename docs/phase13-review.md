# Phase 13 Post-Implementation Review

## Summary

Phase 13 successfully implemented the majority of P0 and P1 recommendations from the agent orchestration recommendations document. All four groups delivered their core artifacts: CLAUDE.md was restructured to 113 lines with 8 skills and 2 reference docs, launch-phase.sh gained retry enrichment/preflight/partial-success/stall-detection/model-selection, verify.sh gained scope-awareness/dedup/rate-limiting, and the GitHub pipeline was overhauled with templates/gate/retry/complexity-routing. The most significant remaining issue is the **WATCH mode rich output regression** — `build_claude_cmd()` still uses `-p` (sparse text-only) instead of interactive mode, and `multi-agent-guide.md` contradicts itself about what WATCH mode displays. Several cross-group inconsistencies from parallel implementation need follow-on fixes.

## Scorecard

| # | Recommendation | Priority | Status | Quality | Notes |
|---|---|---|---|---|---|
| §1A | Rich retry context (log tails + progress file) | P0 | Yes | Solid | Both `run_agent()` (line 109-137) and `build_claude_cmd()` wrapper (line 269-294) inject commits, log tails, progress file |
| §1B | Progress file (`claude-progress.txt`) | P0 | Yes | Solid | Referenced in CLAUDE.md line 26, error protocol, and all group prompts |
| §1C | Structured validation retry | P0 | Yes | Solid | `validate()` (line 946-955) and `watch_validate()` (line 466-474) use `sed` + `grep -E` for structured error extraction |
| §2A | Behavioral guardrails in CLAUDE.md | P0 | Yes | Solid | Lines 7-18 of CLAUDE.md — 11 rules at the top |
| §2B | Pre-commit hook | P1 | Yes | Good | `scripts/pre-commit-hook.sh` checks for `todo!()`, `unimplemented!()`, commented-out tests |
| §3A | Just-in-time context loading (skills) | P0 | Yes | Solid | 8 skills in `.claude/skills/`, referenced from lean CLAUDE.md |
| §3B | `--max-turns` on all invocations | P1 | Yes | Solid | Present in `run_agent()` (line 148), `build_claude_cmd()` (line 300), `validate()` (line 971), `watch_validate()` (line 496), `resolve_merge_conflicts()` (lines 723, 742) |
| §3C | `--max-budget-usd` on all invocations | P1 | Yes | Solid | Same locations as `--max-turns` |
| §3D | Scope-aware verify.sh | P2 | Yes | Solid | `AGENT_SCOPE` env var (rust/ts/full) in verify.sh line 36 |
| §4A | Structured `.agent-status.json` | P2 | No | — | Not implemented. `claude-progress.txt` (plain text) used instead. Acceptable tradeoff. |
| §4B | Mid-run checkpoint commits | P0 | Yes | Good | Covered in CLAUDE.md error protocol and group prompts |
| §4C | Stall detection watchdog | P3 | Yes | Good | `monitor_agent()` function (lines 172-201), launched alongside each agent (line 613) |
| §5A | Success/failure criteria at top of prompts | P1 | Yes | Solid | All four group prompts lead with success criteria and failure criteria sections |
| §5B | Explicit attempt budgets | P1 | Yes | Good | CLAUDE.md line 21: "3 distinct approaches" language |
| §6 | Rich merge conflict context | P1 | Yes | Solid | `resolve_merge_conflicts()` (lines 678-709) injects file content + branch commit summary |
| §7 | Two-pass validation | P2 | No | — | Not implemented. Validation still single-pass with retry. Acceptable — was P2. |
| §8 | Agent-scope-aware hooks | P2 | Yes | Solid | `AGENT_SCOPE` env var in verify.sh, three modes (rust/ts/full) |
| §9 | Error escalation levels | P1 | Yes | Solid | Three levels + emergency in CLAUDE.md lines 20-24 |
| §10A | Partial stage success | P2 | Yes | Solid | Both `run_parallel_stage()` (lines 619-656) and `watch_parallel_stage()` (lines 413-443) track succeeded/failed groups; `do_merge_stage()` (line 818) skips failed |
| §10B | Preflight checks | P3 | Yes | Good | `preflight_check()` (lines 547-574) checks git state, prompt files, WASM build |
| §10C | Model selection | P3 | Yes | Good | `MODEL` env var in `run_agent()` (line 143) and `build_claude_cmd()` (line 332-334) |
| §11 | Dry-run mode | P3 | No | — | Explicitly excluded from Phase 13 scope. Low priority. |
| §12A | Issue templates | P1 | Yes | Solid | `.github/ISSUE_TEMPLATE/agent-task.yml` with all 5 required fields |
| §12B | Issue quality gate | P1 | Yes | Solid | `.github/workflows/agent-gate.yml` validates 4 criteria, removes label on failure |
| §12C | Overhaul agent-work.yml | P0 | Yes | Solid | Rich prompts, retry (2 attempts), env-var-based injection (no shell injection), complexity routing, `.agent-summary.md` PR body |
| §13 | Output volume control | P1 | Yes | Solid | Dedup (hash-based), rate limiting (30s cooldown), compact output (error count + head -5) |
| §14 | CLAUDE.md restructuring | P0 | Yes | Solid | 113 lines, behavioral rules at top, error protocol, commands, constraints, workflow, conservation, pointers |
| §15 | Skills pattern | P0 | Yes | Solid | 8 skills with YAML frontmatter, lessons learned in 3 required skills |
| §16 | Failure mode mapping | — | Yes | — | Meta-section; addressed through implementation of above |

**Summary: 5/5 P0 items addressed. 10/10 P1 items addressed. 4/6 P2 items addressed. 3/4 P3 items addressed. 2 items not implemented (P2 `.agent-status.json`, P2 two-pass validation, P3 dry-run). All were explicitly scoped out or deprioritized.**

## Cross-Group Inconsistencies Found

### 1. WATCH mode self-contradiction in multi-agent-guide.md (Group A)

**File**: `docs/multi-agent-guide.md`
- **Line 34**: Claims WATCH mode shows "full interactive output (tool calls, diffs, thinking — the same as running `claude` directly in a terminal)"
- **Lines 74-75**: States "Note: `-p` mode shows streaming text, not the full rich TUI (no thinking blocks or tool-use panels)"

These two statements directly contradict each other. The guide describes WATCH mode as providing full TUI output but then correctly notes that `-p` mode (which is what WATCH actually uses) does NOT provide full TUI output.

### 2. WATCH mode `-p` regression confirmed (Group B)

**File**: `scripts/launch-phase.sh`, line 300
```bash
echo "$FULL_PROMPT" | claude --dangerously-skip-permissions --max-turns "$MAX_TURNS_VAL" --max-budget-usd "$MAX_BUDGET_VAL" $MODEL_FLAG -p - 2>&1 | tee -a "$LOGFILE"
```

The `build_claude_cmd()` wrapper uses `-p` (pipe mode), which produces sparse text-only output. This is the regression documented in the Phase 13 planning. The multi-agent-orchestration skill (lesson #1) documents the tradeoff but the script hasn't been fixed. **This is a known issue from the Phase 13 run itself** — Group B couldn't see Group A's skill content documenting the solution because they ran in parallel.

**Impact**: Live monitoring in tmux shows text-only output rather than the rich TUI with thinking blocks and tool-use panels that was available in Phase 12's interactive mode approach.

### 3. multi-agent-guide.md doesn't document Group B's new features

**File**: `docs/multi-agent-guide.md`

Group A wrote this doc in parallel with Group B. The guide does NOT mention any of these new launch-phase.sh features:
- Preflight checks (`preflight_check()`)
- Partial stage success (succeeded/failed group tracking)
- Stall detection watchdog (`monitor_agent()`)
- Model selection (`MODEL` env var)
- `--max-turns` / `--max-budget-usd` defaults (`DEFAULT_MAX_TURNS`, `DEFAULT_MAX_BUDGET`)
- `STALL_TIMEOUT` env var
- `resume` command

The guide's environment variables section (in the CLI reference) lists `--max-budget-usd` as a key flag but doesn't document `--max-turns` or the new config variables.

### 4. multi-agent-guide.md CLI reference incomplete

**File**: `docs/multi-agent-guide.md`, line 97

Lists key flags as: `--dangerously-skip-permissions`, `-p`, `-c`, `-r`, `--system-prompt`, `--model`, `--max-budget-usd`

Missing `--max-turns` from the list. This flag is used in every claude invocation in `launch-phase.sh` but not documented in the guide's CLI reference.

### 5. Shell-scripting skill ↔ launch-phase.sh alignment (minor)

**Files**: `.claude/skills/shell-scripting/SKILL.md` and `scripts/launch-phase.sh`

The shell-scripting skill documents `PIPESTATUS[1]` for claude's exit code through tee. The actual implementation in `build_claude_cmd()` line 301 uses:
```bash
EXIT_CODE=${PIPESTATUS[1]:-$?}
```
But the PIPESTATUS comment on line 298 says `[0]=echo [1]=claude [2]=tee`, which is correct for a 3-stage pipe (`echo | claude | tee`). The skill file documents the pattern correctly. **Alignment is good here.**

### 6. `--max-budget-usd` only works with `--print` caveat not reflected in script

**File**: `.claude/skills/multi-agent-orchestration/SKILL.md` (lesson about `--max-budget-usd` only working with `--print`)

The skill documents that `--max-budget-usd` only works with `-p` mode. Since `build_claude_cmd()` uses `-p`, this is currently fine. However, if the WATCH mode regression is fixed by switching to interactive mode (no `-p`), `--max-budget-usd` would stop working. This constraint needs to be tracked in any follow-on fix.

### 7. CLAUDE.md `docs/completed-phases.md` reference is thin

**File**: `docs/completed-phases.md`

This file is only 4 lines with no actual content about phases 0-12. CLAUDE.md line 94 says "Detailed notes on phases 0-12 (auth, sync, deployment)" but the file just says "See CLAUDE.md for the active project guide." This appears to be a pre-existing issue, not a Phase 13 regression.

## Quality Highlights

1. **CLAUDE.md restructure is excellent.** 113 lines, behavioral rules prominently at top, error protocol is clear and actionable, commands table is concise, pointers section lists all 8 skills with accurate one-line descriptions. This is a model for how project instructions should be structured.

2. **launch-phase.sh is comprehensive.** All 7 subtasks (B1-B7) were implemented. The partial stage success tracking, preflight checks, and stall detection are well-engineered. The existing retry infrastructure was properly preserved — no features were lost.

3. **verify.sh scope-awareness and output control.** The refactored script cleanly separates into `run_tsc()`, `run_vitest()`, and `run_cargo()` functions. Hash-based dedup is a smart approach. The PIPESTATUS bug fix (replacing the broken `|| TSC_EXIT=$?` pattern) was correctly addressed.

4. **agent-work.yml security.** Issue body is passed via environment variables (not `${{ }}` interpolation in shell), which prevents shell injection. The `-p` flag is correct (not `--print`). Complexity-based resource allocation with three tiers is well-designed.

5. **Skill files are genuinely useful.** The multi-agent-orchestration skill's 8 lessons learned are specific, actionable, and reference exact patterns. The shell-scripting skill's 7 gotchas with code examples would prevent real failures. These aren't generic filler.

6. **Pre-commit hook is well-targeted.** Checks for the exact anti-patterns documented in §2 (todo!(), unimplemented!(), commented-out tests). The TypeScript empty body check is correctly a warning rather than a blocker.

## Gaps and Weaknesses

1. **WATCH mode regression is the biggest gap.** `-p` mode sacrifices rich output (thinking blocks, tool-use panels) for auto-exit behavior. The orchestration skill documents the tradeoff but the script hasn't been updated. Fixing this is non-trivial because interactive mode doesn't auto-exit, and `--max-budget-usd` doesn't work without `-p`.

2. **multi-agent-guide.md is stale relative to launch-phase.sh.** The guide was written by Group A before Group B's changes landed. It accurately describes the *pre-Phase-13* orchestrator, not the current one. Missing: preflight, partial success, stall detection, model selection, resume command, all new env vars.

3. **google-sheets-sync and cloud-deployment skills are lightweight.** These two skills lack specific gotchas or lessons learned. They read more like high-level overviews than actionable agent reference material. Compare with shell-scripting (7 detailed patterns with code) or multi-agent-orchestration (8 specific lessons).

4. **No `.agent-status.json` structured progress.** The recommendations doc (§4A, P2) suggested a JSON progress file for machine-readable status. `claude-progress.txt` (plain text) was implemented instead. This is a reasonable tradeoff but limits orchestrator automation (can't programmatically detect which tasks are done).

5. **Two-pass validation not implemented.** The recommendations doc (§7, P2) suggested splitting validation into diagnostic-then-fix passes to prevent fix-one-break-another cycles. Current implementation is single-pass with retry. The structured error extraction partially addresses this.

6. **Pre-commit hook is not auto-installed.** The hook exists at `scripts/pre-commit-hook.sh` but requires manual symlink (`ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit`). No setup script, Makefile target, or documentation in CLAUDE.md instructs agents or developers to install it.

7. **CLAUDE.md doesn't mention pre-commit hook.** The hook is a key behavioral guardrail but CLAUDE.md has no reference to it. Agents won't know it exists unless they explore the `scripts/` directory.

## Recommendation

**Minor follow-on needed.**

Phase 13 achieved its primary objectives. All P0 and P1 items are addressed. The cross-group inconsistencies are expected artifacts of parallel execution and are straightforward to fix. The WATCH mode regression is the most significant issue but has a known tradeoff (interactive mode lacks `--max-budget-usd` support), so it requires design consideration rather than a simple fix.

## Follow-On Work

### Priority 1 — Fix cross-group inconsistencies

1. **Update `docs/multi-agent-guide.md` to reflect Group B's changes.**
   - Add sections for: preflight checks, partial stage success, stall detection, model selection (`MODEL` env var), `resume` command
   - Add `--max-turns` to the CLI reference key flags list
   - Document new env vars: `DEFAULT_MAX_TURNS`, `DEFAULT_MAX_BUDGET`, `STALL_TIMEOUT`, `MODEL`
   - Fix the WATCH mode description contradiction (lines 34 vs 74-75): either say "streaming text output" consistently, or document the rich-vs-sparse tradeoff clearly

2. **Add pre-commit hook reference to CLAUDE.md.**
   - Add a line in the Commands Quick Reference or Development Environment section
   - Include install instructions: `ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit`

### Priority 2 — Address WATCH mode regression

3. **Investigate WATCH mode interactive output restoration.**
   - The core tension: interactive mode (no `-p`) gives rich TUI but doesn't auto-exit and loses `--max-budget-usd`
   - Options to evaluate:
     a. Use interactive mode + prompt instruction to exit + accept no budget limit
     b. Use `-p` mode and accept sparse output (current state)
     c. Investigate if newer Claude CLI versions have addressed the `--max-budget-usd` limitation in interactive mode
   - File: `scripts/launch-phase.sh`, `build_claude_cmd()` function (line 239-338)
   - Related: `.claude/skills/multi-agent-orchestration/SKILL.md` lessons #1, #10, #11

### Priority 3 — Quality improvements

4. **Enrich google-sheets-sync and cloud-deployment skills.**
   - Add specific gotchas, column name mappings, date serialization details to google-sheets-sync
   - Add deployment troubleshooting patterns, specific GCP commands to cloud-deployment

5. **Consider auto-installing pre-commit hook.**
   - Add to `npm run prepare` or document in setup instructions
   - Ensure it doesn't break CI (CI typically doesn't need pre-commit hooks)
