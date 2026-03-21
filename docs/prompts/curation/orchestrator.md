---
description: "Skill curation orchestrator — multi-agent workflow for curating skills"
skills: ["multi-agent-orchestration"]
skip-plan-mode: true
---

# Curation Orchestrator

You are a multi-agent orchestrator. **Before doing anything else**, read
`.claude/skills/multi-agent-orchestration/SKILL.md` — it defines
launch-phase.sh, WATCH mode, tmux monitoring (`tmux capture-pane`,
`tmux_poll_agent`, `tmux_agent_status`), and failure handling. You must
know this skill thoroughly to orchestrate agents.

This prompt defines the curation-specific workflow on top of that skill.

Do NOT enter plan mode. Do NOT ask for confirmation.

## Everything is relative to your worktree

Your worktree is your working environment. All commands, all file edits,
all git operations happen here. Curator agents branch from your worktree's
HEAD — they inherit your changes (settings, prompts, configs, guard binary).

- Never `cd` to `/workspace`. Never chain `cd &&`.
- Use `git -C /workspace` if you need to inspect main without leaving.
- `launch-phase.sh` captures your HEAD at launch time so `setup_merge_target()`
  branches from it automatically. No manual branch management needed.

## Setup

1. Enter a worktree. All orchestrator work happens in an isolated worktree.

2. Select or create the YAML config:
   - **Full pipeline**: use `docs/prompts/curation/skill-curation.yaml`
   - **Subset of skills**: create a config with only the target groups:
     ```yaml
     phase: skill-curation
     merge_target: curation/run

     stages:
       - name: "Skill curation"
         groups:
           - id: curation
             branch: curation/curation
             merge_message: "docs: curation skill"
     ```

3. Commit all changes before running. The preflight check rejects dirty state,
   and curator agents only see committed content on the merge target branch.

## Stage: Run Curators

Run stage commands in the background. Do NOT block on them — you need to
stay responsive to the user and monitor progress.

**Full pipeline:**
```bash
./scripts/curate-skills.sh
```

**Subset or manual run:**
```bash
export _USER_MERGE_TARGET="curation/$(date +%Y-%m-%d)-$(python3 -c 'import os; print(os.urandom(4).hex())')"
WATCH=1 ./scripts/launch-phase.sh <config> stage 1
```

Then merge and validate after the stage completes:
```bash
./scripts/launch-phase.sh <config> merge 1
./scripts/launch-phase.sh <config> validate
```

### Monitoring

You are a multi-agent orchestrator. Do NOT block on commands or wait
silently. Run stage commands in the background, then monitor actively
using tmux (your primary observation tool):

```bash
# See what the agent is doing RIGHT NOW
tmux capture-pane -t <session>:<group> -p | tail -20

# Check agent status
tmux_agent_status <session> <group> <log_file>

# Poll agent log
tmux_poll_log /tmp/ganttlet-logs/<phase>/<group>.log 20
```

- Check every 2-3 minutes. Never sleep or wait — poll and respond.
- Report status to the user at milestones (reviewers spawned, scoring,
  rewrite in progress, committed).
- If an agent stalls on a permission dialog or error, diagnose and fix
  immediately — don't wait for the idle monitor.

### Partial Failure Recovery

If some curators fail, `curate-skills.sh` generates a retry config
(`/tmp/skill-curation-retry-*.yaml`) with only the failed groups.

```bash
./scripts/launch-phase.sh <config> status              # diagnose
./scripts/launch-phase.sh <config> logs <failed-group>  # read logs
./scripts/launch-phase.sh <retry-config> stage 1        # retry failed
./scripts/launch-phase.sh <original-config> merge 1     # merge all
./scripts/launch-phase.sh <original-config> validate
```

## Post-Curation

After all curators complete and branches are merged, read
`.claude/skills/curation/SKILL.md` — it defines the 5 reviewer angles,
scoring model, and debrief lifecycle you need to interpret curator outputs.

### Read Curator Outputs

```bash
git log --format="%H %s" origin/main..HEAD -- .claude/skills/
```

For each curator commit, read the full message (`git log -1 --format="%B" {sha}`)
and extract:
- Reviewer Findings Summary (per angle)
- Scoring data (threshold, counts)
- Changes Made (what was removed/rewritten/integrated)
- Not Acted On (what was skipped and why)
- Cross-Skill Notes (duplication, conflicts)
- Feedback Report Outcomes (acted/rejected/preserved)

### Write Outcomes into Processed Reports

For each processed feedback report in `docs/prompts/curation/feedback/processed/`,
add an `outcome` field to each observation based on the curator commit messages:

```yaml
observations:
  - type: undocumented_behavior
    summary: "..."
    evidence: "..."
    files: [...]
    outcome:
      status: acted    # acted | rejected | preserved
      action: "integrated into scheduling-engine Gotchas section"
      pass: "2026-03-20"
```

```bash
git add docs/prompts/curation/feedback/processed/
git commit -m "docs: write curation outcomes into processed reports"
```

### Rebase and Verify

```bash
git fetch origin
git rebase origin/main
./scripts/full-verify.sh
```

## PR and Code Review

### Create PR

```bash
gh pr create --title "docs: skill curation pass" --body "$(cat <<'EOF'
## Summary
- Curated N skills
- Processed M feedback reports
- Net token delta: {+/-N tokens}

## Per-Skill Changes
### scheduling-engine
- {what changed, from curator commit message}

### hooks
- {what changed}

...

## Threshold Calibration
Current threshold: {value}

| Skill | Below-threshold real issues | Above-threshold false positives | Recommendation |
|---|---|---|---|
| scheduling-engine | {data from curator debrief} | ... | ... |

## Reviewer Findings Not Acted On
- {aggregated from all curator commits}

EOF
)"
```

### Code Review Loop

Curation PRs are stricter than normal — changes affect all future agent behavior.

1. Run the code-review plugin (`/code-review:code-review`) on the PR
2. All findings scoring ≥threshold must be addressed
3. Fix findings, commit, push, re-run review
4. Max 3 iterations
5. Post full findings every round (no summarization)

**Curation review checklist:**
1. Cross-skill consistency (removed from A, duplicate still in B?)
2. Evidence quality (every change cites source/test/commit)
3. Rewritten content accuracy (matches the domain, readable, complete)
4. Net token impact (negative or neutral)
5. No information loss (non-obvious knowledge preserved, not just deleted)
6. Wrong classifications verified correct

**Final summary (always posted, whether clean or max iterations):**

```
### Curation review — final summary

**Status:** [CLEAN after N iterations | MAX ITERATIONS REACHED (3/3)]
**Scoring threshold:** {value}
**Merge readiness:** [Ready | Needs human review]

All findings across all iterations:
| # | Finding | Score | Status | Iteration |
|---|---------|-------|--------|-----------|
| 1 | ... | 85 | Fixed (iteration 1) | 1 |

Unresolved findings (if any):
- {full detail}
```

If max iterations reached, label PR `needs-human-review`.

## Orchestrator Debrief

Write your own debrief to `docs/prompts/curation/feedback/`:
- Cross-skill observations (patterns across curators)
- Threshold calibration recommendation (aggregated from curator debriefs)
- Code review findings and what they revealed about curation quality
- Fixes made during the review loop
- Process observations (curator failures, timing, issues)

Use filename: `{date}-orchestrator-{hash}.md`

```bash
git add docs/prompts/curation/feedback/
git commit -m "docs: orchestrator debrief for curation pass"
```

Post a summary comment on the PR and inform the user that it's ready for
human review (or that it needs supervised continuation if max iterations
were reached).
