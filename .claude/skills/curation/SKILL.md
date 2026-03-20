---
name: curation
description: "Skill curation process — reviewer angles, scoring, debrief reports, prompt maintenance"
---

# Skill Curation — Review, Score, and Maintain Instruction Quality

## Overview

Skill files accumulate content over time — Lessons Learned entries from agent
work, feedback observations promoted by the curation pipeline, and manual edits.
Without periodic review, entries go stale (code changes but docs don't), wrong
(the original observation was a symptom not a root cause), or redundant (now
enforced by a hook, linter, or test). Research on LLM agent memory shows that
indiscriminate storage performs worse than no memory at all — wrong or stale
entries actively bias agent behavior toward incorrect outcomes. Quality gates
on what enters skill files are essential, not optional.

The curation system reviews every skill using 5 parallel reviewer subagents,
independently scores each finding, and applies validated changes. It runs as
a standard `launch-phase.sh` pipeline with one stage (all skills in parallel),
followed by a merge, validation, and code review loop.

## How the Curation Pipeline Works

### The Full Flow

```
curate-skills.sh (script, mechanical)
├── Count pending feedback reports
├── launch-phase.sh stage 1
│   └── 8 curators in parallel (one per skill)
│       ├── 5 Reviewer subagents (sonnet, read-only)
│       ├── N Haiku scorers (one per finding)
│       └── Validation subagents (on-demand)
├── launch-phase.sh merge 1
└── launch-phase.sh validate

Orchestrating agent (judgment)
├── Read curator commit messages → extract outcomes
├── Write outcomes into processed reports
├── Create PR (skill-curation label, threshold calibration)
├── Strict code review loop (max 3 iterations)
├── Post final summary
└── Write orchestrator debrief report
```

### What Each Component Does

**`curate-skills.sh`** — prep script. Selects the oldest 20 feedback reports,
sets a date-stamped merge branch via `_USER_MERGE_TARGET`, and runs the
launch-phase pipeline steps. After the pipeline, moves processed reports
to `feedback/processed/`. On partial
failure, generates a retry config with only failed groups.

**Curator** (one per skill, `docs/prompts/curation/curator.md`) —
the group agent that orchestrates review of one skill. Reads the skill file
and feedback reports, spawns 5 reviewers, collects findings, spawns haiku
scorers, filters at threshold, validates contested findings, edits the skill
file, and commits with structured outcome data.

**Skill reviewer** (`.claude/agents/skill-reviewer.md`) — read-only subagent
spawned by the curator. Reviews from one of 5 angles. Produces a
structured findings report with per-entry classifications and evidence.

**Haiku scorer** — lightweight agent spawned per finding. Independently scores
the finding (0-100) using a rubric and false positive list. Separates advocacy
(reviewers find issues) from validation (scorers verify evidence holds up).

**Validation subagents** — spawned on-demand by the curator when findings
are classified as `wrong` or `suspicious`. Routes to codebase-explorer
(structural questions), rust-scheduler (domain-specific), or verify-and-diagnose
(behavioral questions that need command execution).

## The 5 Reviewer Angles

Each reviewer gets the same skill context but a different lens. This mirrors
the code-review plugin's 5 parallel agents, each checking a different aspect.

### Accuracy
**Is each entry still true? Is it now encoded in code?**

Reads the source files the skill covers. Checks each LL entry and skill body
claim against current implementation. The primary angle for catching redundant
lessons — entries that were true when written but are now enforced by a
function, test, hook, or lint.

### Structure
**Is the skill well-organized? Should entries be promoted?**

Evaluates skill body quality: section organization, verbosity, staleness.
Identifies LL entries important enough to live permanently in the skill body
(Gotchas, Architecture, Patterns sections). Drafts promoted text.

### Scope
**Does this belong here or in a different skill?**

Reads all skills' LL sections. Checks for cross-skill duplication and
misplaced content. Determines the canonical location for each piece of
knowledge. Flags entries that reference files owned by a different skill.

### History
**When was this written and has the world changed since?**

Uses git blame and git log to understand provenance. Checks whether referenced
code has changed since the entry was added. Catches entries added during rushed
debugging that may describe symptoms rather than root causes.

### Adversarial
**Assume every entry is wrong. Try to disprove it.**

The highest-value angle. Wrong entries don't just waste tokens — they cause
"misaligned experience replay": an agent reads an entry that looks relevant
to its task, follows its advice, and produces wrong code. The key test is:
"if an agent working on this task reads this entry and follows it, will the
outcome be correct?" Reads source and tests to find contradictions. Has a
unique `suspicious` classification for entries with weak causal reasoning.

## Scoring

Three-layer validation, adapted from the code-review plugin:

1. **Reviewers produce findings** with evidence and evidence levels
   (test > source > git > reasoning)
2. **Haiku scorers validate** each finding independently (0-100 scale)
3. **Filter at threshold** — only findings scoring at or above survive

**Threshold:** stored in `docs/prompts/curation/threshold.txt` (initial: 70, calibrated per pass).
Calibrated after each pass using data from the curator's debrief report.
The user adjusts the threshold; it never changes automatically.

**Rubric** (0/25/50/75/100 scale) and **false positive list** are embedded
in the curator prompt (step 4) and given to scorers verbatim.

## Debrief Reports

Implementing agents write structured debrief reports instead of appending
directly to skill LL sections. Reports accumulate in
`docs/prompts/curation/feedback/` and are processed by the curation pipeline.

**Template:** `docs/prompts/curation/debrief-template.md` — agents are
directed here by the `full-verify.sh` hook when no debrief is found.

**Schema:** YAML frontmatter (date, agent, task, commits) + observations
list. Each observation has: type, summary, evidence, files.

**Filename convention:** `YYYY-MM-DD-{branch-name}.md` — date prefix is
required for oldest-first batch selection.

**Observation types:** `undocumented_behavior`, `wrong_documentation`,
`unexpected_result`, `workflow_gap`, `nothing_to_report`.

**Lifecycle:** feedback/ → curator reads directly (oldest 20) →
5 reviewers assess skill + reports → haiku scorers validate findings →
curator synthesizes a rewritten skill file (not append — full rewrite) →
script moves reports to feedback/processed/ → orchestrator writes outcomes.
Reports in processed/ are preserved permanently.

## How to Run Curation

**Automated (full pipeline):**
```bash
./scripts/curate-skills.sh
# Then agent creates PR and handles code review
```

**Manual (one skill at a time):**
Tell an agent to read `docs/prompts/curation/curator.md` and follow its
instructions, with the target skill specified in your prompt:
"Read docs/prompts/curation/curator.md and follow its instructions.
Your target skill is: scheduling-engine"

Same 5 reviewers, same scoring. No launch-phase infrastructure needed.
Useful for:
- Testing/refining prompts before automated runs
- Initial LL cleanup on a specific skill
- Reviewing a skill outside the regular cadence

## Code Review Protocol for Curation PRs

Stricter than normal code PRs because curation changes instruction content
that affects all future agent behavior.

- All findings scoring ≥threshold must be addressed
- Max 3 review iterations
- Agent posts full findings every round (no summarization)
- Final summary always posted (clean exit or max iterations)
- If max iterations reached: `needs-human-review` label with full
  remaining findings listed
- Human takes over for supervised continuation if needed

**Curation review checklist** (appended for `skill-curation` label):
1. Cross-skill consistency (deleted from A, duplicate still in B?)
2. Evidence quality (every deletion cites source/test/commit)
3. Promoted content accuracy (matches the lesson, fits target section)
4. Net token impact (negative or neutral)
5. No information loss (non-obvious behavior promoted, not deleted)
6. Wrong classifications verified correct

## Partial Failure Recovery

If some curators fail during the stage:
1. `curate-skills.sh` generates `/tmp/skill-curation-retry.yaml` with
   only the failed groups
2. Agent diagnoses with `launch-phase.sh ... logs`
3. Agent fixes the issue and retries with the retry config
4. Merge uses the original config (merges ALL branches — original
   successes + retry successes)

## File Layout

```
docs/prompts/curation/
├── curator.md          # Main curator prompt (shared by all skills)
├── {skill-name}.md          # Thin wrappers (one per skill, point to curator)
├── debrief-template.md      # Template for agent debrief reports
├── validate.md              # Post-merge validation prompt
├── skill-curation.yaml      # Launch config (8 groups, reusable)
├── threshold.txt            # Scoring threshold (initial: 70, calibrated per pass)
├── metrics.csv              # Per-pass metrics (appended by orchestrator)
└── feedback/                # Debrief reports accumulate here
    └── processed/           # Processed reports with outcomes in git history

.claude/agents/
└── skill-reviewer.md        # Reviewer subagent definition (shared by all 5 angles)

scripts/
├── curate-skills.sh         # Pipeline runner (stage, merge, validate, report movement)
├── check-curation.sh        # Reminder hook (count + age thresholds)
└── generate-retry-config.sh # Partial failure recovery
```

## Gotchas
<!-- populated from curation pass experience -->
