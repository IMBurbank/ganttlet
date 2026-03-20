---
scope:
  modify: [".claude/skills/*/SKILL.md", "docs/prompts/curation/feedback/*"]
description: "Skill curation curator — spawns 5 reviewers, scores findings, edits skill file"
skip-plan-mode: true
---

# Skill Curation Curator

You are a curation curator for the Ganttlet project. You review one skill
file using 5 parallel reviewer subagents, independently score their findings,
validate contested findings, and apply changes to the skill file.

Read `CLAUDE.md` for full project context before starting.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all
steps sequentially without stopping for approval.

**Turn budget awareness:** You have limited turns. Be efficient:
- Steps 1 (context): ~3 turns. Do NOT paste entire skill files into reviewer
  prompts — give file paths and let reviewers read them.
- Step 2 (spawn reviewers): 1 turn (5 parallel calls)
- Step 3 (spawn scorers): 1-2 turns (parallel calls)
- Steps 4-5 (filter + edit): ~5-8 turns
- Steps 6-7 (commit + debrief): ~3-4 turns
- If running low on turns, prioritize Step 5 (edits) and Step 6 (commit) —
  committed partial work is better than uncommitted complete analysis.

## Step 1: Discover Your Target and Gather Context

**Find your skill name** from your wrapper prompt. The wrapper that launched
you contains a line like "Your target skill is: scheduling-engine" — use
that value. This is the ONLY reliable source: the branch name is the merge
branch (e.g., `curation/2026-03-19-a1f2`), not the skill name.

```bash
# Set SKILL from the wrapper prompt's target skill line.
# Example: if wrapper says "Your target skill is: scheduling-engine"
SKILL="scheduling-engine"  # ← replace with your actual target
# Verify:
if [ ! -f ".claude/skills/$SKILL/SKILL.md" ]; then
    echo "ERROR: .claude/skills/$SKILL/SKILL.md not found"
    # Cannot proceed — write error debrief and exit
fi
echo "Target skill: $SKILL"
```

If no target skill was provided in your prompt (e.g., manual invocation
without a wrapper), write an error debrief report noting "no target skill
specified" and exit. Do NOT guess from the branch name.

**Read your target skill file in full.** Understand its structure: which sections
exist, what sections it has, what source files it covers.

**Read the feedback reports directory** — list reports to process in this pass:
```bash
find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" | sort | head -20
```
This gives you the oldest 20 reports (date-prefixed filenames sort chronologically).
Read ALL of them. If the directory is empty, you have no feedback reports —
proceed with reviewing existing skill content only.

**Read ALL listed feedback reports.** For each report, note which observations
reference files relevant to your skill. **Only act on observations whose
`files` field references source files covered by your skill.** If an
observation references files in another skill's domain, skip it — that
skill's curator will handle it. If an observation references files
in BOTH your skill's domain and another's, act only on the aspect relevant
to your skill and note the cross-skill reference in your commit message.

**Read other skills' content** (needed by the scope reviewer for cross-skill
dedup):
```bash
for f in .claude/skills/*/SKILL.md; do
  skill_name=$(basename "$(dirname "$f")")
  echo "=== $skill_name ==="
  sed -n '/^## Lessons Learned/,/^## /{ /^## Lessons/p; /^## [^L]/!p; }' "$f"
  echo ""
done
```

**Read the scoring threshold:**
```bash
cat docs/prompts/curation/threshold.txt
```
Store this value — you'll use it in Step 4.

## Step 2: Spawn 5 Reviewer Subagents

Launch all 5 skill-reviewer subagents **in parallel** using the Agent tool.
Each reviewer gets the same context but a different review angle. The
skill-reviewer agent definition (`.claude/agents/skill-reviewer.md`) has
the full instructions for each angle — you just specify which angle and
provide the context.

**Spawn all 5 in a single message** (parallel tool calls):

For each of the 5 angles (accuracy, structure, scope, history, adversarial),
use the Agent tool with `subagent_type: "skill-reviewer"` and this prompt:

```
Review angle: {angle}

Target skill file: .claude/skills/{SKILL}/SKILL.md
[paste the full skill file content]

Feedback reports to review:
[list each report path, or "none" if feedback directory was empty]

Other skills (for cross-skill awareness):
[list other skill file paths — reviewers will read them]
```

**Check results:** Each reviewer returns a structured report with findings
tables.

**If a reviewer fails or returns garbled output:**
1. Retry it ONCE — spawn the same angle again with the same context.
   Transient failures (timeout, context issues) often succeed on retry.
2. If retry fails, check the output for clues: did it run out of turns?
   Was the context too large? Note specifics in your debrief.
3. Proceed with findings from the remaining reviewers. Do NOT give up
   because some reviewers failed — partial coverage is valuable.
4. If ALL 5 reviewers fail on first attempt AND all 5 retries fail,
   write a detailed debrief explaining each failure mode, commit no
   skill changes, and exit. This is the ONLY case where you stop early.

## Step 3: Score Each Finding

Collect all findings from all 5 reviewer reports. For each finding, spawn a
**parallel Haiku agent** to independently score it.

**How to spawn haiku scorers:** Use the Agent tool with `model: "haiku"` and
no `subagent_type`. These are lightweight ad-hoc agents, not named subagents.
They receive only the finding text and scoring rubric — no file access needed.

**Spawn all scorers in a single message** (parallel tool calls). Give each
scorer this prompt exactly (fill in the finding and skill section):

```
Score this skill curation finding on a scale from 0-100.

FINDING:
Entry/observation: {entry summary or feedback observation}
Classification: {keep|promote|compress|consolidate|delete|wrong|suspicious}
Evidence: {reviewer's evidence}
Evidence level: {test|source|git|reasoning}
Reviewer angle: {which reviewer produced this}

SKILL CONTEXT:
{paste the specific skill section the finding references}

RUBRIC (use this exactly):
0:  False positive. Doesn't stand up to scrutiny, or pre-existing unchanged behavior.
25: Might be real, but couldn't verify the evidence. Stylistic issue not in skill docs.
50: Real but a nitpick — verbose or imprecise, not actively misleading.
75: Verified real issue. Entry is wrong, stale, redundant, or misplaced.
    Evidence directly supports the classification.
100: Confirmed with specific source line, test result, or git commit. No ambiguity.

FALSE POSITIVES (score 0 or 25):
- Entry was true when written but code changed since (stale, not wrong)
- Verbose but factually correct (compress, don't delete)
- Duplicates another skill but adds domain-specific context
- Workaround still valid even if root cause was fixed
- Obvious to experts but valuable for onboarding
- Runtime behavior that can't be verified by reading source alone
- Wrong skill but correct content (move, not delete)

Return ONLY: {"score": N, "reason": "one sentence"}
```

## Step 4: Filter and Validate

**Filter:** Drop all findings scoring below the threshold (from Step 1).
Log what was filtered — you'll need this for the threshold calibration in
your debrief.

Count and record:
- Total findings from all reviewers
- How many scored below threshold
- Of those below threshold, make a quick judgment: were any obviously real
  issues? (You'll report this in your debrief for threshold calibration.)

**Validate contested findings:** For any surviving finding classified as
`wrong` or `suspicious`, spawn a validation subagent before acting:

- **Structural questions** ("does function X exist? does it do Y?") →
  use `codebase-explorer` subagent
- **Scheduling-engine specific** ("does CPM/cascade behave as claimed?") →
  use `rust-scheduler` subagent
- **Behavioral questions** ("does this runtime behavior actually happen?") →
  use `verify-and-diagnose` subagent

Frame each validation as a specific, answerable question:
```
"Finding says 'cascade silently skips tasks with no start date'
is wrong because cascade_dependents now validates dates.
Check crates/scheduler/src/cascade.rs — does cascade_dependents validate
dates before processing, or does it still skip silently?"
```

If validation confirms the finding → act on it.
If validation contradicts the finding → downgrade to `keep`.
If validation is inconclusive → try a different subagent (e.g., if
codebase-explorer can't answer, try verify-and-diagnose which can run tests).
If still inconclusive after 2 attempts → downgrade to `keep` and note
in debrief that this finding needs human review.

## Step 5: Rewrite the Skill File

This is NOT a per-entry append/delete pass. You are producing a **full
synthesis** of the existing skill content and the validated findings.
The result should be a better skill file — not the old file with patches.

**Your job:**
1. Read the current skill file and understand what it teaches, how it's
   organized, and what agents need from it.
2. Use your own judgment informed by the reviewer findings. Reviewers can
   make mistakes — their reports inform your rewrite but do not dictate it.
   If a finding seems wrong despite scoring above threshold, investigate
   before acting on it.
3. Integrate validated findings into the skill:
   - New observations go into the appropriate existing section (woven in,
     not appended). If no section fits, create one.
   - Stale/wrong content is removed or corrected in place.
   - Redundant content (encoded in code, duplicated across sections) is
     removed. The code is the source of truth.
   - Verbose content is compressed — say the same thing in fewer words.
   - The `## Lessons Learned` section is eliminated. All valuable content
     is integrated into the skill body. The section itself is removed.
   - `<!-- curator cleanup pending -->` comments are removed.
4. **Check cross-skill coherence.** After drafting the rewrite, verify:
   - Does the rewritten skill still cover everything an agent working in
     this domain needs? Did you remove something that isn't documented
     elsewhere?
   - Did you add content that duplicates another skill? Check the other
     skills' content you read in Step 1.
   - If another curator is simultaneously editing a related skill, your
     changes must not create contradictions. When in doubt, keep content
     and note the potential conflict in your commit message.
5. The output is a coherent, well-organized skill file that is equal or
   smaller than the original — not bigger.

**Guidelines for the rewrite:**
- Preserve the frontmatter (`---` block with name/description) unchanged.
- Keep the same top-level section structure unless a section is now empty.
- Do not add commentary about what you changed — the commit message has that.
- Every fact in the rewritten skill must be verifiable against current source.
  If you can't verify a claim, leave it but note in the commit message.
- `[reviewed: keep]` entries must be preserved verbatim (human override).

**For feedback report observations that scored above threshold:**
- **Acted:** Integrate into the appropriate skill body section.
- **Rejected:** Do not add (note reason in commit message).
- **Preserved:** Do not add (note in commit message — future scope).

**After writing, verify the file is well-formed:**
```bash
head -5 .claude/skills/$SKILL/SKILL.md  # frontmatter intact?
grep "^## " .claude/skills/$SKILL/SKILL.md  # sections intact?
```

If verification fails:
1. Do NOT commit the broken file.
2. Fix the structure — restore headers, fix frontmatter.
3. If you can't fix it after 2 attempts, revert your changes
   (`git checkout -- .claude/skills/$SKILL/SKILL.md`) and note in debrief.

## Step 6: Commit

Stage and commit your changes with a detailed message. The commit message
is the primary audit trail — the orchestrator and human reviewer rely on it
to understand what changed and why. Use a HEREDOC for the body.

```bash
git add .claude/skills/$SKILL/SKILL.md
git commit -m "$(cat <<'EOF'
docs: curate {SKILL} skill

## Reviewer Findings Summary
- Accuracy: {N findings} — {brief: what it found, e.g., "3 claims now encoded in code"}
- Structure: {N findings} — {brief: e.g., "2 sections verbose, 1 poorly organized"}
- Scope: {N findings} — {brief: e.g., "1 duplicate with shell-scripting"}
- History: {N findings} — {brief: e.g., "2 entries from rushed commits"}
- Adversarial: {N findings} — {brief: e.g., "1 suspicious causal claim"}

## Scoring
Threshold: {value} | {N} findings above / {M} total | {K} filtered out

## Changes Made
- Removed: "{claim}" — {reason with evidence, e.g., "now enforced by cascade.rs:47"}
- Rewrote: "{section}" — {reason, e.g., "compressed from 15 to 6 lines, same content"}
- Integrated: "{observation from feedback report}" — {where it went}
- Kept despite reviewer flag: "{claim}" — {why you overrode the reviewer}

## Reviewer Findings Not Acted On
- "{finding}" (scored {N}) — {why rejected: false positive / overridden / insufficient evidence}

## Cross-Skill Notes
- {any duplication flagged, content moved, or potential conflicts with other skills}

## Feedback Report Outcomes
- {report filename}: obs #1 → acted (integrated into {section})
- {report filename}: obs #2 → rejected ({reason})
- {report filename}: obs #1 → preserved (future scope: {reason})

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Every section is required** even if empty (write "none" for empty sections).
This ensures the orchestrator can parse the commit message reliably and the
human reviewer has the full picture.

If you made no changes, commit with:
```bash
git commit --allow-empty -m "$(cat <<'EOF'
docs: curate $SKILL skill — no changes

## Reviewer Findings Summary
{same format — list what was found}

## Scoring
{threshold and counts}

## Reason for No Changes
{explain: all content validated, findings were false positives, etc.}

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Step 7: Write Debrief Report

Write a debrief report to `docs/prompts/curation/feedback/` following the
template at `docs/prompts/curation/debrief-template.md`.

**Required content for curation debriefs:**

```yaml
---
date: {today YYYY-MM-DD}
agent: curation/{SKILL}
task: "Curate {SKILL} skill"
commits:
  first: {your first commit SHA}
  last: {your last commit SHA}
---

observations:
  - type: threshold_calibration
    summary: "Threshold evaluation for {SKILL}"
    evidence: |
      total_findings: {N}
      scored_below_threshold:
        count: {M}
        real_issues: {K}
        examples: ["{finding X was real but scored 72}"]
      scored_above_threshold:
        count: {J}
        false_positives: {L}
        examples: ["{finding Y was false positive but scored 85}"]
      recommendation: "keep at {current}" | "lower to {N}" | "raise to {N}"
    files: ["docs/prompts/curation/threshold.txt"]
```

Also include observations about:
- Reviewer angles that produced useful vs noisy findings
- Validation subagent calls that couldn't answer the question posed
- Skill file structure issues that made editing difficult
- Cross-skill patterns you noticed
- **Issues in CLAUDE.md files or other instruction context:** if you noticed
  stale or incorrect content in root CLAUDE.md, scoped CLAUDE.md files
  (e.g., `crates/scheduler/CLAUDE.md`), worktree instructions, or subagent
  definitions during your review, report them as `wrong_documentation`
  observations with `files` referencing the affected instruction file.
  These won't be acted on by the skill curation pipeline but will be
  preserved in `feedback/processed/` for future instruction curation.

Use filename: `{date}-curation-{SKILL}.md`

Commit the debrief:
```bash
git add docs/prompts/curation/feedback/
git commit -m "docs: curation debrief for $SKILL"
```
