---
phase: 19
group: C
stage: 1
agent_count: 1
scope:
  modify:
    - docs/multi-agent-guide.md
    - .claude/skills/multi-agent-orchestration/SKILL.md
    - scripts/lib/config.sh
    - scripts/generate-retry-config.sh
  read_only:
    - scripts/lib/agent.sh
    - docs/plans/sdk-agent-runner.md
depends_on: []
tasks:
  - id: C1
    summary: "Read current docs and config files"
  - id: C2
    summary: "Add SDK Agent Runner section to multi-agent-guide.md"
  - id: C3
    summary: "Add SDK runner subsection to orchestration SKILL.md"
  - id: C4
    summary: "Add LOG_DIR env var override to config.sh"
  - id: C5
    summary: "Add LOG_DIR override + echo to generate-retry-config.sh"
---

# Phase 19 Group C — Orchestration Docs + Config

You are implementing Phase 19 Group C for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/sdk-agent-runner.md` Steps 9b and 9c for the detailed design.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Context

Phase 19 adds a TypeScript SDK agent runner (Group A, parallel) and restructures the curation
pipeline (Group B, parallel). This group updates the orchestration documentation so agents
reading these docs mid-pipeline see accurate information, and adds a LOG_DIR env var override
so curation reruns can target the same output directory as the original run.

## Your files (ONLY modify these):

- `docs/multi-agent-guide.md` — Add SDK runner section
- `.claude/skills/multi-agent-orchestration/SKILL.md` — Add SDK runner subsection
- `scripts/lib/config.sh` — LOG_DIR override (1 line + comment update)
- `scripts/generate-retry-config.sh` — LOG_DIR override + echo (2 lines)

**Read-only:**
- `scripts/lib/agent.sh` — Understand how `run_agent()` currently works
- `docs/plans/sdk-agent-runner.md` — Design spec

## Success Criteria:

1. `docs/multi-agent-guide.md` contains "SDK Agent Runner" section
2. `.claude/skills/multi-agent-orchestration/SKILL.md` references SDK runner
3. `LOG_DIR=/tmp/test source scripts/lib/config.sh` → `echo $LOG_DIR` = `/tmp/test`
4. Without LOG_DIR set, config.sh derives as before
5. `bash -n scripts/lib/config.sh` passes
6. `bash -n scripts/generate-retry-config.sh` passes
7. All changes committed

## Tasks — execute in order:

### C1: Read current files

1. Read `docs/multi-agent-guide.md` — find where to add the SDK runner section (after "Claude CLI Reference")
2. Read `.claude/skills/multi-agent-orchestration/SKILL.md` — find the agent execution section
3. Read `scripts/lib/config.sh` — find LOG_DIR assignment (line 87)
4. Read `scripts/generate-retry-config.sh` — find LOG_DIR assignment (line 20)
5. Read `scripts/lib/agent.sh` — understand `run_agent()` structure

### C2: Add SDK Agent Runner section to multi-agent-guide.md (Plan Step 9c)

Add after the "Claude CLI Reference" section:

```markdown
## SDK Agent Runner

When `SDK_RUNNER=1` is set, `run_agent()` uses the TypeScript SDK runner
(`scripts/sdk/agent-runner.ts`) instead of `claude -p`. The runner provides:

- **Policy-based attempt fallback**: Configurable via `--policy`. The
  `reviewer` policy has 3 attempts (sonnet 30 turns → resume 5 turns →
  haiku fresh 5 turns). The `default` policy is single-attempt.
- **Output validation**: Policies can define `isValid()` checks. Invalid
  output triggers a fix attempt (resume with correction prompt) before
  advancing to the next attempt.
- **Cumulative budget tracking**: `--max-budget` is shared across all
  attempts. The runner tracks spend and passes remaining budget to each call.
- **Structured metrics**: JSONL with attempt count, failure mode, cost,
  session ID, policy name.

### CLI flags

`--group`, `--workdir`, `--prompt`, `--log`, `--phase` (required).
`--policy`, `--max-turns`, `--max-budget`, `--model`, `--agent`,
`--output-file`, `--prompt-var KEY=VALUE` (optional).

### Naming convention

Group IDs ending in a reviewer angle (`-accuracy`, `-structure`, `-scope`,
`-history`, `-adversarial`) automatically set `--policy reviewer`,
`--agent skill-reviewer`, and `--output-file` to the correct path. No
YAML changes needed — detection is in `run_agent()`.

### Existing `claude -p` path

Unchanged. When `SDK_RUNNER` is unset, `run_agent()` uses the existing
bash retry loop with `claude -p`. Both code paths coexist.
```

Commit: `docs: add SDK runner section to multi-agent guide`

### C3: Add SDK runner subsection to orchestration SKILL.md

Add an "SDK Agent Runner" subsection under the agent execution section. Keep it concise —
reference `docs/multi-agent-guide.md` for full details. Cover:
- `SDK_RUNNER=1` env var enables the TypeScript path
- Policy registry: `default` (single attempt) and `reviewer` (3-attempt fallback)
- Naming convention for reviewer angle detection
- `--agent` flag loads `.claude/agents/*.md` via `settingSources: ['project']`
- How it differs from `claude -p`: programmatic permissions, attempt-based fallback

Commit: `docs: add SDK runner to orchestration skill`

### C4: LOG_DIR env var override in config.sh (Plan Step 9b)

Change config.sh line 86-87 from:
```bash
# Derived values — run_suffix is stable across stage/merge/validate invocations
LOG_DIR="/tmp/ganttlet-logs/${PHASE}-${run_suffix}"
```
to:
```bash
# Derived values — run_suffix is stable across stage/merge/validate invocations.
# LOG_DIR respects env override for cross-run output sharing (see Step 9b).
LOG_DIR="${LOG_DIR:-/tmp/ganttlet-logs/${PHASE}-${run_suffix}}"
```

Verify: `bash -n scripts/lib/config.sh` passes.

Commit: `feat: allow LOG_DIR override for cross-run output sharing`

### C5: LOG_DIR override in generate-retry-config.sh

Change line 20 from:
```bash
LOG_DIR="/tmp/ganttlet-logs/${PHASE}-${run_suffix}"
```
to:
```bash
LOG_DIR="${LOG_DIR:-/tmp/ganttlet-logs/${PHASE}-${run_suffix}}"
```

Also add a line after the retry config is written:
```bash
echo "[retry] Original LOG_DIR: $LOG_DIR"
```

Verify: `bash -n scripts/generate-retry-config.sh` passes.

Commit: `feat: generate-retry-config prints LOG_DIR for rerun convenience`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- Emergency: `git add docs/multi-agent-guide.md .claude/skills/multi-agent-orchestration/ scripts/lib/config.sh scripts/generate-retry-config.sh && git commit -m "emergency: groupC saving work"`
- **Calculations**: NEVER do mental math — use `python3 -c` for arithmetic
