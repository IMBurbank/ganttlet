---
name: curation
description: "Skill curation process — 5-angle review, scoring, full skill synthesis, debrief reports"
---

# Skill Curation — Review, Score, and Synthesize Better Skills

## Overview

Skills are living documents that teach agents how to work in a domain. Over
time, claims go stale (code changes but the skill doesn't), wrong (an
observation was a symptom not a root cause), redundant (now enforced by a
hook, linter, or test), or verbose (says in 10 lines what could be said in 3).

Research on LLM agent memory shows that indiscriminate storage performs worse
than no memory at all — wrong or stale content actively biases agent behavior
toward incorrect outcomes. Quality gates are essential, not optional.

The curation system reviews entire skill files using 5 parallel reviewer
subagents, independently scores each finding, then the curator produces a
**full synthesis** — a rewritten skill that integrates validated new
observations and removes stale, wrong, or redundant content. The result is
a better skill, not a bigger one.

## How the Curation Pipeline Works

### The Full Flow

```
curate-skills.sh (script, mechanical)
├── Count pending feedback reports
├── launch-phase.sh stage 1
│   └── 8 curators in parallel (one per non-curation skill)
│       ├── 5 Reviewer subagents (sonnet, read-only)
│       ├── N Haiku scorers (one per finding)
│       └── Validation subagents (on-demand)
├── launch-phase.sh merge 1
└── launch-phase.sh validate

Operator/supervisor agent (manually invoked after script completes)
├── Read curator commit messages → extract outcomes
├── Write outcomes into processed reports
├── Create PR (skill-curation label, threshold calibration)
├── Strict code review loop (max 3 iterations)
├── Post final summary
└── Write orchestrator debrief report
```

Note: the curation skill is not in the default `skill-curation.yaml` groups
but can be curated manually or added to the config at any time.

### What Each Component Does

**`curate-skills.sh`** — pipeline runner. Sets a date-stamped merge branch
via `_USER_MERGE_TARGET`, runs launch-phase (stage → merge → validate),
then moves processed feedback reports to `feedback/processed/`. On partial
failure, generates a retry config with only failed groups.

**Curator** (one per skill, `docs/prompts/curation/curator.md`) — the group
agent that orchestrates review of one skill. Reads the entire skill file and
feedback reports, spawns 5 reviewers, collects findings, spawns haiku scorers,
filters at threshold, validates contested findings, then produces a full
rewrite of the skill file. Uses reviewer findings as input but applies its
own judgment — reviewers inform the rewrite, they don't dictate it. Commits
with a detailed message documenting all findings, reasoning, and outcomes.

**Skill reviewer** (`.claude/agents/skill-reviewer.md`) — read-only subagent
spawned by the curator. Reviews the entire skill file from one of 5 angles.
Produces a structured findings report with per-claim classifications and
evidence. Assesses every section equally — no section is special.

**Haiku scorer** — lightweight agent spawned per finding. Independently scores
the finding (0-100) using a rubric and false positive list. Separates advocacy
(reviewers find issues) from validation (scorers verify evidence holds up).

**Validation subagents** — spawned on-demand by the curator when findings are
classified as `wrong` or `suspicious`. Routes to codebase-explorer (structural
questions), rust-scheduler (domain-specific), or verify-and-diagnose (behavioral
questions that need command execution).

## The 5 Reviewer Angles

Each reviewer reads the entire skill file but applies a different lens.

### Accuracy
**Is each claim still true? Is it now encoded in code?**

Reads the source files the skill covers. Checks every claim against current
implementation. The primary angle for catching redundant content — claims
that were true when written but are now enforced by a function, test, or hook.

### Structure
**Is the skill well-organized, appropriately sized, and clearly written?**

Evaluates every section for verbosity, staleness, and organization. Identifies
content that could be compressed and sections that should be reorganized.
Suggests where new observations from feedback reports would best fit.

### Scope
**Does everything here belong here? Is anything duplicated across skills?**

Reads other skills' content. Checks for cross-skill duplication and misplaced
content. Determines the canonical location for each piece of knowledge.
Checks that removals or additions won't leave this skill or another incomplete.

### History
**When was this written and has the world changed since?**

Uses git blame and git log to understand provenance. Checks whether referenced
code has changed since the content was written. Catches content added during
rushed debugging that may describe symptoms rather than root causes.

### Adversarial
**Assume every claim is wrong. Try to disprove it.**

The highest-value angle. Wrong content causes "misaligned experience replay":
an agent reads a claim that looks relevant, follows it, and produces wrong
code. The key test: "if an agent reads this and follows it, will the outcome
be correct?" Has a unique `suspicious` classification for weak causal reasoning.

## Scoring

Three-layer validation, adapted from the code-review plugin:

1. **Reviewers produce findings** with evidence and evidence levels
   (test > source > git > reasoning)
2. **Haiku scorers validate** each finding independently (0-100 scale)
3. **Filter at threshold** — only findings scoring at or above survive

**Threshold:** stored in `docs/prompts/curation/threshold.txt` (initial: 70,
calibrated per pass). The curator's debrief includes threshold calibration
data. The user adjusts the threshold; it never changes automatically.

**Rubric** (0/25/50/75/100 scale) and **false positive list** are in the
curator prompt (step 3) and given to scorers verbatim.

## Debrief Reports

Implementing agents write structured debrief reports instead of editing
skill files directly. Reports accumulate in `docs/prompts/curation/feedback/`
and are processed by the curation pipeline.

**Template:** `docs/prompts/curation/debrief-template.md` — agents are
directed here by the `full-verify.sh` hook when no debrief is found.

**Schema:** YAML frontmatter (date, agent, task, commits) + observations
list. Each observation has: type, summary, evidence, files.

**Filename:** generated via `$(date +%Y-%m-%d)-$(git branch --show-current | tr '/' '-').md`

**Observation types:** `undocumented_behavior`, `wrong_documentation`,
`unexpected_result`, `workflow_gap`, `nothing_to_report`, `threshold_calibration`.

**Lifecycle:** feedback/ → curator reads directly (oldest 20) → 5 reviewers
assess entire skill + reports → haiku scorers validate findings → curator
synthesizes rewritten skill file → script moves reports to feedback/processed/
→ orchestrator writes outcomes. Reports in processed/ preserved permanently.

Curators also report issues they find in CLAUDE.md files, subagent definitions,
or other instruction context as `wrong_documentation` observations. These are
preserved in `processed/` for future instruction curation scope.

## How to Run Curation

**Automated (full pipeline):**
```bash
./scripts/curate-skills.sh
# Then agent creates PR and handles code review
```

**Manual (one skill at a time):**
Tell an agent: "Read docs/prompts/curation/curator.md and follow its
instructions. Your target skill is: scheduling-engine"

Same 5 reviewers, same scoring. No launch-phase infrastructure needed.
Useful for testing prompts, initial cleanup, or ad-hoc review.

## Code Review Protocol

Stricter than normal code PRs — curation changes instruction content that
affects all future agent behavior.

- All findings scoring ≥threshold must be addressed
- Max 3 review iterations
- Full findings posted every round (no summarization)
- Final summary always posted (clean or max iterations)
- If max iterations reached: `needs-human-review` label
- Human takes over for supervised continuation if needed

**Curation review checklist:**
1. Cross-skill consistency (removed from A, duplicate still in B?)
2. Evidence quality (every change cites source/test/commit)
3. Rewritten content accuracy (matches the domain, readable, complete)
4. Net token impact (negative or neutral)
5. No information loss (non-obvious knowledge preserved, not just deleted)
6. Wrong classifications verified correct

## Partial Failure Recovery

If some curators fail during the stage, `curate-skills.sh` generates a
retry config (`/tmp/skill-curation-retry-*.yaml`) with only the failed
groups. Agent diagnoses via `launch-phase.sh ... status`, reads log files,
fixes the issue, retries with the retry config. Merge uses the original
config to merge all branches (original successes + retry successes).

## File Layout

```
docs/prompts/curation/
├── curator.md               # Curator prompt (one per skill, shared template)
├── orchestrator.md          # Orchestrator prompt (pipeline, PR, code review)
├── {skill-name}.md          # Thin wrappers (one per skill, point to curator)
├── debrief-template.md      # Template for agent debrief reports
├── validate.md              # Post-merge validation prompt
├── skill-curation.yaml      # Launch config (8 groups, reusable)
├── threshold.txt            # Scoring threshold (initial: 70)
└── feedback/                # Debrief reports accumulate here
    └── processed/           # Processed reports (outcomes in git history)

.claude/agents/
└── skill-reviewer.md        # Reviewer subagent definition (shared by all 5 angles)

scripts/
├── curate-skills.sh         # Pipeline runner
├── check-curation.sh        # Reminder hook (count + age thresholds)
└── generate-retry-config.sh # Partial failure recovery
```
