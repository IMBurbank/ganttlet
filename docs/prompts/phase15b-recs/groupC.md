---
phase: 15b-recs
group: C
stage: 2
agent_count: 1
scope:
  modify:
    - docs/multi-agent-guide.md
    - .claude/skills/multi-agent-orchestration/SKILL.md
    - .claude/skills/shell-scripting/SKILL.md
  read_only:
    - scripts/lib/watch.sh
    - scripts/lib/validate.sh
    - scripts/lib/merge.sh
    - scripts/lib/tmux-supervisor.sh
    - CLAUDE.md
depends_on: [A, B]
tasks:
  - id: C1
    summary: "Read all docs and merged script changes"
  - id: C2
    summary: "Add piping warning to docs (SIGPIPE kills pipelines)"
  - id: C3
    summary: "Add task scope guidance (required vs stretch)"
  - id: C4
    summary: "Document script changes from Groups A and B"
  - id: C5
    summary: "Verify consistency across all docs"
---

# Phase 15b-recs Group C — Documentation Updates

You are implementing Phase 15b-recs Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

Phase 15b revealed several orchestration issues. Groups A and B (Stage 1) fixed the scripts. Your job is to update all documentation and agent instruction files to reflect these changes and add new guidance.

## Your files (ONLY modify these):
- `docs/multi-agent-guide.md` — Primary orchestration documentation
- `.claude/skills/multi-agent-orchestration/SKILL.md` — Orchestration skill (gitignored, use `git add -f`)
- `.claude/skills/shell-scripting/SKILL.md` — Shell scripting skill (gitignored, use `git add -f`)

Read-only:
- `scripts/lib/watch.sh` — See validation pipe mode + timeout changes
- `scripts/lib/validate.sh` — See timeout changes
- `scripts/lib/merge.sh` — See WASM skip changes
- `scripts/lib/tmux-supervisor.sh` — See stall detection changes
- `CLAUDE.md` — Check for any needed updates (unlikely)

## Tasks — execute in order:

### C1: Read all docs and merged script changes

1. Read `docs/multi-agent-guide.md` — understand current structure
2. Read `.claude/skills/multi-agent-orchestration/SKILL.md`
3. Read `.claude/skills/shell-scripting/SKILL.md`
4. Read the modified scripts to understand what changed:
   - `scripts/lib/watch.sh` — watch_validate now uses pipe mode + has VALIDATE_TIMEOUT
   - `scripts/lib/validate.sh` — has VALIDATE_TIMEOUT
   - `scripts/lib/merge.sh` — conditional WASM rebuild
   - `scripts/lib/tmux-supervisor.sh` — stall detection in tmux_wait_stage

### C2: Add piping warning (Rec #1)

**Problem**: Running `./scripts/launch-phase.sh ... | head -30` caused SIGPIPE to kill the pipeline process when it tried to write more output.

Add a warning to these files:

**In `docs/multi-agent-guide.md`** — Add a "Common Pitfalls" or "Warnings" section (or add to an existing one):
```
### Pipeline Output
- **NEVER** pipe launch-phase.sh output through `head`, `tail`, `less`, or other
  truncating commands. This causes SIGPIPE which kills the pipeline process.
- Use `tee` to capture output: `./scripts/launch-phase.sh <config> all 2>&1 | tee pipeline.log`
- Or redirect to a file: `./scripts/launch-phase.sh <config> all > pipeline.log 2>&1`
- The `WATCH=1` mode shows output in tmux — no piping needed.
```

**In `.claude/skills/multi-agent-orchestration/SKILL.md`** — Add to the Lessons Learned section:
```
- **SIGPIPE kills pipelines**: Never pipe `launch-phase.sh` output through `head`/`tail`/`less`. The pipeline process receives SIGPIPE when the reader closes early, killing the entire orchestration. Use `tee` or file redirection instead.
```

**In `.claude/skills/shell-scripting/SKILL.md`** — Add a note about SIGPIPE in long-running processes if there's a relevant section.

Commit: `"docs: add SIGPIPE warning for pipeline output piping"`

### C3: Add task scope guidance (Rec #5)

**Problem**: Group G in Phase 15b completed 2 of 4 tasks without clarity on which were required vs nice-to-have. Agents running low on budget/turns should know which tasks to prioritize.

Add guidance to these files:

**In `docs/multi-agent-guide.md`** — In the section about writing prompt files / agent prompts:
```
### Task Priority Labels
Mark each task in prompt files as **required** or **stretch**:
- **Required**: Must be completed for the group's work to be considered successful.
  The agent should prioritize these and not move to stretch tasks until all required
  tasks are done.
- **Stretch**: Nice-to-have if the agent has remaining budget/turns. The agent can
  skip these if running low on resources without the group being marked as failed.

Example in prompt YAML frontmatter:
  tasks:
    - id: G1
      summary: "Read existing tests"
      priority: required
    - id: G2
      summary: "Add constraint cascade test"
      priority: required
    - id: G3
      summary: "Add conflict cross-tab test"
      priority: stretch
```

**In `.claude/skills/multi-agent-orchestration/SKILL.md`** — Add to the Prompt File Structure section:
```
- Mark tasks as `priority: required` or `priority: stretch` to help agents budget their turns
```

Commit: `"docs: add required vs stretch task priority guidance for agent prompts"`

### C4: Document script changes from Groups A and B

Update documentation to reflect the new features added by Groups A and B.

**In `docs/multi-agent-guide.md`** — Update the Environment Variables section:
- Add `VALIDATE_TIMEOUT=600` — Wall-clock timeout per validation attempt (default 600s / 10min)
- Add `AGENT_STALL_THRESHOLD=300` — Log stall detection threshold for tmux agents (default 300s / 5min)
- Update WASM rebuild description: "WASM is rebuilt only when Rust files changed in the merged branch"

**In `.claude/skills/multi-agent-orchestration/SKILL.md`**:
- Update the Lessons Learned section:
  - Add: `**Validation stall prevention**: WATCH-mode validation now uses pipe mode (`-p`) and has a wall-clock timeout (VALIDATE_TIMEOUT, default 600s). This prevents agents from stalling on background tasks.`
  - Add: `**WASM rebuild optimization**: Merges skip WASM rebuild when no files under `crates/` changed in the merged branch.`
  - Add: `**Log stall detection**: `tmux_wait_stage` monitors log file growth and kills agents whose logs haven't grown for AGENT_STALL_THRESHOLD seconds (default 300s).`

Commit: `"docs: document validation timeout, WASM skip, and stall detection features"`

### C5: Verify consistency

Read through all three modified doc files and verify:
1. No contradictions between docs/multi-agent-guide.md and the SKILL.md files
2. Environment variable names match what the scripts actually use
3. Default values match what the scripts define
4. All new features are documented in at least one place

If any inconsistencies found, fix them.

**Important**: For `.claude/skills/` files, use `git add -f` since the directory is gitignored.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupC saving work"`.
