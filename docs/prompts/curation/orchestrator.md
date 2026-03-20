---
description: "Skill curation orchestrator — runs pipeline, creates PR, handles code review loop"
skip-plan-mode: true
---

# Curation Orchestrator

You orchestrate a skill curation pass for the Ganttlet project. Read
`.claude/skills/curation/SKILL.md` for full context on the curation system.

Do NOT enter plan mode. Do NOT ask for confirmation.

## Step 1: Run the Pipeline

```bash
./scripts/curate-skills.sh
```

This runs launch-phase (stage → merge → validate) and moves processed
reports. If it fails, follow the diagnostic output — it tells you what
commands to run.

For manual curation (single skill), skip this step. Instead, invoke one
curator directly: "Read docs/prompts/curation/curator.md and follow its
instructions. Your target skill is: {skill}"

## Step 2: Read Curator Outputs

After the pipeline (or manual curator) completes, read the curator commit
messages from the merge branch:

```bash
git log --format="%H %s" origin/main..HEAD -- .claude/skills/
```

For each curator commit, read the full message:
```bash
git log -1 --format="%B" {sha}
```

Extract from each commit message:
- Reviewer Findings Summary (per angle)
- Scoring data (threshold, counts)
- Changes Made (what was removed/rewritten/integrated)
- Not Acted On (what was skipped and why)
- Cross-Skill Notes (duplication, conflicts)
- Feedback Report Outcomes (acted/rejected/preserved)

## Step 3: Write Outcomes into Processed Reports

For each feedback report that was processed, read it from
`docs/prompts/curation/feedback/processed/` and add an `outcome` field
to each observation based on the curator commit messages:

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

Commit the updated reports:
```bash
git add docs/prompts/curation/feedback/processed/
git commit -m "docs: write curation outcomes into processed reports"
```

## Step 4: Rebase and Verify

```bash
git fetch origin && git rebase origin/main
./scripts/full-verify.sh
```

If rebase has conflicts, resolve them and re-verify.

## Step 5: Create PR

Create the PR with a detailed body including:

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

## Step 6: Code Review Loop

Run strict code review with the curation checklist:

1. Run `/code-review` on the PR
2. All findings scoring ≥threshold must be addressed
3. Fix findings, commit, push, re-run review
4. Max 3 iterations
5. Post full findings every round (no summarization)

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

## Step 7: Write Orchestrator Debrief

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

## Step 8: Inform User

Post a summary comment on the PR and inform the user that it's ready
for human review (or that it needs supervised continuation if max
iterations were reached).
