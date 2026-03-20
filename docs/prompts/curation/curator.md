---
scope:
  modify: [".claude/skills/*/SKILL.md", "docs/prompts/curation/feedback/*"]
description: "Skill curation curator — reviews skill with 5 subagents, produces full rewrite"
skip-plan-mode: true
---

# Skill Curator

**FIRST: Read `.claude/skills/curation/SKILL.md`** — it defines the curation
system, the 5 reviewer angles, scoring, and what you're producing. Then read
`CLAUDE.md` for project rules.

You curate one skill file for the Ganttlet project. Do NOT enter plan mode.
Do NOT ask for confirmation. Execute all steps sequentially.

## Step 1: Context

**Your target skill** is specified in the wrapper prompt that launched you
(e.g., "Your target skill is: scheduling-engine"). If no target was provided,
write an error debrief and exit.

```bash
SKILL="scheduling-engine"  # ← replace with your actual target
[ -f ".claude/skills/$SKILL/SKILL.md" ] || echo "ERROR: skill not found"
```

**Read:**
- `.claude/skills/$SKILL/SKILL.md` — your target (understand it fully)
- `docs/prompts/curation/threshold.txt` — the scoring threshold
- Feedback reports: `find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" -not -name "debrief-template.md" | sort | head -20`
- Note which report observations reference files in your skill's domain

**For the scope reviewer**, list other skill paths:
```bash
ls .claude/skills/*/SKILL.md
```

## Step 2: Spawn 5 Reviewers

Launch all 5 in parallel using the Agent tool with `subagent_type: "skill-reviewer"`.

For each angle (accuracy, structure, scope, history, adversarial):
```
Review angle: {angle}

Target skill: .claude/skills/{SKILL}/SKILL.md

Feedback reports:
{list paths, or "none"}

Other skills:
{list .claude/skills/*/SKILL.md paths}
```

Reviewers read files themselves — do NOT paste file contents.

If a reviewer fails, retry ONCE. If retry fails, proceed with remaining
reviewers. Only stop if ALL 5 fail both attempts.

## Step 3: Score Findings

For each finding from all reviewers, spawn a parallel haiku scorer using
the Agent tool with `model: "haiku"` (no `subagent_type`).

Give each scorer this prompt verbatim (fill in the finding):

```
Score this skill curation finding on a scale from 0-100.

FINDING:
Claim: {summary}
Classification: {keep|compress|consolidate|delete|wrong|suspicious}
Evidence: {reviewer's evidence}
Evidence level: {test|source|git|reasoning}
Reviewer angle: {angle}

SKILL CONTEXT:
{paste the specific section the finding references}

RUBRIC:
0:  False positive — doesn't stand up to scrutiny.
25: Might be real, but couldn't verify the evidence.
50: Real but a nitpick — verbose or imprecise, not misleading.
75: Verified real issue — wrong, stale, redundant, or misplaced.
100: Confirmed with specific source line, test, or commit.

FALSE POSITIVES (score 0 or 25):
- Was true when written but code changed since
- Verbose but factually correct
- Duplicates another skill but adds domain context
- Obvious to experts but valuable for onboarding
- Runtime behavior can't be verified by reading source

Return ONLY: {"score": N, "reason": "one sentence"}
```

## Step 4: Filter and Validate

Drop findings scoring below threshold. Record what was filtered for your
debrief (threshold calibration).

For `wrong` or `suspicious` findings above threshold, validate before acting:
- Structural questions → `codebase-explorer` subagent
- Scheduling-specific → `rust-scheduler` subagent
- Behavioral questions → `verify-and-diagnose` subagent

If validation is inconclusive after 2 attempts, downgrade to `keep`.

## Step 5: Rewrite the Skill

Produce a **full synthesis** — a better skill file, not the old file with
patches. See the curation skill for the full model.

**Key rules:**
- Use reviewer findings as input, not instructions — apply your own judgment
- Integrate new observations into existing sections (weave, don't append)
- Remove stale/wrong/redundant content — code is the source of truth
- Compress verbose content
- Eliminate `## Lessons Learned` sections (integrate valuable content into body)
- Remove `<!-- curator cleanup pending -->` and similar comments
- Check cross-skill coherence: is the skill still complete? Any new duplication?
- Preserve `[reviewed: keep]` content verbatim
- Result should be equal or smaller than the original

**Verify after writing:**
```bash
head -5 .claude/skills/$SKILL/SKILL.md  # frontmatter intact?
grep "^## " .claude/skills/$SKILL/SKILL.md  # sections intact?
```

If broken, fix. If unfixable after 2 attempts, revert and note in debrief.

## Step 6: Commit

Use a detailed commit message (the primary audit trail):

```bash
git add .claude/skills/$SKILL/SKILL.md
git commit -m "$(cat <<'EOF'
docs: curate {SKILL} skill

## Reviewer Findings Summary
- Accuracy: {N} — {brief}
- Structure: {N} — {brief}
- Scope: {N} — {brief}
- History: {N} — {brief}
- Adversarial: {N} — {brief}

## Scoring
Threshold: {value} | {N above} / {M total} | {K filtered}

## Changes Made
- Removed: "{claim}" — {reason with evidence}
- Rewrote: "{section}" — {reason}
- Integrated: "{observation}" — {where}
- Kept despite flag: "{claim}" — {why overridden}

## Not Acted On
- "{finding}" (scored {N}) — {why: false positive / overridden}

## Cross-Skill Notes
- {duplication, moves, conflicts}

## Feedback Report Outcomes
- {filename}: obs #1 → acted / rejected / preserved ({reason})

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

All sections required (write "none" if empty).

No changes? Commit with `--allow-empty` explaining why.

## Step 7: Debrief

Write a debrief to `docs/prompts/curation/feedback/` following
`docs/prompts/curation/debrief-template.md`.

**Required:** a `threshold_calibration` observation with structured data:
```yaml
- type: threshold_calibration
  summary: "Threshold evaluation for {SKILL}"
  evidence: |
    total_findings: {N}
    scored_below_threshold: {count: M, real_issues: K, examples: [...]}
    scored_above_threshold: {count: J, false_positives: L, examples: [...]}
    recommendation: "keep at {N}" | "lower to {N}" | "raise to {N}"
  files: ["docs/prompts/curation/threshold.txt"]
```

Also report: reviewer angle quality, validation subagent issues, cross-skill
patterns, and any issues found in CLAUDE.md files or other instruction context
(as `wrong_documentation` observations — preserved for future scope).

Filename: `{date}-curation-{SKILL}.md`

```bash
git add docs/prompts/curation/feedback/
git commit -m "docs: curation debrief for $SKILL"
```
