---
phase: 19
group: B
stage: 1
agent_count: 1
scope:
  create:
    - docs/prompts/curation/reviewer-template.md
  modify:
    - docs/prompts/curation/curator.md
    - docs/prompts/curation/skill-curation.yaml
    - .claude/skills/curation/SKILL.md
  read_only:
    - .claude/agents/skill-reviewer.md
    - docs/plans/sdk-agent-runner.md
    - docs/prompts/curation/threshold.txt
depends_on: []
tasks:
  - id: B1
    summary: "Read current curator.md, skill-curation.yaml, curation SKILL.md"
  - id: B2
    summary: "Create reviewer-template.md with {SKILL} and {ANGLE} placeholders"
  - id: B3
    summary: "Update skill-curation.yaml to two stages — 40 reviewers + 8 curators"
  - id: B4
    summary: "Simplify curator.md — remove reviewer spawning, read from disk"
  - id: B5
    summary: "Update curation SKILL.md — two-stage pipeline flow"
---

# Phase 19 Group B — Curation Pipeline Restructure

You are implementing Phase 19 Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context.
Read `docs/plans/sdk-agent-runner.md` Step 10 for the detailed design.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Worktree Rules (Non-Negotiable)

You are working in a **git worktree** — NOT in `/workspace`.
All file paths below are **relative to your worktree root** (your CWD).
**NEVER** modify, read from, or `cd` into `/workspace` — that is `main` and must not be touched.
All git operations (commit, push) happen in this worktree directory.

## Context

The curation pipeline currently spawns 5 reviewer subagents from within the curator prompt
via the Agent tool. This means the orchestration layer can't apply per-reviewer policies or
track metrics. This group restructures the pipeline: reviewers become first-class agents
launched by `launch-phase.sh` (Stage 1), and curators read their output from disk (Stage 2).

Group A (parallel) builds the SDK runner TypeScript code. Group C (parallel) updates
orchestration docs. Group D (Stage 2) integrates the runner into `agent.sh`.

## Your files (ONLY create/modify these):

**Create:**
- `docs/prompts/curation/reviewer-template.md` — Task prompt for reviewer agents

**Modify:**
- `docs/prompts/curation/curator.md` — Remove reviewer spawning, add disk-read step
- `docs/prompts/curation/skill-curation.yaml` — Two-stage config
- `.claude/skills/curation/SKILL.md` — Update pipeline description

**Read-only:**
- `.claude/agents/skill-reviewer.md` — Agent definition (instructions, output format)
- `docs/plans/sdk-agent-runner.md` — Design spec (Step 10)
- `docs/prompts/curation/threshold.txt` — Scoring threshold

## Success Criteria (you're done when ALL of these are true):

1. `reviewer-template.md` exists with only `{SKILL}` and `{ANGLE}` placeholders
2. `yq '.stages | length' docs/prompts/curation/skill-curation.yaml` → 2
3. Stage 1 has 40 groups (8 skills × 5 angles), stage 2 has 8 groups
4. Each stage-1 group ID matches `^.+-(accuracy|structure|scope|history|adversarial)$`
5. Each stage-1 branch is unique
6. Curator prompt no longer references Agent tool for spawning reviewers
7. Curator prompt reads from `{LOG_DIR}/reviews/{SKILL}/`
8. Curation SKILL.md describes the two-stage architecture
9. All changes committed with conventional commits

## Tasks — execute in order:

### B1: Read and understand the current system

1. Read `docs/prompts/curation/curator.md` — understand Steps 1-7, especially Step 2 (spawn reviewers) and Step 2b (synthesis)
2. Read `docs/prompts/curation/skill-curation.yaml` — understand current single-stage config
3. Read `.claude/skills/curation/SKILL.md` — understand pipeline flow diagram
4. Read `.claude/agents/skill-reviewer.md` — understand reviewer instructions, output format, tools

### B2: Create reviewer-template.md (Plan Step 10a)

Create `docs/prompts/curation/reviewer-template.md`:

```markdown
---
description: "Skill reviewer — {ANGLE} angle for {SKILL}"
skip-plan-mode: true
---

Review angle: {ANGLE}

Target skill: .claude/skills/{SKILL}/SKILL.md

Feedback reports:
Run `find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" | sort | head -20`

Other skills (for cross-skill context):
Run `ls .claude/skills/*/SKILL.md`
```

That's the entire file. Only `{SKILL}` and `{ANGLE}` need prompt-var substitution — feedback
and other-skills paths are discovered at runtime by the reviewer agent executing bash commands.
The agent definition (`.claude/agents/skill-reviewer.md`) provides detailed instructions.

Commit: `feat: add reviewer prompt template for curation pipeline`

### B3: Update skill-curation.yaml (Plan Step 10b)

Replace the current single-stage config with a two-stage layout:

**Stage 1: Review** — 40 groups (8 skills × 5 angles). Each gets a unique branch:
```yaml
- id: scheduling-engine-accuracy
  branch: curation/scheduling-engine-accuracy
- id: scheduling-engine-structure
  branch: curation/scheduling-engine-structure
# ... etc for all 8 skills × 5 angles
```

The 8 skills: `scheduling-engine`, `hooks`, `multi-agent-orchestration`, `e2e-testing`,
`shell-scripting`, `issue-workflow`, `cloud-deployment`, `google-sheets-sync`.

The 5 angles: `accuracy`, `structure`, `scope`, `history`, `adversarial`.

**Stage 2: Curate** — 8 groups (one per skill):
```yaml
- id: scheduling-engine
  branch: curation/scheduling-engine
  merge_message: "docs: curate scheduling-engine skill"
# ... etc for all 8 skills
```

See plan Step 10b for the complete YAML.

Commit: `feat: restructure curation YAML to two-stage pipeline`

### B4: Simplify curator.md (Plan Step 10c)

Update `docs/prompts/curation/curator.md`:

- **Remove** Step 2 (spawn 5 reviewers via Agent tool)
- **Remove** Step 2b (report synthesis pass)
- **Remove** orphaned reviewer-context text from Step 2 ("For the scope reviewer, list other skill paths")
- **Add** new Step 1 that reads reviewer reports from disk:

```markdown
## Step 1: Context

**Reviewer reports** (produced by the review stage — do NOT spawn reviewers):
\`\`\`bash
ls {LOG_DIR}/reviews/{SKILL}/
\`\`\`

Read all 5 reviewer reports. If any report file is missing, note it in your
debrief and proceed with the reports you have.
```

- Renumber remaining steps (Score→2, Filter→3, Rewrite→4, Commit→5, Debrief→6)
- Curators still use Agent tool for **scorers** (haiku) and **validators** (codebase-explorer, etc.)
- Add note about non-SDK path tradeoff (see plan Step 10c)

Commit: `feat: curator reads reviewer reports from disk`

### B5: Update curation SKILL.md (Plan Step 10e)

Update `.claude/skills/curation/SKILL.md`:

1. **Pipeline flow**: Change from `Orchestrator → curators → 5 skill-review subagents`
   to `Orchestrator → Stage 1: 40 reviewers (SDK runner) → Stage 2: 8 curators (read from disk)`
2. **Reviewer execution**: "Reviewers are first-class agents launched by `launch-phase.sh`
   stage 1 via the SDK runner with `--policy reviewer` and `--agent skill-reviewer`"
3. **3-attempt fallback**: Describe sonnet 30 turns → resume wrap-up 5 turns → haiku synthesize
4. **Curator changes**: Reads from `{LOG_DIR}/reviews/{SKILL}/`, no Agent tool for reviewers
5. **File layout**: Add `reviewer-template.md`

Keep edits surgical — don't rewrite unrelated sections.

Commit: `docs: update curation skill for two-stage reviewer pipeline`

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches)
- Level 2: Commit WIP, move to next task
- Level 3: Commit, mark blocked
- Emergency: `git add docs/prompts/curation/ .claude/skills/curation/ && git commit -m "emergency: groupB saving work"`
- **Calculations**: NEVER do mental math — use `python3 -c` for arithmetic
