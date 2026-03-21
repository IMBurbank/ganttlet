---
name: curation
description: "Skill curation process — 5-angle review, scoring, full skill synthesis, debrief reports. Used by curator agents."
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

The curation system reviews entire skill files using 5 parallel skill-review
subagents, independently scores each finding, then the curator produces a
**full synthesis** — a rewritten skill that integrates validated new
observations and removes stale, wrong, or redundant content. The result is
a better skill, not a bigger one.

## How the Curation Pipeline Works

### The Full Flow

```
Orchestrator (orchestrator.md)
├── Enter worktree
├── Run curate-skills.sh or launch-phase.sh with subset config
│   ├── curate-skills.sh early-exit if no pending reports
│   ├── launch-phase.sh stage 1
│   │   └── N curators in parallel (one per skill in config)
│   │       ├── 5 skill-review subagents (sonnet, read-only)
│   │       ├── N Haiku scorers (one per finding)
│   │       └── Validation subagents (on-demand)
│   ├── launch-phase.sh merge 1
│   └── launch-phase.sh validate
├── Monitor curators in tmux, fix failures, retry as needed
├── Read curator commit messages → extract outcomes
├── Write outcomes into processed reports
├── Create PR, code review loop
└── Write orchestrator debrief report
```

The curation skill is not in the default `skill-curation.yaml` groups
but can be added to any subset config and run via `launch-phase.sh`.

### What Each Component Does

**Orchestrator** (`docs/prompts/curation/orchestrator.md`) — sets up and
runs the pipeline, monitors curators in tmux, handles failures and retries,
then manages all post-curation tasks (PR, code review, debriefs). See the
orchestrator prompt for its full workflow.

**Curator** (one per skill, `docs/prompts/curation/curator.md`) — the group
agent that runs skill-review subagents for one skill. Reads the entire skill
file and feedback reports, spawns 5 reviewers, collects findings, spawns
haiku scorers, filters at threshold, validates contested findings, then
produces a full rewrite of the skill file. Uses reviewer findings as input
but applies its own judgment — reviewers inform the rewrite, they don't
dictate it. Commits with a detailed message documenting all findings,
reasoning, and outcomes.

**Skill reviewer** (`.claude/agents/skill-reviewer.md`) — read-only subagent
spawned by the curator. Reviews the entire skill file from one of 5 angles.
Produces a structured findings report with per-claim classifications and
evidence. Assesses every section equally — no section is special. If a
reviewer exhausts its turns without writing the report, the curator runs
a haiku synthesis pass to format the raw investigation into the required
table structure (see curator.md Step 2b).

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

**Filename:** see `debrief-template.md` for the generation command (includes
random hex suffix to prevent collisions).

**Observation types:** `undocumented_behavior`, `wrong_documentation`,
`unexpected_result`, `workflow_gap`, `nothing_to_report`, `threshold_calibration`.

**Lifecycle:** feedback/ → curator reads oldest 20 → 5 reviewers assess
entire skill + reports → haiku scorers validate findings → curator synthesizes
rewritten skill file → on success (stage + merge pass), script moves reports
to feedback/processed/ → orchestrator writes outcomes. Reports in processed/
preserved permanently.

Curators also report issues they find in CLAUDE.md files, subagent definitions,
or other instruction context as `wrong_documentation` observations. These are
preserved in `processed/` for future instruction curation scope.

## File Layout

```
docs/prompts/curation/
├── orchestrator.md          # Orchestrator prompt (pipeline, monitoring, PR, code review)
├── curator.md               # Curator prompt (shared template, one instance per skill)
├── {skill-name}.md          # Thin wrappers (one per skill, point to curator)
├── debrief-template.md      # Template for agent debrief reports
├── validate.md              # Post-merge validation prompt
├── skill-curation.yaml      # Launch config (groups, reusable)
├── threshold.txt            # Scoring threshold (initial: 70)
└── feedback/                # Debrief reports accumulate here
    └── processed/           # Processed reports (outcomes in git history)

.claude/agents/
└── skill-reviewer.md        # Skill-review subagent definition (shared by all 5 angles)

scripts/
├── curate-skills.sh         # Pipeline runner
├── check-curation.sh        # Reminder hook (count + age thresholds)
├── generate-retry-config.sh # Partial failure recovery
└── lint-agent-paths.sh      # Cross-reference check (used by validate.md)
```
