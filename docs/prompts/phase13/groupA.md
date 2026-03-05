# Phase 13 Group A — CLAUDE.md Restructure + Skills Pattern

You are implementing Phase 13 Group A for the Ganttlet project.
Read CLAUDE.md and `docs/agent-orchestration-recommendations.md` (Sections 14 and 15) for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 distinct approaches, commit what you have and move on to the next task.

## Success Criteria (you're done when ALL of these are true):
1. CLAUDE.md is ~110–130 lines and contains: behavioral rules, error protocol, commands, architecture constraints, single-agent workflow, context conservation guide, and pointers to reference docs
2. At least 6 skill files exist in `.claude/skills/*/SKILL.md` with proper YAML frontmatter
3. Reference docs `docs/architecture.md` and `docs/multi-agent-guide.md` exist with content extracted from the current CLAUDE.md
4. No information has been lost — everything in the current CLAUDE.md exists somewhere (lean core, skill, or reference doc)
5. All changes committed with descriptive messages

## Failure Criteria (keep working if any of these are true):
- CLAUDE.md is over 150 lines
- Any skill file is missing YAML frontmatter (name + description)
- Content from the current CLAUDE.md was deleted without being relocated
- Uncommitted changes

## What this project is

Ganttlet is a collaborative Gantt chart / scheduling tool where multiple users edit the same
schedule simultaneously over a network (CRDT-based sync). The scheduling engine runs as a
Rust→WASM module in each user's browser.

## Your files (ONLY modify these):
- `CLAUDE.md` (rewrite to lean core)
- `.claude/skills/scheduling-engine/SKILL.md` (new)
- `.claude/skills/e2e-testing/SKILL.md` (new)
- `.claude/skills/multi-agent-orchestration/SKILL.md` (new)
- `.claude/skills/google-sheets-sync/SKILL.md` (new)
- `.claude/skills/cloud-deployment/SKILL.md` (new)
- `.claude/skills/issue-workflow/SKILL.md` (new)
- `.claude/skills/rust-wasm/SKILL.md` (new)
- `docs/architecture.md` (new — extracted content)
- `docs/multi-agent-guide.md` (new — extracted content)

Do NOT modify `scripts/`, `.github/`, or any source code files. Other agents own those files.

## Progress Tracking

After completing each major task (A1, A2, etc.), append a status line to `claude-progress.txt`
in the worktree root:

```
A1: DONE — read current CLAUDE.md, mapped content to destinations
A2: IN PROGRESS — creating reference docs
```

On restart, read `claude-progress.txt` FIRST to understand where you left off.

## Error Handling Protocol

- Level 1 (fixable): Read error, fix, re-run. Up to 3 distinct approaches.
- Level 2 (stuck): Commit WIP with honest message, move to NEXT TASK (not "stop all work").
- Level 3 (blocked): Commit, write BLOCKED in claude-progress.txt, skip dependent tasks.
- Emergency: If running out of context, `git add -A && git commit -m "emergency: groupA saving work"`.

## Tasks — execute in order:

### A1: Audit current CLAUDE.md and plan content mapping

1. Read the full current `CLAUDE.md` (210 lines).
2. Read `docs/agent-orchestration-recommendations.md` Sections 14 and 15 for the target structure.
3. Create a content mapping: for each section of the current CLAUDE.md, decide where it goes:
   - **Keep in lean CLAUDE.md**: Behavioral rules, error protocol, commands quick ref, architecture constraints, single-agent workflow, context conservation, pointers to docs
   - **Move to `docs/architecture.md`**: Tech stack details, architecture principles, architecture constraints (expanded), development environment, Docker details, E2E testing & relay details, cloud verification plan
   - **Move to `docs/multi-agent-guide.md`**: Multi-agent orchestration section, Claude CLI reference, pre-phase checklist, adding a new phase, WATCH mode
   - **Move to skill files**: Domain-specific knowledge for each skill area
4. Commit nothing yet — this is planning.

### A2: Create reference docs with extracted content

1. Create `docs/architecture.md` with content extracted from CLAUDE.md:
   - Project overview and tech stack
   - Full architecture principles and constraints (expanded from the lean summary)
   - Development environment setup (Docker, ports, etc.)
   - E2E testing & relay (the full section from current CLAUDE.md)
   - Cloud verification plan reference
   - Git workflow conventions
2. Create `docs/multi-agent-guide.md` with:
   - Multi-agent orchestration (launch-phase.sh usage, WATCH mode)
   - Claude CLI reference (the full reference from current CLAUDE.md)
   - Pre-phase checklist
   - Adding a new phase
   - Validation prompt patterns
   - Unplanned issues workflow
3. Commit: `"refactor: extract CLAUDE.md content into docs/architecture.md and docs/multi-agent-guide.md"`

### A3: Create skill files

Create the `.claude/skills/` directory and all skill files. Each skill file MUST have:
- YAML frontmatter with `name` and `description` fields
- The description should be 1-2 sentences explaining when to use this skill
- The body should contain actionable domain knowledge (patterns, gotchas, commands)

Create these skills:

1. **`.claude/skills/scheduling-engine/SKILL.md`** — Use when working on CPM, cascade, constraints, or any scheduling logic in `crates/scheduler/`. Include:
   - Module map (cpm.rs, cascade.rs, constraints.rs, graph.rs, types.rs, date_utils.rs, lib.rs)
   - Key algorithms (forward/backward pass, cascade rules, constraint types)
   - Known gotchas (ES from dependencies not stored dates, scoped CPM runs on full graph, float == 0 not abs < 1)
   - Testing patterns (`cargo test`, `cargo clippy`)

2. **`.claude/skills/e2e-testing/SKILL.md`** — Use when writing or debugging E2E tests, or working with the relay server. Include:
   - Playwright setup and configuration
   - How the relay starts (`E2E_RELAY=1`)
   - Collab test patterns (cross-tab sync, presence)
   - `./scripts/full-verify.sh` details
   - Docker container requirements for Chromium

3. **`.claude/skills/multi-agent-orchestration/SKILL.md`** — Use when modifying `launch-phase.sh`, creating phase prompts, or debugging orchestration. Include:
   - launch-phase.sh architecture (stages, merge gating, retry)
   - Prompt file structure and conventions
   - Worktree isolation pattern
   - WATCH mode (tmux-based, with retry loop and log capture via `tee`)
   - Claude CLI reference (flags and gotchas)
   - **"Lessons Learned" section** with specific gotchas discovered in prior phases:
     - `PIPESTATUS[1]` is required to capture claude's exit code through a `tee` pipe (`$?` gives tee's exit)
     - WATCH mode wrapper scripts must use single-quoted heredoc (`<<'DELIM'`) with sed placeholder substitution to avoid premature variable expansion
     - `setup_worktree()` returns the path via stdout — all other output inside it MUST go to `>/dev/null` or `>&2` or downstream `cd` commands break
     - `script -q -c` for TTY logging is fragile; prefer `tee -a` for simultaneous terminal + file capture
     - Validation log parsing must exclude the `COMMAND=` header line to avoid false positive failure detection
     - `--prompt-file` does not exist as a CLI flag; use `-p` with stdin or positional argument
     - `--print` is not a valid flag — the correct flag is `-p`

4. **`.claude/skills/google-sheets-sync/SKILL.md`** — Use when working on Sheets integration. Include:
   - OAuth2 flow (client-side token handling)
   - sheetsClient.ts, sheetsMapper.ts, sheetsSync.ts roles
   - Data mapping between Ganttlet and Sheets formats
   - Test patterns for Sheets-related code

5. **`.claude/skills/cloud-deployment/SKILL.md`** — Use when working on deployment, Cloud Run, or staging. Include:
   - Cloud Run deployment pipeline
   - Environment variable injection (not baked into builds)
   - Promotable artifacts pattern
   - Health check and smoke test scripts
   - GCP project layout

6. **`.claude/skills/issue-workflow/SKILL.md`** — Use when working from a GitHub issue (agent-ready label, single-agent work). Include:
   - Branch naming: `agent/issue-{number}`
   - Implementation order (read → test → implement → verify)
   - Verification: `./scripts/full-verify.sh`
   - PR creation with `gh pr create` and `Closes #N`
   - Error handling levels (L1/L2/L3)
   - `.agent-summary.md` format
   - Context conservation tips
   - **"Lessons Learned" section** with gotchas from the GitHub Actions agent pipeline:
     - `${{ github.event.issue.body }}` injected directly into a shell heredoc is a shell injection risk — always sanitize or use environment variables
     - The workflow's claude invocation needs `--max-turns` and `--max-budget-usd` to prevent runaway agents
     - PR body should include structured sections (Summary, Test plan, Closes #N) not generic boilerplate
     - The agent should read CLAUDE.md and relevant skill files before starting work

7. **`.claude/skills/rust-wasm/SKILL.md`** — Use when building WASM, debugging wasm-pack, or modifying Rust→JS bindings. Include:
   - `wasm-pack build` command and options
   - wasm-bindgen patterns for the project
   - Generated files location (`src/wasm/scheduler/`)
   - Debugging WASM build failures
   - How lib.rs exports work

8. **`.claude/skills/shell-scripting/SKILL.md`** — Use when writing or modifying any bash scripts in this project (launch-phase.sh, verify.sh, full-verify.sh, CI scripts). Include:
   - **Pipe exit codes**: `$?` in a pipeline returns the LAST command's exit code. Use `${PIPESTATUS[0]}` for the first command's exit code, `${PIPESTATUS[1]}` for the second, etc. Example: `cmd1 | tee log.txt; echo ${PIPESTATUS[0]}` gets cmd1's exit, not tee's.
   - **Heredoc quoting**: `<<'DELIM'` (single-quoted) prevents ALL variable expansion inside the heredoc. Use this for wrapper scripts that will be executed later. `<<DELIM` (unquoted) expands variables at write time — use `\$` to escape variables that should expand at runtime.
   - **`set -uo pipefail`**: Always use in scripts. `pipefail` makes pipes return the first non-zero exit code. `set -u` catches undefined variables. Omit `set -e` in scripts with intentional non-zero exits (like retry loops).
   - **sed placeholder substitution**: When generating a script file with `cat <<'DELIM'`, use placeholder strings and `sed -i 's|PLACEHOLDER|value|g'` to inject values — avoids quoting hell.
   - **stdout pollution in functions**: If a function returns a value via `echo`, ALL other output inside it must go to `>/dev/null` or `>&2`. Stray output corrupts the return value.
   - **`script` vs `tee` for logging**: `script -q -c` wraps a command in a pseudo-TTY for logging but is fragile across platforms. Prefer `cmd 2>&1 | tee -a logfile` with `PIPESTATUS` for exit code capture.
   - **Always run `bash -n scriptname.sh`** after editing any bash script to catch syntax errors before committing.

Commit: `"feat: create .claude/skills/ with 8 domain-specific skill files"`

### A4: Rewrite CLAUDE.md to lean core

Rewrite CLAUDE.md to approximately 110-130 lines. The structure should be:

```
1. Agent Behavioral Rules (Non-Negotiable)     ~20 lines
2. Error Handling Protocol                      ~15 lines
3. Commands Quick Reference                     ~15 lines
4. Architecture Constraints (brief)             ~10 lines
5. Single-Agent Issue Workflow (expanded)        ~30 lines
6. Context Conservation Guide                   ~10 lines
7. Pointers to Reference Docs + Skills          ~15 lines
```

Key requirements:
- Behavioral rules MUST be at the very top (highest visibility position)
- The error protocol must include all 3 levels plus the emergency commit instruction
- Commands section should be concise (most-used commands only)
- Architecture constraints should be the short version (1 line each)
- Single-agent workflow should cover: setup, implementation order, verification, PR creation, when stuck
- Context conservation should mention: commit early, check git log, check claude-progress.txt, use subagents
- Pointers section should list all reference docs and mention that skills are available in `.claude/skills/`
- Include the existing content from "Completed Work", "Task Queue", and "Roadmap" sections (brief)

Commit: `"refactor: restructure CLAUDE.md to lean ~120-line core with skills and reference docs"`

### A5: Verify completeness

1. Compare the old CLAUDE.md content against the new structure. Verify nothing was lost:
   - Every section from the old CLAUDE.md should exist somewhere (lean core, skill, or reference doc)
   - Cross-check: tech stack → architecture.md, multi-agent → multi-agent-guide.md, CLI ref → multi-agent-guide.md + skill, etc.
2. Verify all skill files have valid YAML frontmatter
3. Verify CLAUDE.md line count is between 100 and 150
4. Run `wc -l CLAUDE.md` to confirm
5. Commit any fixes

### A6: Final verification

1. `git status` — everything committed
2. `git diff --stat HEAD~5..HEAD` — review your changes
3. Verify no other files were modified outside your scope
4. Update `claude-progress.txt` with final status
