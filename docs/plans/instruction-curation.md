# Instruction Tiering & Skill Curation

Design plan for restructuring agent instructions into tiers (reducing root
CLAUDE.md from ~3900 to ~1500-2000 tokens) and building an automated skill
curation system (5-reviewer pipeline with scoring, feedback reports, and
a strict code review loop).

## Problem

Root CLAUDE.md is ~3900 tokens loaded unconditionally. ~40-50% is only relevant to
specific work modes (scheduling, multi-agent phases, issue workflows). Same rules
appear in 3-4 places with slightly different phrasing, creating drift risk.

## Design: Three Tiers

### Tier 0 — Always loaded (root CLAUDE.md, target ~1500-2000 tokens)

Only what every agent session needs regardless of task:

- Project description (5 lines)
- Code Navigation / LSP-first (current content, already compact)
- Behavioral Rules — safety-only subset:
  - Read before edit
  - Don't create unnecessary files
  - Don't modify outside assigned scope
  - Don't push to main
  - Worktrees (one-line + ref to `.claude/worktrees/CLAUDE.md`)
  - Don't add unasked features
  - Test-first; E2E tests required for user-facing changes (one-line)
  - Rebase on main regularly before creating a PR
  - Commit after each logical change, not just at the end
  - Conventional commits
  - Don't skip verification: `./scripts/full-verify.sh`
  - Don't enter plan mode when executing from a prompt file
  - Never compute arithmetic/dates mentally — use tools (details in scheduling-engine skill).
    NEVER use `addBusinessDays` directly for end dates — use `taskEndDate`.
  - Keep dependencies minimal
  - Remove test-specific code paths in production builds
  - Never ask for secrets in chat
  - Pattern bug fix procedure (LSP findReferences + Grep — universal)
  - Emergency: `git add -A && git commit -m "emergency: saving work"` (full error protocol in issue-workflow skill)
  - Guard binary: built automatically in Docker, or `cargo build --release -p guard`
  - Write debrief reports when you discover non-obvious behavior (verify hook reminds you)
- Architecture Constraints (current 5 bullets — already compact)
- Reference Index (skills/agents/docs listing)

### Tier 1 — Mode-activated (loaded when entering a work mode)

| Content (current location)                    | Moves to                              |
|-----------------------------------------------|---------------------------------------|
| Error Handling Protocol (CLAUDE.md L55-61)    | `issue-workflow/SKILL.md` (Tier 0 keeps emergency commit one-liner) |
| Progress Tracking Format (CLAUDE.md L63-105)  | `multi-agent-orchestration/SKILL.md`  |
| Commands Quick Reference (CLAUDE.md L107-124) | README.md (human) + already in skills (agent) |
| Date Conventions full (CLAUDE.md L133-141)    | `scheduling-engine/SKILL.md`          |
| Dev Environment setup (CLAUDE.md L143-149)    | README.md (human setup); guard binary line stays in Tier 0 |
| Single-Agent Issue Workflow (CLAUDE.md L151-184) | `issue-workflow/SKILL.md` (merge)  |
| Context Conservation (CLAUDE.md L186-192)     | `multi-agent-orchestration/SKILL.md`  |
| Task Queue / Project Status (CLAUDE.md L216-221) | `docs/TASKS.md` (already there)    |

### Tier 2 — On-demand reference (current skills — no changes needed)

Already correctly scoped: hooks, cloud-deployment, google-sheets-sync, e2e-testing,
shell-scripting. (rust-wasm absorbed into scheduling-engine per step 8.)

## Deduplication: Canonical Locations

| Rule               | Canonical location                  | Others become one-line refs         |
|--------------------|-------------------------------------|-------------------------------------|
| Worktree procedures| `.claude/worktrees/CLAUDE.md`       | CLAUDE.md, multi-agent skill, hooks |
| Date conventions   | `scheduling-engine/SKILL.md`        | CLAUDE.md, crates/scheduler/CLAUDE.md, src/CLAUDE.md |
| Verification flow  | `issue-workflow/SKILL.md`           | CLAUDE.md (both instances)          |
| Test-first         | Root CLAUDE.md (Tier 0, one line)   | issue-workflow stops repeating      |
| Error escalation   | `issue-workflow/SKILL.md`           | CLAUDE.md keeps emergency one-liner, removes full 3-level protocol |
| Progress tracking  | `multi-agent-orchestration/SKILL.md`| CLAUDE.md removes full section; issue-workflow keeps single-agent variant |
| Context conservation| `multi-agent-orchestration/SKILL.md`| CLAUDE.md removes full section      |
| Commands           | Scoped CLAUDE.md files + skills     | Root CLAUDE.md removes table; README gets human-facing commands |
| Debrief reports    | `debrief-template.md` (template)    | CLAUDE.md has one-line ref; verify hook points to template |

Also audit scoped CLAUDE.md files (`crates/scheduler/`, `src/`, `src/sheets/`, `e2e/`,
`server/`) — replace restated rules with skill references. Keep only directory-specific
constraints.

## Migration Steps (each is one commit)

**Principle: migration steps move content faithfully — no editorial cleanup.**
Content is relocated as-is to the correct file per the tiering and dedup
design. Quality improvements (compression, promotion, deletion of stale
content) are the curation system's job during its first pass (step 12).

**Ordering: steps 1-7 are sequential on root CLAUDE.md.** Each step removes
or replaces content, changing line numbers for subsequent steps. They MUST
be applied in order — do not draft them in parallel against the same base.
Each step is one logical commit that may span multiple files; stage all
files for a step together before committing.

1. **Move date conventions** out of root CLAUDE.md → into `scheduling-engine/SKILL.md`
   - Copy content faithfully, no rewording
   - Root keeps: "Never compute arithmetic/dates mentally — use tools (see scheduling-engine skill)"
   - `crates/scheduler/CLAUDE.md` and `src/CLAUDE.md` reference skill instead of restating
   - Note: scheduling-engine already has abbreviated date conventions in "Known Gotchas."
     The moved content will overlap — place in a clearly marked section for curator
     cleanup in step 12

2. **Move progress tracking + error protocol** → into respective skills
   - Progress tracking → `multi-agent-orchestration/SKILL.md` (copy as-is)
     Note: issue-workflow already has single-agent progress format. The
     multi-agent JSON format and node update idiom are the new content.
   - Error protocol → `issue-workflow/SKILL.md` (copy as-is)
     Note: issue-workflow already has an Error Handling section — place moved
     content in a clearly marked section for curator cleanup in step 12
   - Root keeps emergency one-liner only

3. **Move commands table + dev environment** → split by audience
   - Guard binary line stays in root CLAUDE.md Tier 0 behavioral rules
     (already listed there — do NOT move it with the rest of Dev Environment)
   - Human-facing commands → README.md (copy as-is)
   - Agent-facing commands already live in scoped CLAUDE.md files and skills:
     - `npm run test` → `src/CLAUDE.md`; `cargo test` → `crates/scheduler/CLAUDE.md`
     - E2E commands → `e2e/CLAUDE.md`
     - `full-verify.sh`, `attest-e2e.sh` → issue-workflow skill
     - `launch-phase.sh`, `launch-supervisor.sh`, `claude` CLI → multi-agent-orchestration skill
   - Note: `src/sheets/CLAUDE.md` has no Commands section — Sheets work uses
     `npm run test` from `src/CLAUDE.md`. No Sheets-specific commands need a home.
   - Root keeps nothing — commands table is redundant

4. **Move single-agent issue workflow** → into `issue-workflow/SKILL.md`
   - Copy as-is; skill already has overlapping content — place moved content
     in a clearly marked section so the curators can consolidate in step 12

5. **Move context conservation** → into `multi-agent-orchestration/SKILL.md`
   - Copy as-is

6. **Deduplicate worktree rules** across all files
   - Canonical: `.claude/worktrees/CLAUDE.md`
   - Root CLAUDE.md: one line + ref
   - multi-agent skill, hooks skill: refs only

7. **Audit scoped CLAUDE.md files** — replace restated rules with skill refs

   **`crates/scheduler/CLAUDE.md`** (30 → ~15 lines):
   - Date Convention section (L18-27, 10 lines) → replace with:
     "Date conventions: see scheduling-engine skill."
   - "Never do arithmetic in your head" (L16) → remove (covered by Tier 0 rule)

   **`src/CLAUDE.md`** (21 → ~13 lines):
   - Date Conventions section (L14-18, 5 lines) → replace with:
     "Date conventions: see scheduling-engine skill. Use `taskDuration`/`taskEndDate`
     from `dateUtils.ts`."

   **`.claude/worktrees/CLAUDE.md`**:
   - Line 24 overlaps line 17 but carries additional context ("only after PR
     is merged," "user authorizes"). Merge line 24's unique details into line 17,
     then remove line 24. Do not silently delete — the additional context matters.
   - This file IS the canonical location for worktree rules. No content moves out.
     Root CLAUDE.md references this file instead of restating.

   **No changes:** `server/CLAUDE.md`, `src/sheets/CLAUDE.md`, `e2e/CLAUDE.md` —
   all directory-specific, no duplication.

8. **Absorb rust-wasm into scheduling-engine** — move 43 lines into scheduling-engine
   - Copy content faithfully into appropriate sections
   - Delete `rust-wasm/SKILL.md`
   - Update skill trigger to cover WASM build/debug tasks
   - Update reference index in root CLAUDE.md

9. **Add utility skill references** — domain skills that use shell patterns get one-line ref
   - multi-agent-orchestration: "For bash patterns: see shell-scripting skill"
   - e2e-testing, cloud-deployment, hooks: same where relevant
   - shell-scripting SKILL.md gets a note: "Utility skill — shared foundation"

10. **Prepare LL sections for curation handover** — set LL header comment
    in all skills to "managed by curation pipeline — do not edit directly."
    - 6 skills have the old comment (`<!-- Agents: append here... -->`) → update it
    - 3 skills (multi-agent-orchestration, hooks, issue-workflow) have no comment → add it
    - Optionally add timestamps to undated entries via git blame as a one-time
      aid for the initial cleanup reviewers

11. **Add curation infrastructure**
    - Create `docs/prompts/curation/` directory with prompt templates
    - Create `docs/prompts/curation/feedback/` for debrief reports
    - Create `docs/prompts/curation/skill-curation.yaml` launch config
    - Create `.claude/skills/curation/SKILL.md`
    - Create `.claude/agents/skill-reviewer.md`
    - Add debrief check to `full-verify.sh`
    - Add curation reminder to `verify.sh` and `full-verify.sh`
    - Update CLAUDE.md: "write debrief to feedback/" replaces "append to LL"
    - Update `.claude/agents/codebase-explorer.md` structure map (new directories)
    - Run `./scripts/lint-agent-paths.sh` to verify structure map accuracy

12. **Run first curation pass** — the curators handle quality improvements.
    Start with multi-agent-orchestration (20 entries, best test case).
    The curators determine what to keep, compress, promote, or delete —
    including cleaning up any duplication or awkwardness introduced by the
    faithful content moves in steps 1-8. Refine prompts based on results,
    then run remaining skills. This plan does not prescribe specific
    curation outcomes.

    Note: the initial pass has no feedback reports (the debrief model isn't
    active yet). The curator prompt handles this gracefully — when
    the feedback directory is empty, it proceeds with reviewing existing
    LL entries and skill body content only. This is the intended behavior
    for the initial cleanup.

## Lessons Learned: Current State and Transition

After the switch to structured feedback, LL sections are frozen — only the
curation pipeline writes to them. Existing LL entries are cleaned up in the
initial curation pass (step 12). The reviewer angles, classification system,
and scoring rubric are defined in the Skill Curation System section below.

### Why multi-agent-orchestration is the first test case
This skill has 20 entries (~600 tokens) — the largest LL section by far. Many
entries likely reference behavior now encoded in `launch-phase.sh` code. This
makes it the best test case for the 5 reviewer angles: the accuracy reviewer
has plenty to verify against source, the scope reviewer has cross-skill
duplication to find (shell-scripting overlap), and the adversarial reviewer
has enough entries to find at least one that's wrong or misleading.

The actual triage decisions are made by the curation reviewers, not this plan.

## Skill Curation System

### Problem

Lessons Learned is a write-only append log. Agents add entries during work but nobody
curates them. Entries may be wrong (coincidental fix, not root cause), redundant
(now encoded in code), stale (behavior changed), or duplicated across skills. Without
a curation process, LL sections grow unbounded and the token savings from tiering
get eaten by instruction bloat in skills.

### Design: A Launch Phase with Reusable Prompts

Skill curation is a **launch-phase config** — a single highly parallel stage where
each group is one skill, followed by a merge and code-review loop. No new orchestration
infrastructure needed. The interesting part is that the prompts are **reusable templates**
that improve over time, unlike normal phase prompts which are task-specific and disposable.

```
curate-skills.sh
│
├── launch-phase.sh stage 1 (8 curators in parallel, one per skill)
│   │
│   ├── Curator: scheduling-engine (worktree: curation/scheduling-engine)
│   │   ├── 5 Reviewer subagents (accuracy, structure, scope, history, adversarial)
│   │   ├── N Haiku scorers (one per finding, parallel)
│   │   └── Validation subagents (on-demand: codebase-explorer, rust-scheduler, etc.)
│   │
│   ├── Curator: hooks
│   │   └── (same internal structure)
│   │
│   ├── Curator: multi-agent-orchestration
│   ├── Curator: e2e-testing
│   ├── Curator: shell-scripting
│   ├── Curator: issue-workflow
│   ├── Curator: cloud-deployment
│   └── Curator: google-sheets-sync
│
├── launch-phase.sh merge 1 (all branches → merge branch)
│
├── launch-phase.sh validate
│
└── Orchestrating agent handles:
    ├── Read curator commit messages from merge branch
    ├── Summarize per-observation outcomes + threshold calibration into PR body
    ├── Create PR with skill-curation label
    ├── Strict code review loop (max 3 iterations)
    └── Post final summary → inform user
```

The **orchestrating agent** is the agent session that invoked `/curate-skills`.
It has no separate prompt or definition — it's the interactive session that
ran the script, then handles PR creation and code review using its own
judgment. The `/curate-skills` flow (below) details its responsibilities.

Each **curator** is a launch-phase group agent (one per skill) that internally
spawns subagents — same pattern as the code-review plugin using 5 parallel reviewers.
The launch-phase infrastructure handles the parallelism across skills; the curator
handles the parallelism within each skill's review.

### Launch Config

```yaml
phase: skill-curation
merge_target: curation/run  # overridden by script via _USER_MERGE_TARGET env var
stages:
  - name: "Skill curation"
    groups:
      - id: scheduling-engine
        branch: curation/scheduling-engine
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: scheduling-engine skill"
      - id: hooks
        branch: curation/hooks
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: hooks skill"
      - id: multi-agent-orchestration
        branch: curation/multi-agent-orchestration
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: multi-agent-orchestration skill"
      - id: e2e-testing
        branch: curation/e2e-testing
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: e2e-testing skill"
      - id: shell-scripting
        branch: curation/shell-scripting
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: shell-scripting skill"
      - id: issue-workflow
        branch: curation/issue-workflow
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: issue-workflow skill"
      - id: cloud-deployment
        branch: curation/cloud-deployment
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: cloud-deployment skill"
      - id: google-sheets-sync
        branch: curation/google-sheets-sync
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: google-sheets-sync skill"
      # curation skill added here once it exists (self-curation)
      # rust-wasm absorbed into scheduling-engine (step 8) — no group needed
# No pr: block — orchestrating agent creates the PR with its own judgment
```

**Key detail:** Every group uses the **same core prompt** (`curator.md`).
Each group has a thin wrapper file (`{group_id}.md`) that points to the
shared prompt and specifies the target:

```markdown
# docs/prompts/curation/scheduling-engine.md (3 lines)
---
scope:
  modify: [".claude/skills/scheduling-engine/SKILL.md"]
---

Read docs/prompts/curation/curator.md and follow its instructions.
Your target skill is: scheduling-engine
```

Wrappers are identical except for the skill name and scope. Adding a new
skill to curation = copy a wrapper, change two strings. The core prompt
and all reviewer prompts are shared — improvements benefit every skill.

**Required launch-phase.sh enhancement: `prompt` field in group config.**

Currently `agent.sh` hardcodes prompt path as `{config_dir}/{group_id}.md`.
Curation needs all groups to use the same prompt file. A small, backward-
compatible change:

```bash
# In agent.sh — ~5 line change
local prompt_override
prompt_override=$(yq -r ".stages[$s].groups[$g].prompt // empty" "$CONFIG_FILE")
local prompt_file="${prompt_override:-${WORKSPACE}/${PROMPTS_DIR}/${group}.md}"
```

If `prompt` is set in the YAML, use it. Otherwise fall back to the current
`{config_dir}/{group_id}.md` behavior. Existing phase configs work unchanged.

**What's static and reusable (never changes between runs):**
- `curator.md` — one prompt template for all skills
- `skill-curation.yaml` — one launch config for all curation passes
- 5 reviewer prompt files — one per angle, used by all curators

**What varies per run (managed by `curate-skills.sh`):**
- `_USER_MERGE_TARGET` — date-stamped merge branch (`curation/YYYY-MM-DD-<hash>`)
- Contents of `feedback/` directory — curators read the oldest 20 reports directly

**How the curator discovers its context at runtime:**
- Skill name: from branch name (`curation/scheduling-engine` → `scheduling-engine`)
- Skill file: `.claude/skills/{skill-name}/SKILL.md`
- Source files: listed in the skill's SKILL.md body
- Feedback reports: curator reads `docs/prompts/curation/feedback/` directly (oldest 20)

No files rewritten per run. No symlinks. No per-skill prompt copies.

### Reusable Prompt Templates

These live in `docs/prompts/curation/` and improve over time. Unlike task-specific
phase prompts, these are permanent infrastructure.

```
docs/prompts/curation/
├── curator.md          # Main curator prompt (shared by all skills)
├── debrief-template.md      # Template for agent debrief reports (read by agents)
├── {skill-name}.md          # Thin wrappers (one per skill, point to curator)
├── validate.md              # Post-merge validation prompt (required by launch-phase.sh)
├── skill-curation.yaml      # Launch config for curation passes
├── threshold.txt            # Scoring threshold (single integer, initial 70)
└── feedback/                # Debrief reports accumulate here
    └── processed/           # Processed reports (outcomes written by orchestrator)
```

The curator prompt instructs the agent to:
1. Read `docs/prompts/curation/feedback/` directory for reports to process (oldest 20)
2. Read all listed reports and its assigned skill's SKILL.md
3. Spawn 5 reviewer subagents in parallel (one per angle), passing reports + skill
4. Collect reports, build consensus matrix
5. Resolve disagreements (via validation subagents if needed)
6. Edit the skill file
7. Commit with evidence-backed rationale

The reviewer prompts are self-contained — each describes one angle and its output
format. They can be refined independently based on what each angle catches or misses.

### The 5 Reviewer Angles

Mirrors code-review's aspect-per-reviewer pattern. Each reviewer gets the same skill
context but a different lens. Each produces an independent structured report.

| # | Angle | Focus | Catches | Parallel to code-review |
|---|-------|-------|---------|------------------------|
| 1 | **Accuracy** | Is each LL entry still true? Encoded in code? | Redundant lessons, stale claims | Bug scan |
| 2 | **Structure** | Skill body quality, promotion opportunities | Verbose sections, misplaced content | CLAUDE.md compliance |
| 3 | **Scope** | Cross-skill boundaries, duplication | Lessons in wrong skill, duplicates | Prior PR comments |
| 4 | **History** | Provenance, context decay since entry added | Rushed entries, outdated refs | Git history |
| 5 | **Adversarial** | Actively disprove. Assume each entry is wrong. | Wrong lessons, weak causation | (unique to curation) |

#### Accuracy Reviewer
Reads the source files the skill covers and checks each LL entry against current
implementation. Primary tool for catching redundant lessons.

**Key questions per entry:**
- Does the behavior described still exist in the source?
- Is there now a function, test, hook, or lint that enforces this?
- If encoded in code, cite the specific function/line.

#### Structure Reviewer
Reads the full SKILL.md and evaluates organization, size, and staleness.
Identifies LL entries that should be promoted to the skill body.

**Key questions per entry:**
- Is this important enough to live in the skill body permanently?
- If so, where does it fit? Draft the promoted text.
- Are there skill body sections that are verbose and could be compressed?

#### Scope Reviewer
Receives all skills' LL sections as read-only context. Checks whether entries
belong in this skill or another, and flags duplicates across skills.

**Key questions per entry:**
- Does this entry duplicate something in another skill's LL or body?
- Does this entry belong in a different skill based on its domain?
- Is the canonical location for this knowledge in this skill or elsewhere?

#### History Reviewer
Uses git blame and git log to understand when and why each entry was added.
Checks whether the referenced code has changed since the lesson was written.

**Key questions per entry:**
- When was this added and in what context? (git blame date + commit message)
- Has the referenced file/function changed significantly since? (git log)
- Was this added in a rush (emergency commit, late-night session, WIP branch)?
- Does the commit that added the lesson also contain the fix? If so, is the
  lesson describing the root cause or just the symptom?

#### Adversarial Reviewer
The highest-value reviewer. Wrong lessons actively mislead future agents —
they're worse than no lesson at all. This reviewer's job is to find them.

**Key questions per entry:**
- Can I find a test case or source behavior that contradicts this lesson?
- Does the lesson describe a symptom rather than a root cause?
- Is the lesson's causal claim actually supported, or was the fix coincidental?
- If I follow this lesson's advice, would I produce correct code today?

**Unique output: "suspicious" classification** — can't disprove it, but causal
reasoning is weak. Forces the curator to validate before acting.

### Reviewer Context

**All reviewers receive:**
- The full SKILL.md for the assigned skill
- Git blame for the LL section (dates + authors)
- Other skills' LL sections (read-only, for cross-skill awareness)

**Additional context by reviewer type:**

| Reviewer | Additional context |
|----------|-------------------|
| Accuracy | Source files the skill covers (from `prompt_vars.source_paths`) |
| Structure | (skill body is sufficient) |
| Scope | All other skills' full SKILL.md files |
| History | Git log for files referenced by LL entries; commit messages for LL additions |
| Adversarial | Source files + test files for the skill's domain |

### Output Format (same for all 5 reviewers)

```markdown
## Skill Review: {skill_name} — {Reviewer Angle}

### LL Entry Findings
| # | Entry summary | Classification | Evidence | Evidence level |
|---|---|---|---|---|
| 1 | "PIPESTATUS required in tee" | consolidate | Duplicate of shell-scripting LL #3 | reasoning |
| 2 | "CLAUDECODE blocks nesting" | delete | launch-phase.sh L3: `unset CLAUDECODE` | source |

### Proposed Promotions
- "Claude output modes: -p is text-only, interactive doesn't auto-exit."
  → Gotchas section, after "WATCH mode" paragraph

### Skill Body Issues
- Section X references function Y, renamed to Z in commit abc123
- Section W is ~150 tokens, could be ~40 without losing information

### Cross-Skill Observations
- LL #3 duplicates shell-scripting LL about PIPESTATUS

### Suspicious Entries (Adversarial only)
- LL #4: test `test_cascade_with_no_start` only covers None dates,
  not empty strings. Causal reasoning may be incomplete.
```

**Reviewer subagent definition:**
- Model: sonnet (needs reasoning for judgment calls)
- Max turns: 30 (read-heavy, needs to check source files)
- Tools: Read, Grep, Glob, LSP, Bash (read-only — NO Edit, Write, Agent)

### Curator Synthesis

The curator (group agent) receives only findings that scored ≥80 from the
haiku scoring layer. Most noise is already filtered. The curator's job is
to synthesize surviving findings into skill file edits.

**What the curator does:**
1. Reads the scored findings (only those ≥80)
2. For entries with no surviving findings → keep, no action
3. For entries with surviving findings → apply the classification
4. For "wrong" or "suspicious" findings (even at ≥80) → validate first
5. Produces edits to the skill file
6. Commits with evidence from the findings

**Validation subagents (on-demand, spawned by curator):**

| Subagent | When to use | Question type |
|----------|-------------|---------------|
| **Codebase Explorer** | "Does function X exist? Does it do Y?" | Structural — answer is in the code |
| **Rust Scheduler** | "Does CPM/cascade/constraint behave as claimed?" | Domain-specific structural |
| **Verify and Diagnose** | "Does this runtime behavior actually happen?" | Behavioral — needs to run commands |

**Structural vs. behavioral distinction:** Many LL entries describe runtime
behavior (tmux signal handling, pipe exit codes, process stall patterns) that
can't be verified by reading source code alone. The curator should route
these to verify-and-diagnose, which can execute commands and observe results.

Examples:
- "stall detection tracks log file size" → **Codebase Explorer** (structural:
  read `tmux_wait_stage`, confirm it checks file size)
- "C-c doesn't stop claude -p in a pipe" → **Verify and Diagnose** (behavioral:
  requires understanding tmux process signaling, may need to run a test)
- "`cascade_dependents` skips no-start tasks" → **Verify and Diagnose** (behavioral:
  run `cargo test` with a targeted test case to confirm)
- "`unset CLAUDECODE` is on line 3 of launch-phase.sh" → **Codebase Explorer**
  (structural: just read the file)

### Code Review with Curation Checklist

After merge + PR creation, the code-review loop runs with a curation-specific
checklist. This is the cross-skill safety net — the code review sees the full
diff across all skills in one PR.

**Curation review checklist (appended for `skill-curation` label):**
```
This is a skill curation PR. In addition to standard review, check:

1. Cross-skill consistency: if an LL entry was deleted from skill A but a
   duplicate still exists in skill B, flag it.
2. Evidence quality: every deletion must cite a source line, test, or commit.
   Reject deletions backed only by reasoning ("seems outdated").
3. Promoted content: verify promoted text accurately represents the lesson
   and fits the target section. No duplication with existing content.
4. Net token impact: PR should reduce or maintain total instruction tokens.
5. No information loss: if a lesson was the only docs for a non-obvious
   behavior, promote (not delete) even if encoded in code — code doesn't
   explain "why."
6. Wrong classifications: verify corrections are themselves correct.
```

### Strict Code Review Protocol for Curation PRs

Curation changes instruction content that affects all future agent behavior.
The review standard is stricter than normal code PRs.

**Protocol:**
1. Run `/code-review` with the curation checklist on the PR
2. All findings scoring ≥threshold must be addressed. No "low priority, skip."
3. Fix all qualifying findings, commit, push, re-run `/code-review`
4. Loop until EITHER:
   - **Clean review** on the latest commit (no findings ≥threshold) → post final summary
   - **3 full review iterations completed** with findings remaining → stop, post final summary
5. **Agent always posts a final summary** regardless of exit condition

**Final summary format (posted whether clean or max iterations):**
```
### Curation review — final summary

**Status:** [CLEAN after N iterations | MAX ITERATIONS REACHED (3/3)]
**Scoring threshold:** [current value from threshold.txt]
**Merge readiness:** [Ready for human review | Needs human review — unresolved findings]

All findings across all iterations:
| # | Finding | Score | Status | Iteration |
|---|---------|-------|--------|-----------|
| 1 | description | 85 | Fixed (iteration 1) | 1 |
| 2 | description | 92 | Fixed (iteration 2) | 1 |
| 3 | description | 78 | Below threshold — not addressed | 2 |
| 4 | description | 88 | Unresolved — max iterations | 3 |

Unresolved findings (if any):
- [full detail with evidence for each]
```

**Why always post the final summary:**
- Clean exit: user sees what was found and fixed, confirms quality
- Max iterations: user sees exactly what remains and can continue under supervision
- Both cases: full finding history with scores gives the user context for
  threshold calibration decisions

**If max iterations reached:**
- Agent labels the PR `needs-human-review`
- Human reviews remaining findings and either fixes or approves with commentary
- Human may continue the review-fix loop under supervision

### How Prompts Improve Over Time

Unlike task-specific phase prompts, curation prompts are permanent and reusable.
They improve through the same mechanism they docs:

1. **After each curation pass**, agents add Lessons Learned to a `curation` skill
   (e.g., "adversarial reviewer missed X because the prompt didn't instruct it
   to check test files")
2. **Next curation pass** curates the curation skill itself — and the curator
   reads the updated prompts with improvements baked in
3. **Code review findings** on curation PRs identify systematic prompt weaknesses
   (e.g., "3 of 6 skills had cross-skill dupes that reviewers missed — scope
   reviewer prompt needs to be more explicit about checking LL sections")
4. **Prompt refinements are commits** — tracked in git history, reviewable,
   revertible. The prompts accumulate operational knowledge the same way
   skills do, but they're templates rather than documentation.

This creates a feedback loop: curation quality improves each pass because the
prompts encode lessons from previous passes. The prompts are the institutional
memory of how to curate well.

### Parallel with Code Review Plugin

| Code Review Plugin | Skill Curation |
|---|---|
| 5 parallel reviewers | 5 parallel reviewers per skill |
| Each checks a distinct aspect | Each checks a distinct angle |
| Confidence threshold (80) | Evidence hierarchy |
| Consolidated into one PR comment | Consolidated into skill edits via consensus matrix |
| Review-fix loop (max 3 iterations) | Strict loop: all non-false-positive findings addressed, max 3 iterations, full findings posted every round |
| `classify_pr()` routes light vs full | LL entry count routes skip vs review |
| Plugin handles parallelization | Curator spawns subagents in parallel |
| Read-only reviewers, one fix agent | Read-only reviewers, one curator writes |
| PR as audit trail | PR with reviewer reports in collapsible sections |
| Fixed prompts per aspect | **Reusable, improving prompts per angle** |

**Where curation differs:**
- **Multiple orchestrators** — one curator per skill (each needs deep domain context)
- **Validation subagents** — curator can escalate to specialists for disagreements
- **Adversarial reviewer** — unique to curation; wrong lessons are uniquely damaging
- **Prompt improvement loop** — curation prompts improve over time; code review prompts
  are fixed by the plugin

### Initial LL Cleanup

Before switching to the debrief model, ALL existing LL entries need one cleanup
pass — this is a system migration, not selective maintenance. Every skill gets
reviewed regardless of entry count so we start clean.

**Current state (2026-03-17):**

| Skill | LL entries |
|---|---|
| multi-agent-orchestration | 20 |
| shell-scripting | 5 |
| scheduling-engine | 5 |
| issue-workflow | 4 |
| hooks | 3 |
| e2e-testing | 2 |
| cloud-deployment | 0 |
| google-sheets-sync | 0 |
| rust-wasm | 0 (absorbed into scheduling-engine) |

Total: 39 entries across 6 skills (3 skills have 0 LL entries).
After rust-wasm absorption: 8 skills to curate going forward.

**The initial cleanup is run manually** — same skill reviewer prompts,
invoked directly by an agent (like running `/code-review` on a file).
No launch-phase infrastructure needed. No bootstrap config or variant prompt.

**This is also how we test the reviewer prompts.** Design the prompts, run
them manually on a real skill, see the output, refine. Once the prompts
work well, wire them into the launch config for automated runs.

**Cleanup strategy:**
1. **Pass 1: multi-agent-orchestration only.** 20 entries, most diverse
   entry types, best test case for all 5 reviewer angles. Agent invokes
   the skill review process directly. Use findings to refine prompts.
2. **Pass 2: remaining 5 skills.** 19 entries total. Run with refined prompts.
3. **After cleanup:** switch CLAUDE.md to debrief model (step 11). LL sections
   frozen — curation pipeline is the only writer going forward.

**Implementation order:**
1. Design reviewer prompts (testable immediately, no infrastructure needed)
2. Test on multi-agent-orchestration (manual invocation)
3. Refine prompts based on results
4. Clean remaining skills (manual invocation with refined prompts)
5. Build launch-phase infrastructure (`agent.sh` prompt field, `curate-skills.sh`)
6. Switch to automated curation via launch config

**After the initial cleanup,** ongoing curation is triggered by feedback
report volume (monthly baseline + reminder hook), not LL entry count.

### Triggers

| Trigger | Scope | Rationale |
|---------|-------|-----------|
| Monthly baseline | All skills with feedback reports | Prevents staleness, keeps process familiar |
| Reminder hook fires (10+ reports or oldest >30d) | All skills with feedback reports | Accelerate during busy periods |
| `/curate-skills` | All skills (or named skill) | Manual trigger |

Named skill override: `/curate-skills scheduling-engine` runs curation on that skill
specifically. Useful when you know an observation needs validation.

### Scoring: Three-Layer Validation (Code-Review Plugin Architecture)

The code-review plugin source (`anthropics/claude-plugins-official`) reveals
a three-layer architecture we should adopt:

1. **5 parallel sonnet reviewers** produce findings with evidence
2. **Parallel haiku scorers** independently validate each finding (0-100)
3. **Filter at threshold 80** — only high-confidence findings survive

This separates advocacy (reviewers find issues) from validation (scorers
verify the evidence holds up). More robust than self-scoring.

**Layer 1: Reviewer findings.** Each of the 5 sonnet reviewers produces
classifications with evidence. Same angles as designed: accuracy, structure,
scope, history, adversarial.

**Layer 2: Independent haiku scoring.** For each finding from Layer 1,
spawn a parallel haiku agent with: the finding, the SKILL.md, the
referenced source files, and this rubric (given to the scorer verbatim):

```
Score this skill curation finding on a scale from 0-100:

0:  Not confident at all. False positive that doesn't stand up to light
    scrutiny, or describes pre-existing behavior that hasn't changed.
25: Somewhat confident. Might be real, but scorer couldn't verify the
    reviewer's evidence. If stylistic, not called out in skill docs.
50: Moderately confident. Real finding but might be a nitpick — entry
    is verbose or imprecise but not actively misleading.
75: Highly confident. Scorer double-checked and verified this is a real
    issue. The entry is wrong, stale, redundant (encoded in code), or
    clearly belongs in a different skill. Evidence directly supports
    the classification.
100: Absolutely certain. Scorer confirmed with a specific source line,
     test result, or git commit. No ambiguity.
```

**False positive examples (given to scorers):**
```
These are NOT real issues — score 0 or 25:
- Entry was true when written but code has since changed (stale not wrong)
- Entry is verbose but factually correct (compress, don't delete)
- Entry duplicates another skill but adds domain-specific context
- Entry describes a workaround still valid even if root cause was fixed
- Entry is obvious to an expert but valuable for onboarding
- Entry describes runtime behavior that can't be verified by reading
  source alone (reviewer may be guessing — needs behavioral test)
- Entry is in the wrong skill but the content is correct (move, not delete)
```

**Layer 3: Filter at threshold.** Only findings scoring at or above the
threshold reach the curator. This eliminates noise before the
curator spends turns on synthesis.

**Threshold is stored in `docs/prompts/curation/threshold.txt`** — a single
integer (e.g., `80`). Read by the curator prompt at runtime. Changed
by editing one file — no prompt rewrites needed.

**Initial value: 70** for the first pass. Haiku scorers lack source file
access, so they can't independently verify evidence — scores cluster at 75
("verified real issue, evidence supports classification") rather than 100
("confirmed with source line"). Starting at 70 avoids over-filtering on the
first run. Calibrate upward based on threshold calibration data in the PR.

Calibrated after each pass using this concrete process:

**After each curation pass, the curator's debrief report must include:**
```yaml
observations:
  - type: threshold_calibration
    summary: "Threshold evaluation for this pass"
    scored_below_threshold:
      count: N           # findings that scored 60-79
      real_issues: N     # of those, how many were real issues (checked by curator)
      examples: ["..."]  # 1-2 specific findings that were real but filtered out
    scored_above_threshold:
      count: N           # findings that scored 80+
      false_positives: N # of those, how many were false positives (found during synthesis)
      examples: ["..."]  # 1-2 specific false positives that wasted curator time
    recommendation: "lower to 75" | "keep at 80" | "raise to 85"
```

**Threshold adjustment rules:**
| Condition | Action |
|---|---|
| >20% of below-threshold findings were real issues | Lower threshold by 5 |
| >20% of above-threshold findings were false positives | Raise threshold by 5 |
| Both conditions met | Keep current (conflicting signals — needs investigation) |
| Neither condition met | Keep current (threshold is well-calibrated) |
| Minimum threshold: 60 | Never go below — too much noise |
| Maximum threshold: 90 | Never go above — too many real issues filtered |

**How the user sees this data:** The agent creating the PR reads all
curator debrief reports (committed to their branches, visible after
merge) and includes a threshold calibration summary in the PR description:

```
### Threshold Calibration
Current threshold: 80

| Skill | Below real issues | Above false positives | Recommendation |
|---|---|---|---|
| scheduling-engine | 1/4 (25%) | 0/7 (0%) | Lower to 75 |
| hooks | 0/1 (0%) | 0/3 (0%) | Keep at 80 |
| multi-agent-orchestration | 0/2 (0%) | 1/12 (8%) | Keep at 80 |
```

The user sees this in every curation PR. If adjustment is warranted, edit
`threshold.txt` before the next run. The threshold never changes
automatically — it's a human decision informed by data.

**Curator receives only validated findings:**

| Filtered findings per entry | Action |
|---|---|
| Multiple findings agree (scored ≥threshold) | Act — strong signal |
| Single finding (scored ≥threshold), others silent | Act cautiously — cite in commit |
| No findings scored ≥threshold | Keep — no action needed |
| Any "wrong" finding scored ≥threshold | Validate with subagent before acting |
| Adversarial "suspicious" scored ≥threshold | Validate with subagent before acting |

**Why adopt this architecture:**
- Independent validation catches reviewer overconfidence
- Haiku scorers are cheap — many run in parallel at low cost
- Separating advocacy from validation prevents reviewers from both
  finding and confirming their own issues
- The false positive list gives scorers explicit calibration
- Threshold is data-driven and adjustable, not hardcoded

**Full curation flow:**
```
1. Haiku: summarize skill's current LL entries + feedback reports
2. 5 parallel Sonnet reviewers: produce findings per angle
3. Parallel Haiku scorers: score each finding (0-100)
4. Filter: drop findings scoring below threshold (from threshold.txt)
5. Curator: synthesize surviving findings, edit skill file
6. Curator: write debrief with threshold calibration data
7. (After all skills) Code review loop on PR
8. User reviews threshold recommendation, adjusts if warranted
```

### Guardrails

- Reviewers are read-only subagents — cannot damage skill files
- Curators edit only their own skill — scoped by launch-phase group
- All edits go through PR with code review — human approves before merge
- Every deletion must cite evidence (no "seems outdated" deletions)
- Net token delta must be negative or neutral per PR
- `[reviewed: keep]` tag on LL entries prevents future re-flagging
  (set by human during PR review if they disagree with a deletion)
  Format: appended inline to the LL entry, e.g.:
  `- 2026-03-05: Cascade skips no-start tasks. [reviewed: keep]`
  Reviewer prompts must instruct: "Skip entries ending with `[reviewed: keep]`."
  Curator prompt must instruct: "Do not modify or delete `[reviewed: keep]` entries."
  Note: `[reviewed: keep]` tags have no automatic expiry. If code changes
  later invalidate a kept entry, a human must manually remove the tag before
  the curation pipeline can act on it. This is intentional — the tag
  represents a human judgment that should only be overridden by a human.
- Curation prompts are versioned in git — bad prompt changes are revertible

### Feedback Loop: How Curation Improves Itself

Curation learning flows through the same feedback pipeline as everything else.
No special-casing — curators write debrief reports to `feedback/`, and
the curation skill gets curated alongside domain skills.

#### Sources of learning → debrief reports

| Source | What the curator observes | Debrief `files` reference |
|---|---|---|
| Reviewer blind spots | An angle consistently misses a type of issue | `.claude/agents/skill-reviewer.md` |
| Scoring miscalibration | Real issues filtered out, false positives let through | `docs/prompts/curation/threshold.txt` |
| Validation subagent gaps | Codebase explorer can't answer orchestration questions | `.claude/agents/codebase-explorer.md` |
| Code review findings | Systematic issues the reviewers missed | `docs/prompts/curation/curator.md` |

Curators write these as standard debrief reports with `files` referencing
the curation prompts. They accumulate in `feedback/processed/` (since they're
written during a curation pass, they're processed immediately for skill changes
but preserved for future prompt curation).

#### How prompt improvements happen (v1)

For now, prompt improvements are manual. The curator debrief reports
surface prompt weaknesses (via threshold calibration data, reviewer blind
spots, etc.). The user reads these in the PR description and edits prompts
directly before the next pass.

Debrief reports referencing `docs/prompts/curation/*.md` accumulate in
`feedback/processed/`. When curation is expanded to cover prompts and
CLAUDE.md files (future direction), this backlog provides the input for
the first prompt curation pass.

#### Prompt versioning

Curation prompts live in `docs/prompts/curation/` and are versioned in git.
Changes go through the same PR + strict code review as skill edits.
Revertible if a prompt change causes bad curation in a subsequent pass.

#### New skill: `.claude/skills/curation/SKILL.md`

**Initial content structure:**
```yaml
---
name: curation
description: "Skill curation process — reviewer angles, scoring, debrief reports, prompt maintenance"
type: process
---
```
Sections:
- Overview: what curation is, when it runs, the three-layer architecture
- Running curation: `./scripts/curate-skills.sh` (automated) or manual invocation
- 5 reviewer angles: brief description of each (detail in the angle prompt files)
- Scoring: rubric summary, threshold, false positive list
- Debrief reports: schema reference, filename convention, where they go
- Gotchas: (empty initially, populated by curation pipeline from feedback)
- Lessons Learned: (managed by curation pipeline, not direct edits)

#### Bootstrapping

The first curation pass has no prior learning — the prompts are initial drafts.
The initial cleanup is run manually (same prompts, direct invocation) which
makes iteration fast: run, review output, refine prompt, run again.

- **Pass 1 will be imperfect.** Some classifications will be wrong, the
  adversarial reviewer will be miscalibrated. This is fine — manual invocation
  means you see the raw output immediately and refine before the next skill.
- **Don't over-engineer prompts before Pass 1.** Write reasonable initial
  prompts, run on multi-agent-orchestration, learn from the output. The
  manual iteration loop is the optimization mechanism.
- **multi-agent-orchestration is the test case.** 20 entries, most diverse
  entry types, best case for all 5 reviewer angles + scoring layer.
  Refine prompts here before running on the other 5 skills.
- **Infrastructure comes after prompts are validated.** The `agent.sh` prompt
  field, `curate-skills.sh`, and launch config are only built after the
  reviewer prompts produce good results on manual runs.

### Structured Collection: Agent Debrief Reports

Currently LL entries are ad-hoc — CLAUDE.md says "append confirmed gotchas" but
there's no structure around what to report or when. Many insights are lost, quality
varies, and wrong lessons go directly into skill files. With the curation pipeline
handling quality control downstream, we can formalize collection upstream.

**The change:** implementing agents stop writing directly to SKILL.md LL sections.
Instead, they write a short structured debrief report to `docs/prompts/curation/feedback/`.
The curation pipeline processes these reports and promotes validated findings into
skill files.

| Current | Proposed |
|---|---|
| Agent appends directly to SKILL.md LL | Agent writes debrief to feedback/ |
| Ad-hoc, optional, unstructured | Prompted, consistent, structured |
| Immediately in agent context (token cost) | Out of context until curation processes it |
| No quality gate before entering skill | Curation validates before promoting |
| Wrong lessons go straight into skill file | Wrong lessons caught before they mislead |

**Debrief template file: `docs/prompts/curation/debrief-template.md`**

A permanent, version-controlled template that agents read when prompted. Contains
the structured format, observation types, examples, and instructions.

Agents are directed to this file by the verify hook (see "Encouraging agents"
below) and by a one-line instruction in phase/issue prompts:
"Before finishing, read `docs/prompts/curation/debrief-template.md` and write
your report."

The template improves alongside reviewer prompts — if curation finds that agents
are writing low-quality debriefs (too vague, unverified claims), the template's
examples and instructions get refined.

**Filename convention:** `YYYY-MM-DD-{branch-name}.md` (e.g., `2026-03-17-agent-issue-42.md`).
Date prefix is required — `curate-skills.sh` sorts by filename for oldest-first selection.
The `debrief-template.md` must specify this format.

**Debrief schema:**

```yaml
---
date: 2026-03-17
agent: agent/issue-42
task: "Add FF dependency support to cascade"
commits:
  first: abc1234   # agent's first commit on its branch
  last: def5678    # agent's last commit on its branch
---

observations:
  - type: undocumented_behavior
    summary: "cascade_dependents silently skips tasks with no start date"
    evidence: "Read cascade.rs:47 — early return on None with no log/error"
    files: ["crates/scheduler/src/cascade.rs"]

  - type: wrong_documentation
    summary: "scheduling-engine skill says ES from deps only, but cascade reads stored dates"
    evidence: "cascade.rs:63 reads task.start_date, contradicting skill line 8"
    files: ["crates/scheduler/src/cascade.rs", ".claude/skills/scheduling-engine/SKILL.md"]

  - type: unexpected_result
    summary: "addBusinessDays(Monday, 5) returns Saturday not Friday"
    evidence: "node -e 'addBusinessDays(parseISO(\"2026-03-02\"), 5)' → 2026-03-07"
    files: ["src/utils/dateUtils.ts"]
```

**nothing_to_report example** (explicit skip — so verify hook knows agent didn't forget):
```yaml
---
date: 2026-03-17
agent: agent/issue-43
task: "Fix typo in relay error message"
commits:
  first: aaa1111
  last: aaa1111
---

observations:
  - type: nothing_to_report
```

**Frontmatter fields:**

| Field | Required | Purpose |
|---|---|---|
| `date` | Yes | Staleness detection (reminder hook checks age) |
| `agent` | Yes | Traceability — reviewer can check git log for this branch |
| `task` | Yes | Context — what was the agent trying to do? (one line) |
| `commits.first` | Yes | Agent's first commit on its branch — reviewers use `git log first..last` (isolated per-worktree branch, no cross-agent contamination) |
| `commits.last` | Yes | Agent's last commit — reviewers use `git diff first..last -- <file>` to correlate observations with actual changes |

**Observation types (enum):**

| Type | What it captures | Primary reviewer angle |
|---|---|---|
| `undocumented_behavior` | Behavior not covered by any skill or docs | Accuracy, Structure |
| `wrong_documentation` | Existing docs/skills contradict actual behavior | Adversarial, Accuracy |
| `unexpected_result` | Function/tool produced surprising output | Adversarial, Accuracy |
| `workflow_gap` | Missing tooling, awkward process, friction | Structure |
| `nothing_to_report` | Explicit skip (debrief check distinguishes "forgot" from "nothing") | — |

**Per-observation fields:**

| Field | Required | Purpose |
|---|---|---|
| `type` | Yes | Parsable classification — reviewers can filter by type |
| `summary` | Yes (except nothing_to_report) | One-line description |
| `evidence` | Yes (except nothing_to_report) | How the agent verified this — source file:line, test, command |
| `files` | Yes (except nothing_to_report) | Referenced files — scope reviewer uses for skill mapping |
| `outcome` | No (written by orchestrator after curation) | Per-observation disposition: status, action/reason, pass date |
**Why structured YAML over prose:**

- **Parsable by curator.** Pre-process before spawning reviewers: count
  by type, summarize for reviewer context, assess volume.
- **Richer hook stats.** "12 reports: 5 undocumented, 4 wrong docs, 3 gaps"
  instead of just "12 reports pending."
- **`files` field helps reviewers assess relevance.** Reviewers can quickly
  see which source files an observation references. Supports future pre-filtering
  if volume grows, but currently all reviewers see all reports.
- **`commits` field saves reviewer turns.** History reviewer runs
  `git log first..last` instead of searching. Adversarial reviewer checks
  `git diff first..last -- <file>` to see what the agent actually changed
  vs. what it claims to have observed.
- **`nothing_to_report` is explicit.** Verify hook distinguishes "agent forgot"
  (no file) from "agent had nothing" (file with nothing_to_report). Only
  the former triggers the reminder.
- **Self-documenting types.** The enum tells agents exactly what categories
  to think about, replacing open-ended questions.

**How feedback maps to skills:**

Every curator sees all reports in the batch (max 20). The `files` field
helps reviewers determine relevance, but there is no automated pre-filtering —
observations don't always map cleanly to one skill by file path (e.g., a
`dateUtils.ts` observation might belong to scheduling-engine, not the frontend
skill). The scope reviewer determines which observations belong to its skill;
the other reviewers focus on observations they recognize as relevant.

At 20 reports × ~75 tokens = ~1500 tokens, this is manageable context per
reviewer. If volume grows to where this becomes a problem, file-path-based
pre-filtering can be added to `curate-skills.sh` as an optimization — the
`files` field in the schema supports it. But not now: the risk of misrouting
observations outweighs the context savings.

### Report Volume Management

**Estimated volume based on recent phases:**

| Phase | Groups | Est. reports |
|---|---|---|
| phase14 | 6 | 3-4 |
| phase15 | 4 | 2-3 |
| phase15b | 3 | 1-2 |
| phase15b-recs | 3 | 2-3 |
| phase16-date-fixes | 9 | 5-7 |
| phase16c | 4 | 2-3 |
| phase17-datecalc | 5 | 3-4 |

~60-70% of agent sessions produce at least one observation. Heavy phases
(9 groups) can produce 5-7 reports alone.

**Quarterly projection:**

| Development pace | Reports/quarter |
|---|---|
| Light (1 phase/month, ~4 groups) | 6-9 |
| Normal (2 phases/month, ~5 groups) | 18-21 |
| Heavy (3 phases/month, ~7 groups) | 36-45 |

**Cap: 20 reports per iteration.** The `/curate-skills` agent loops over
the same single-stage launch config, processing 20 reports per iteration.

**Execution: `launch-phase.sh skill-curation.yaml all`**

Curation runs as a standard launch-phase pipeline — stage, merge, validate,
create-pr — in one command. No custom orchestration script needed beyond a
thin prep script that runs the pipeline and moves processed reports.

```
/curate-skills:
  1. Agent runs: ./scripts/curate-skills.sh
     - Runs: launch-phase.sh (stage → merge → validate)
     - Curators read feedback/ directly (oldest 20 per prompt)
     - Script moves processed reports to feedback/processed/ after pipeline
  2. Agent reads curator commit messages from merge branch:
     - git log on merge branch for per-observation outcomes
     - Extracts: acted/rejected/preserved per observation
     - Collects threshold calibration data from curator debriefs
  3. Agent writes outcome fields into processed report files:
     - Reads each report in feedback/processed/
     - Adds `outcome` (status, action/reason, pass date) per observation
     - Commits updated reports (audit trail lives in the report itself)
  4. Agent rebases merge branch on main and re-verifies before PR:
     - `git fetch origin && git rebase origin/main` in the merge worktree
     - Re-run `./scripts/full-verify.sh` if rebase had conflicts
  5. Agent creates PR with:
     - skill-curation label
     - Per-skill summary (what changed, what was rejected, why)
     - Per-observation outcome table
     - Threshold calibration summary
  6. Agent runs strict code review loop (max 3 iterations)
  7. Agent posts final summary (clean or max-iterations-reached)
  8. Agent writes its own debrief report to feedback/:
     - Cross-skill observations (patterns across curators)
     - Threshold calibration recommendation (from aggregated data)
     - Code review findings and what they revealed about curation quality
       (what reviewers/scorers missed that code review caught)
     - Fixes made during the review loop (what was wrong and how it was fixed)
     - Process observations (curator failures, parsing issues, timing)
  9. If reports remain in feedback/, reminder hook prompts for next run
```

**See `scripts/curate-skills.sh` for the implementation.** Key behaviors:
- Sets `_USER_MERGE_TARGET` to a date-stamped branch
- Runs `launch-phase.sh` stage → merge → validate
- Curators read `feedback/` directory directly (no manifest needed —
  feedback reports are committed files visible in all worktrees)
- After pipeline, script moves oldest 20 processed reports to `processed/`
- On partial failure, generates retry config with only failed groups

echo "[curate] Done. Agent should create PR and run code review."
```

**What the script guarantees:**
- Correct oldest-first selection (date-prefixed filenames)
- Manifest matches exactly what gets processed
- Processed reports moved only after successful pipeline
- Template file excluded from selection
- Remaining reports stay for next run (reminder hook will prompt)

**What the agent does:**
- Invoke the script
- Handle failures (see below)
- Create PR with curation label, per-skill summaries, token delta
- Run strict code review loop (see below)
- Inform user when PR is ready or when max iterations reached

**If more than 20 reports exist:** the script processes the oldest 20 and
the remainder stays in `feedback/`. The reminder hook surfaces this in the
next session. Run `/curate-skills` again — same config, same prompts,
different `_USER_MERGE_TARGET`. Each run is a complete pipeline invocation, reusable
with zero changes.

**Failure modes and recovery:**

| Failure | State left behind | Agent action |
|---|---|---|
| Stage fails (one or more curators) | Reports still in `feedback/`. Per-group logs in `logs/`. | Run `launch-phase.sh ... status` to see which groups failed. Read failed group's log to understand why. Fix if possible and retry, or proceed with partial success. |
| Merge fails | Branches exist but not merged. Reports still in `feedback/`. | Agent can retry: `launch-phase.sh ... merge 1` |
| Validate fails | Merged but validation caught issues. | Agent fixes issues in merge worktree, re-runs validate. |
| Pipeline succeeds, move fails | Some reports still in `feedback/`, some in `processed/`. | Agent moves remaining reports from `feedback/` to `processed/` manually. |
| Code review finds issues | PR exists. | Strict review loop per protocol above. |

**Partial failure recovery:**

On stage failure, `curate-skills.sh` generates a retry config
(`/tmp/skill-curation-retry.yaml`) containing only the failed groups.
The agent's recovery flow:

1. Read script output — it shows failed groups and diagnostic commands
2. Run `launch-phase.sh ... status` to see per-group pass/fail, then read
   log files directly: `tail -50 logs/skill-curation/<group>.log`
3. Identify the cause (see common failures below)
4. Fix the issue (edit prompt, adjust threshold, fix skill file structure)
5. Retry with failed groups only: `launch-phase.sh retry-config stage 1`
6. Merge with original config: `launch-phase.sh original-config merge 1`
   (this merges ALL branches — the successful ones from the original run
   plus the newly-successful retry branches)
7. Validate: `launch-phase.sh original-config validate`

The retry config is generated by `scripts/generate-retry-config.sh`, which
reads `launch-phase.sh ... status` output, identifies failed group IDs, and
extracts their config entries from the original YAML. Same `merge_target`,
same `prompt` fields — just fewer groups.

**Common failure causes:
   - Curator ran out of turns (30 max) — too many validation
     subagent escalations. Fix: raise turn limit or lower threshold.
   - Reviewer subagent produced unparseable output — curator
     couldn't build findings. Fix: refine reviewer prompt.
   - Skill file had unexpected structure — curator couldn't
     locate LL section. Fix: check skill file format.
   - No feedback reports relevant to this skill — curator
     exited early. Not a failure; expected for skills with no
     relevant observations in this batch.

**Recovery principle:** Reports stay in `feedback/` until the script moves
them to `processed/` after a successful pipeline. On failure, nothing is
lost — reports are still where they were. Partial work is always valuable —
proceed with whatever succeeded, note failures in the PR.

**No pre-filtering.** Every curator sees all reports in the batch
(max 20 × ~75 tokens = ~1500 tokens). Scope reviewer determines relevance.

**The launch config and all prompts are fully static and reusable.** The
only variable between runs is `_USER_MERGE_TARGET` (date-stamped branch)
and the contents of `feedback/` (which reports are pending).

**Cadence:**
- **Baseline: monthly.** Run curation once a month regardless of volume.
  This prevents staleness even during quiet periods and keeps the process
  familiar. Some passes will process only 2-3 reports — that's fine, the
  pass is cheap when volume is low.
- **Accelerate when busy.** During heavy development (multiple phases/month),
  the reminder hook fires sooner (10-count threshold). Run curation when
  prompted rather than waiting for the monthly cadence.
- **Cap per pass: 20 reports.** If more than 20 are pending, process oldest
  20. Remaining carry over. This keeps reviewer context bounded and means
  heavy months just get two passes instead of one bloated one.

**Encouraging agents to write reports:**

The debrief prompt says "write a report before finishing" but agents skip
optional-sounding steps under pressure. Three reinforcement mechanisms:

1. **`full-verify.sh` check.** Before PR creation, check whether the agent's
   worktree has produced a feedback report. If not, print:
   ```
   [curation] No debrief report found for this session.
   Read docs/prompts/curation/debrief-template.md and write your report.
   ```
   One line, points to the template. The agent reads the file (which has
   format, questions, and examples), writes the report. Non-blocking —
   some sessions have nothing to report.

2. **Phase group prompts.** The curator prompt template includes the
   debrief step explicitly as the final task, not a postscript. Phrased as
   a required step with a skip condition rather than an optional step:
   "Write a debrief report. If you have no observations, write a report
   with `nothing to report` in the body."

3. **Issue workflow skill.** The issue-workflow skill's verification checklist
   adds "debrief written or explicitly skipped" as a step alongside
   "full-verify.sh passed" and "PR created."

The `full-verify.sh` check is the primary mechanism — it catches agents that
forget, regardless of which prompt or workflow they're running. The prompt
and skill additions are belt-and-suspenders.

**Lifecycle of a debrief report:**
1. Implementing agent writes report to `feedback/`
2. Report accumulates (out of all agents' context — no token cost)
3. `curate-skills.sh` runs launch-phase pipeline
4. Curator reads feedback/ directory, spawns 5 reviewers on oldest 20 reports
5. Reviewers classify observations; curator synthesizes + edits skill
6. `curate-skills.sh` moves processed reports to `feedback/processed/`
7. PR created; strict code review loop validates edits

**Per-observation outcomes are in the curator's commit message.**
The curator lists what it did with each observation it reviewed:

```
docs: scheduling-engine skill

Observations processed (from 2026-03-17-agent-issue-42.md):
  #1 undocumented_behavior "cascade skips no-start tasks"
     → acted: promoted to Gotchas section
  #2 wrong_documentation "skill says ES from deps only"
     → rejected: cascade.rs refactored in abc123, no longer reads stored dates

Observations processed (from 2026-03-16-agent-issue-41.md):
  #1 workflow_gap "adversarial prompt too vague"
     → preserved: references curation prompts (future scope)
```

The agent creating the PR summarizes all curator commit messages into
the PR description. The human reviewer sees per-observation dispositions
in the PR body. If a rejection was wrong, flag it during PR review.

**Outcome statuses (used in commit messages):**
- `acted` — observation promoted to skill body/LL, or used to edit skill
- `rejected` — disproven, irrelevant, or below threshold (reason required)
- `preserved` — relevant to future curation scope (reason required)

The orchestrating agent writes `outcome` fields back into processed report
files after reading curator commit messages. Each processed report is
a self-contained audit trail — the original observation plus what happened
to it. The PR description summarizes these, but the reports in `processed/`
are the authoritative record.

**This replaces direct LL writes.** The CLAUDE.md instruction changes from
"append confirmed gotchas to skill Lessons Learned" to "write debrief to
feedback/ directory." The LL section becomes write-only by the curation
pipeline, not by individual agents. This is the key quality gate — no
unvalidated content enters skill files.

### Prompt Observations via Feedback Reports

Curation curators write debrief reports after each pass, same as any
implementing agent. These go to `feedback/` with `files` referencing
`docs/prompts/curation/*.md` when the observation is about prompt quality.

There is no recursion or separate "prompt curation" level. All debrief
reports — from implementing agents, from curators, from anyone — go
through the same flat pipeline:

```
All agents (implementing + curation) → feedback/ → curate-skills.sh → skill edits
                                                 ↘ processed/ (preserved for future scope)
```

Reports about prompt quality (`files` referencing `docs/prompts/curation/*`)
are preserved in `processed/` but not acted on in v1. The user reads
curator debriefs in the PR description (including threshold calibration
data) and manually refines prompts before the next pass.

When prompt curation is added (future direction), those accumulated reports
in `processed/` become the input for the first prompt curation pass — no
observations lost.

### Reminder Hook: When to Curate

Feedback reports are small (~75 tokens each) but their value decays — a report
referencing code from 3 months ago may describe behavior that's since changed.
The user needs a nudge before reports pile up or go stale.

**Implementation: `scripts/check-curation.sh`**

A standalone script called from both `verify.sh` and `full-verify.sh`. Counts
reports and checks oldest age. Prints reminders when thresholds are crossed.

```bash
#!/usr/bin/env bash
# Check curation feedback accumulation — called from verify.sh and full-verify.sh

FEEDBACK_DIR="docs/prompts/curation/feedback"
COUNT_THRESHOLD=10
AGE_THRESHOLD_DAYS=30

# Count reports (exclude template and processed/)
count=$(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" 2>/dev/null | wc -l)

if [ "$count" -ge "$COUNT_THRESHOLD" ]; then
  echo "[curation] $count feedback reports pending (oldest: $(
    find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" -not -name "debrief-template.md" \
      -printf '%T@\n' 2>/dev/null | sort -n | head -1 | \
      xargs -I{} bash -c 'echo $(( ($(date +%s) - ${1%.*}) / 86400 ))d' _ {}
  ))."
  echo "ACTION: Inform the user that /curate-skills should be run."
  echo "Do NOT run curation yourself — this requires user authorization."
  exit 0
fi

# Check oldest report age even if count is below threshold
oldest=$(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
    -not -name "debrief-template.md" -printf '%T@\n' 2>/dev/null | sort -n | head -1)
if [ -n "$oldest" ]; then
  now=$(date +%s)
  age_days=$(( (now - ${oldest%.*}) / 86400 ))
  if [ "$age_days" -ge "$AGE_THRESHOLD_DAYS" ]; then
    echo "[curation] Oldest feedback report is ${age_days}d old ($count reports pending)."
    echo "ACTION: Inform the user that /curate-skills should be run."
    echo "Do NOT run curation yourself — this requires user authorization."
  fi
fi
```

**Thresholds:**

| Threshold | Value | Rationale |
|-----------|-------|-----------|
| Count: 10 reports | ~750 tokens | Enough material for meaningful curation, before reviewer context cost grows |
| Age: 30 days oldest | — | Beyond 30 days, referenced code likely changed; observations may be stale |

**Why 10, not 6:** 6 is the minimum to curate a single skill. But feedback reports
aren't pre-sorted by skill — the reviewers determine relevance. With 10 reports,
there's likely enough density for at least one skill to have meaningful input, and
the nudge comes before staleness degrades the oldest reports.

**Implementation: persistent agent-to-user reminder.**

Add `scripts/check-curation.sh` that counts reports and checks age. Integrate
it in two places so agents see it repeatedly:

1. **`full-verify.sh`** — runs during verification, agent sees it at PR time
2. **`verify.sh` (PostToolUse)** — runs after every Edit/Write, agent sees it
   throughout its session

The reminder text is crafted so agents relay the message rather than act on it:

```
[curation] 12 feedback reports pending (oldest: 45d).
ACTION: Inform the user that /curate-skills should be run.
Do NOT run curation yourself — this requires user authorization.
```

**Why this works:** Agents treat hook output as system-level guidance (same
mechanism that makes guard block messages work). The explicit "inform the user"
+ "do NOT run this yourself" instruction causes agents to relay the message
every session. The user keeps hearing about it until they run curation.

**Why two integration points:**
- `verify.sh` fires after every edit — agents see the reminder mid-session
  and can mention it naturally ("by the way, there are 12 pending curation
  reports")
- `full-verify.sh` fires at PR time — last chance before the agent finishes
  its work, guarantees the user hears about it in the PR summary

**Rate limiting:** `verify.sh` already has a 30-second cooldown. The curation
check is a fast `find | wc -l` — negligible overhead. Only prints when
thresholds are crossed, so it's silent when there's nothing to report.

The user runs `/curate-skills` when ready — monthly or when the reminders
get frequent enough to act on. Thresholds are easy to adjust in the script.

### Skill Reorganization: Domain-First, Not Technology-First

The dependency problem (scheduling-engine needs rust-wasm, orchestration needs
shell-scripting) is a symptom of skills organized by technology instead of by
what the agent is trying to accomplish.

**Current organization (mixed):**
```
Domain skills (self-contained):
  scheduling-engine, hooks, e2e-testing, google-sheets-sync, cloud-deployment

Technology skills (cross-cutting, create dependencies):
  rust-wasm, shell-scripting

Workflow skills (process-oriented):
  issue-workflow, multi-agent-orchestration
```

No agent's primary task is "write bash" or "build WASM." These are always in
service of a domain task. Technology skills are cross-cutting concerns masquerading
as standalone skills — the same anti-pattern as organizing code by technical layer
(controllers/services/repositories) instead of by feature.

**Reorganization:**

#### Absorb rust-wasm into scheduling-engine

rust-wasm has exactly one consumer. An agent working on the scheduler needs build
commands, wasm-bindgen patterns, and debugging tips — that's part of "working on
the scheduler," not a separate concern.

| Currently in rust-wasm (43 lines) | Moves to scheduling-engine |
|---|---|
| Build command (`npm run build:wasm`) | Commands section |
| wasm-pack options | Build & Debug section (new) |
| wasm-bindgen patterns | Patterns section |
| Generated files layout | Architecture section |
| Debugging wasm-pack | Build & Debug section |
| How lib.rs exports work | Architecture section |

The scheduling-engine skill grows by ~40 lines but becomes fully self-contained.
The rust-wasm skill is deleted. The skill trigger that currently invokes rust-wasm
("when building WASM, debugging wasm-pack, or modifying Rust→JS bindings") becomes
a trigger for scheduling-engine.

#### Keep shell-scripting as a recognized utility skill

shell-scripting has many consumers (orchestration, hooks, e2e, deployment). A utility
skill serving N domains is legitimate — it's like a standard library. The distinction:

| Skill type | Example | Rule |
|---|---|---|
| Domain skill | scheduling-engine | Self-contained. Loading it = everything you need. |
| Workflow skill | issue-workflow | Self-contained. Describes a process, not a domain. |
| Utility skill | shell-scripting | Shared foundation. Referenced by domain skills, not required. |

Utility skills are explicitly labeled as such. Domain skills that frequently need
shell patterns include a one-line reference: "For bash patterns (pipe exit codes,
heredoc quoting): see shell-scripting skill." This is acceptable coupling — it's
a pointer, not a dependency.

**After reorganization:**

```
Domain skills (self-contained):
  scheduling-engine (absorbs rust-wasm)
  hooks
  e2e-testing
  google-sheets-sync
  cloud-deployment

Workflow skills (self-contained):
  issue-workflow
  multi-agent-orchestration

Utility skills (shared foundation, explicitly labeled):
  shell-scripting

Process skills (curation infrastructure):
  curation (new)
```

**Relationship: multi-agent-orchestration ↔ curation**

Curation runs as a launch-phase config, so there's a natural connection.
The curation skill should be self-contained enough to run a pass without
loading the orchestration skill — it includes the launch command and basic
flow. The orchestration skill owns the infrastructure debugging.

| Question | Answer in |
|---|---|
| How do I run a curation pass? | curation skill ("run `launch-phase.sh skill-curation.yaml all`") |
| What do the 5 reviewer angles check? | curation skill |
| How do I write a debrief report? | debrief-template.md (via hook pointer) |
| Why did launch-phase.sh hang during curation? | multi-agent-orchestration skill |
| How do I debug a stalled curator agent? | multi-agent-orchestration skill |
| How does the merge step work? | multi-agent-orchestration skill |

**Dependency graph after reorganization:**
```
scheduling-engine           ← fully self-contained
hooks                       ← fully self-contained
e2e-testing                → shell-scripting (optional, for relay startup scripts)
multi-agent-orchestration  → shell-scripting (useful, for pipe/heredoc patterns)
cloud-deployment           → shell-scripting (optional, for deploy scripts)
google-sheets-sync          ← fully self-contained
issue-workflow              ← fully self-contained
curation                    ← fully self-contained
```

No manifest needed. The only real dependency is multi-agent-orchestration →
shell-scripting, and that's a utility reference, not a hard requirement. Agents
working on orchestration scripts will naturally load shell-scripting from context.

**What about future skills?** The rule for new skills:
- If it has one consumer → absorb into the consumer (like rust-wasm)
- If it describes a technology used by many domains → utility skill
- If it describes a domain or workflow → domain/workflow skill
- The curation structure reviewer can check: "does this new skill have only one
  consumer? If so, recommend absorption."

### Subagent Updates

**Codebase explorer** needs two updates to support orchestration validation
during curation:

1. **Verify `scripts/lib/` in the project structure map.** Already expanded
   in current explorer (lines 33-34) — confirm descriptions are current and
   add any missing libraries. If moving to `docs/project-structure.md`, carry
   these descriptions forward:

   ```
   - `scripts/lib/` — Orchestration libraries:
     - `stage.sh` — parallel agent launching, per-group worktree setup
     - `merge.sh` — branch merging, per-branch verification, conditional WASM rebuild
     - `validate.sh` — post-merge validation, pipe mode, wall-clock timeout
     - `watch.sh` — tmux WATCH mode: agent monitoring, stall detection via log size
     - `tmux-supervisor.sh` — tmux-native agent control: launch, poll, kill, status
     - `agent.sh` — agent retry loop, metrics logging
     - `worktree.sh` — worktree creation/cleanup
     - `pr.sh` — PR creation, review classification (light/full)
     - `config.sh` — YAML config parsing
     - `log.sh` — logging utilities
   ```

2. **Add agent infrastructure to the structure map.** Currently missing
   entirely — curation reviewers need to navigate these:

   ```
   - `.claude/settings.json` — Hook registration (PreToolUse guard, PostToolUse verify + bizday lint)
   - `.claude/worktrees/CLAUDE.md` — Canonical worktree procedures (PR workflow, cleanup, parallel awareness)
   - `.claude/agents/` — Subagent definitions: codebase-explorer, rust-scheduler, verify-and-diagnose, plan-reviewer
   - `.claude/skills/` — Domain-specific reference guides (10 skills)
   - `.github/workflows/` — CI/CD pipelines:
     - `agent-work.yml` — Agent issue workflow + review-fix loop
     - `pr-review.yml` — Non-agent PR code review
     - `agent-gate.yml` — Agent PR merge gating
     - `ci.yml` — Standard CI (tsc, vitest, cargo test)
     - `e2e.yml` — E2E test pipeline
     - `deploy.yml` — Cloud Run deployment
   - `.github/ISSUE_TEMPLATE/agent-task.yml` — Agent issue template
   - `docs/prompts/` — Phase prompts (per-phase subdirs), supervisor prompt, curation prompts
   - `docs/architecture.md`, `docs/multi-agent-guide.md` — Core architecture + orchestration docs
   ```

3. **Add hooks infrastructure to the structure map.** The hooks skill
   reviewers need to find guard binary source, verification scripts,
   and hook registration:

   ```
   - `scripts/verify.sh` — PostToolUse hook: tsc + vitest after edits (rate-limited, deduped)
   - `scripts/full-verify.sh` — Full verification suite (tsc, vitest, cargo, E2E)
   - `scripts/pre-commit-hook.sh` — Git pre-commit: auto-format, reject stubs/todo!/deprecated
   - `scripts/test-hooks.sh` — Functional tests for guard binary
   - `scripts/check-curation.sh` — Curation reminder (called from verify.sh + full-verify.sh)
   - `scripts/curate-skills.sh` — Curation batch loop (called by /curate-skills)
   ```

4. **Add orchestration context to investigation approach.** When exploring
   `scripts/lib/`, the explorer should read function-level comments and
   reference the multi-agent-orchestration skill for behavioral context
   (stage flow, merge gating, stall detection semantics).

5. **Project structure map as a shared artifact.**

   The structure map is useful beyond the codebase explorer — contributors,
   phase authors, curation reviewers, and README all need the same information.
   Extract it from `codebase-explorer.md` into a standalone file that multiple
   consumers reference.

   **`docs/project-structure.md`** — single source of truth for project layout.
   The codebase explorer definition says "read `docs/project-structure.md`"
   instead of embedding the map. README can reference or embed it. Phase
   prompt authors use it for scoping. Curation reviewers use it for file
   ownership.

   **`scripts/update-project-structure.sh`** — generates the map skeleton.
   Built on `git ls-files` (zero dependencies, respects `.gitignore`):

   ```bash
   # Get every directory containing tracked files
   git ls-files | sed 's|/[^/]*$||' | sort -u
   ```

   Compares against current `docs/project-structure.md`:
   - Existing paths: preserves description
   - New paths: inserts with `<!-- NEW: needs description -->` marker
   - Deleted paths: inserts `<!-- DELETED: was 'description' -->` marker

   Shares directory discovery logic with `scripts/lint-agent-paths.sh`
   (which already defines `SOURCE_ROOTS` and `EXCLUDED_DIRS`). Could
   extend the lint script with a `--generate` flag, or factor out the
   shared logic into a common function both scripts source.

   **Pre-commit hook addition** — catches changes at the right moment:
   - If the commit touches files in a directory not in the structure map,
     warn: "New directory not in project structure. Run
     `scripts/update-project-structure.sh` and add a description."
   - Agent has full context about the new directory at commit time.

   **`full-verify.sh`** — catches anything the pre-commit missed:
   - `lint-agent-paths.sh` validates all map paths still exist
   - Warns on any `<!-- NEW -->` or `<!-- DELETED -->` markers

   **Agent's role:** Run the script when prompted, fill in descriptions.
   Script handles mechanical accuracy. Agent handles judgment.

   **Codebase explorer update:** Replace the embedded structure map with
   a reference: "Read `docs/project-structure.md` for project layout."
   Explorer definition shrinks; map is maintained independently.

   **Comparison with external tools:**

   | Approach | What it provides | Maintenance | Dependencies |
   |---|---|---|---|
   | Our proposal (`git ls-files` + descriptions) | Directory tree + human-written intent | Script generates paths; agent writes descriptions | Zero (git only) |
   | `tree` / `repo4llm` / Repomix | File tree or full repo dump | Automatic | Minimal (npm/pip) |
   | Aider repo-map (tree-sitter + PageRank) | Symbol-level map with ranked importance | Automatic, semantic | tree-sitter, Python |
   | RepoMapper MCP server | Aider-style map via MCP protocol | Automatic | MCP plugin |

   Aider's approach is SOTA — it parses ASTs, extracts function/class/type
   definitions, builds a file dependency graph, and uses PageRank to surface
   the most-referenced symbols. This gives agents semantic understanding
   (key functions and how they connect) not just directory structure.

   Our `git ls-files` + descriptions approach is the right v1: zero
   dependencies, descriptions capture intent that semantic tools can't
   ("this directory exists because of X constraint"), and the project's
   "minimal dependencies" principle favors it. But for future consideration:

   - **RepoMapper as MCP server** could supplement the manual map with
     automatic symbol-level context. Claude Code already supports MCP
     plugins. Zero project dependencies — the plugin runs externally.
   - **LSP tools already provide semantic navigation** (`documentSymbol`,
     `findReferences`, `goToDefinition`). The explorer could use LSP
     more aggressively instead of relying on a static map.
   - If maintenance burden of descriptions becomes a problem, evaluate
     switching to an automatic semantic map + minimal human annotations
     for intent/constraints that tools can't derive.

**No new orchestration specialist subagent.** Deferred — the updated codebase
explorer should handle orchestration validation questions. If the initial
curation pass shows the explorer can't answer orchestration questions well
enough (too many validation escalations with vague answers), that's the
signal to build a specialist. The scope would be: `scripts/lib/*.sh`,
`scripts/launch-*.sh`, `docs/prompts/supervisor.md`.

**Skill reviewer subagent.** One new subagent definition shared by all 5
reviewer angles. Differentiation is entirely in the prompt, not the definition:
- Model: sonnet
- Max turns: 30
- Tools: Read, Grep, Glob, LSP, Bash (read-only — no Edit, Write, Agent)
- All 5 reviewer angles are in `.claude/agents/skill-reviewer.md` (one shared definition)

### Open Questions

1. **Cost calibration.** Full pass: 5 reviewers × 8 skills = 40 subagents +
   8 curators + N haiku scorers (one per finding). Monitor cost after
   first manual pass and first automated pass. Skills with no relevant
   observations in a batch exit early (minimal cost). If cost is too high,
   consider 3 reviewers (accuracy, scope, adversarial) for low-volume skills.

2. **`prompt` field in launch-phase.sh.** Wrappers work as an interim
   solution but each new skill or curation target requires a new wrapper
   file. The `prompt` field (~5 line change to `agent.sh`, backward
   compatible) is the intended design — eliminates wrappers, enables
   clean generalization to future curation targets. Implement in Phase B
   after prompts are validated manually. Requires thorough testing:
   backward compat with existing phase configs, preflight validation of
   the prompt path, dry-run of all existing configs.

3. **Supervisor decision tree.** The supervisor prompt (`docs/prompts/supervisor.md`)
   encodes complex branching logic as prose. A structured format would be
   more deterministic. Not blocking — deferred until pipeline matures.

### Resolved Questions

- **Curator scope beyond LL:** Resolved — curator reviews full skill
  file (body + LL). Migration steps move content faithfully; curators handle
  quality in step 12.
- **Cross-skill dedup:** Code review on the batched PR is the cross-skill layer.
  Curation checklist explicitly checks for dupes across skills. If code review
  misses them, the orchestrator's debrief captures this and the checklist gets
  refined. No additional post-merge pass needed.
- **Metrics:** Orchestrator appends one line per pass to
  `docs/prompts/curation/metrics.csv`:
  ```
  date,skills_curated,reports_processed,acted,rejected,preserved,threshold,review_iterations
  2026-04-15,8,18,12,4,2,80,2
  ```
  Simple CSV, no infrastructure. Eyeball trends or chart it. PR description
  has per-pass detail; CSV tracks trends across passes.

## Instruction Surface Changes

The curation system introduces new processes. Agents need to know about them
at the right layer — not everything in Tier 0.

### Tier 0 CLAUDE.md changes (minimal)

**Replace** (in behavioral rules):
```
- When you discover a non-obvious gotcha or debugging insight, append it to
  the relevant skill's "Lessons Learned" section
```
**With:**
```
- When you discover a non-obvious gotcha or debugging insight, write a debrief
  report (the verify hook will remind you and point to the template)
```

**Add** to reference index:
```
  - `curation` — Skill curation process, debrief reports, prompt templates
```

That's it for Tier 0 — two lines changed. Everything else is discovered
via hooks or loaded on demand.

### What agents learn from hooks (at the right time)

| Hook | Message | When |
|---|---|---|
| `verify.sh` / `full-verify.sh` | "No debrief found. Read debrief-template.md" | After edits, before PR |
| `verify.sh` / `full-verify.sh` | "N reports pending. Inform user to run /curate-skills" | When reports accumulate |

### What agents learn from skills (on demand)

| Skill | Content | Loaded when |
|---|---|---|
| `curation/SKILL.md` | How curation works, reviewer angles, consensus rules | Running or discussing curation |
| `issue-workflow/SKILL.md` | "debrief written or skipped" in checklist | Working from an issue |

### All files modified by this plan

**Root CLAUDE.md** (steps 1-7, 11):
- Remove: date conventions, progress tracking, error protocol (full),
  commands table, dev environment, issue workflow, context conservation
- Keep: Tier 0 behavioral rules (with additions: rebase, plan mode,
  test paths, emergency commit, guard binary, debrief instruction)
- Update: reference index (remove rust-wasm, add curation)

**Scoped CLAUDE.md files** (step 7):
- `crates/scheduler/CLAUDE.md` — remove date convention section, add skill ref
- `src/CLAUDE.md` — remove date convention section, add skill ref
- `.claude/worktrees/CLAUDE.md` — remove internal duplicate (line 24)

**Skills** (steps 1-2, 4-5, 8-10, 12):
- `scheduling-engine/SKILL.md` — absorb rust-wasm, receive date conventions
- `issue-workflow/SKILL.md` — receive error protocol, issue workflow, debrief checklist
- `multi-agent-orchestration/SKILL.md` — receive progress tracking, context conservation
- `rust-wasm/SKILL.md` — deleted (absorbed into scheduling-engine)
- All skills with LL entries — update header comment to "managed by curation pipeline"
- Domain skills — add utility skill references to shell-scripting where relevant

**New files** (step 11):
- `.claude/skills/curation/SKILL.md`
- `docs/prompts/curation/curator.md`
- `.claude/agents/skill-reviewer.md` (shared by all 5 reviewer angles)
- `docs/prompts/curation/validate.md`
- `docs/prompts/curation/debrief-template.md`
- `docs/prompts/curation/skill-curation.yaml`
- `docs/prompts/curation/feedback/` (directory)
- `docs/project-structure.md`
- `scripts/curate-skills.sh`
- `scripts/generate-retry-config.sh`
- `scripts/check-curation.sh`
- `scripts/update-project-structure.sh`

**Modified scripts/hooks** (step 11):
- `scripts/verify.sh` — add curation reminder call
- `scripts/full-verify.sh` — add debrief check + curation reminder
- `scripts/pre-commit-hook.sh` — add new-directory structure map warning
- `scripts/lib/agent.sh` — add `prompt` field support (~5 lines)

**Subagent definitions** (step 11):
- `.claude/agents/codebase-explorer.md` — replace embedded map with ref to
  `docs/project-structure.md`, add missing `.claude/`, `.github/`, hooks areas
- New: `.claude/agents/skill-reviewer.md` (shared by all 5 angles)

**Other** (step 3):
- `README.md` — receive human-facing commands and dev environment setup

## Future Direction: Generalized Instruction Curation

The 5 reviewer angles and scoring layer are not skill-specific — they work on
any document that instructs agents. If skill curation proves effective, the
same system could review CLAUDE.md files, scoped CLAUDE.md files, worktree
instructions, subagent definitions, and curation prompts themselves. Same
curator prompt, same reviewer angles, different targets. Not planned
for v1 — validate on skills first.

## Expected Result

| Metric                          | Before  | After       |
|---------------------------------|---------|-------------|
| Root CLAUDE.md tokens           | ~3900   | ~1500-2000  |
| Duplicate rule instances        | 3-4 each| 1 + refs    |
| "Fix a CSS bug" context cost    | ~3900   | ~1500       |
| "Scheduling fix" context cost   | ~4750   | ~2700       |
| Instruction drift risk          | High    | Low         |

## Critical Issues (Resolved) — Implementation Reference

Issues found during 5-agent plan review. Each is resolved in the plan but
documented here with full detail in case implementation needs to revisit.

### C1: `prompt` field not supported by launch-phase.sh

**Found by:** Agent #5 (completeness) — verified by reading `scripts/lib/agent.sh`

**Problem:** The curation launch config specifies `prompt: docs/prompts/curation/curator.md`
per group, but `agent.sh` hardcodes prompt resolution as `${PROMPTS_DIR}/${group}.md`.
There is no `prompt` field in the config schema. The curation pipeline would fail at
preflight with "Missing prompt file: docs/prompts/curation/scheduling-engine.md".

**Actual code (`scripts/lib/agent.sh`):**
```bash
local prompt_file="${WORKSPACE}/${PROMPTS_DIR}/${group}.md"
```

**Resolution:** Add ~5 line enhancement to `agent.sh`:
```bash
local prompt_override
prompt_override=$(yq -r ".stages[$s].groups[$g].prompt // empty" "$CONFIG_FILE")
local prompt_file="${prompt_override:-${WORKSPACE}/${PROMPTS_DIR}/${group}.md}"
```
Backward compatible — existing configs without `prompt` field work unchanged.

**Risk mitigation (high-leverage change to shared infrastructure):**
This change touches the agent launch path that all phases depend on. A bug
here breaks all phase launches, not just curation. Required safeguards:
- Standalone PR with thorough verification before any curation work
- Add test cases to `scripts/test-hooks.sh` or new `scripts/test-launch-config.sh`:
  - Config with `prompt` field → uses specified path
  - Config without `prompt` field → falls back to `{config_dir}/{group_id}.md`
  - Config with `prompt` field pointing to nonexistent file → preflight catches it
- Dry-run every existing launch config after the change to confirm backward compat
- The reviewer prompts are tested manually (direct invocation) BEFORE this
  change is made — so prompt quality is validated independently of infrastructure

**Implementation order:** Most work has no infrastructure dependency and
can proceed in parallel before the `agent.sh` change.

**Phase A — No infrastructure dependency (can start immediately):**
1. Design reviewer prompts (5 angle prompts + curator)
2. Test on multi-agent-orchestration (manual invocation, refine)
3. Run initial LL cleanup on all 6 skills (manual invocation)
4. Create `docs/project-structure.md` (extract from codebase-explorer)
5. Create `scripts/update-project-structure.sh` (git ls-files generator)
6. Update codebase-explorer.md (reference shared map, add missing areas)
7. Add pre-commit hook for new directories not in structure map
8. Write `debrief-template.md`
9. Create `scripts/check-curation.sh` (reminder hook)
10. Create `.claude/skills/curation/SKILL.md`
11. Create `docs/prompts/curation/feedback/` directory
12. Integrate debrief check + curation reminder into verify.sh / full-verify.sh
13. Tier 0 CLAUDE.md rewrite (migration steps 1-7)
14. Absorb rust-wasm into scheduling-engine (step 8)
15. Add utility skill references (step 9)
16. Prepare LL sections for curation handover (step 10) — update header
    comments in all skills from "agents: append here" to "managed by
    curation pipeline." Optionally add timestamps to undated entries via
    `git log -S "entry text" --format="%ad" --date=short -- .claude/skills/`
    as a one-time aid for the initial cleanup pass.
17. Move human-facing commands to README

**Phase B — Requires `agent.sh` PR merged first:**
18. `agent.sh` prompt field enhancement (standalone PR, thorough testing)
19. `skill-curation.yaml` launch config
20. `curate-skills.sh` orchestration script
21. `validate.md` curation validation prompt
22. End-to-end test of automated curation pipeline

**Location in plan:** "Required launch-phase.sh enhancement" section under
Launch Config.

---

### C2: `curate-skills.sh` called `all` which includes validate + create-pr

**Found by:** Agent #2 (bugs) — verified by reading `launch-phase.sh` `build_pipeline_steps()`

**Problem:** The original script called `./scripts/launch-phase.sh "$CONFIG" all`.
Per `build_pipeline_steps()`, `all` runs: stage:1 → merge:1 → validate → create-pr.
This meant:
- In a multi-iteration loop: create-pr would run on every iteration (duplicate PRs)
- The create-pr step is rigid — agent can't add curation-specific context

**Resolution:** Script now calls `stage 1 && merge 1 && validate` explicitly.
Agent handles PR creation and code review. The loop was also removed — each
run is one pipeline invocation. If reports remain, the reminder hook prompts
for the next run.

**Location in plan:** `scripts/curate-skills.sh` script block.

---

### C3: Initial LL cleanup cannot use `curate-skills.sh`

**Found by:** Agent #2 (bugs) — logic error

**Problem:** `curate-skills.sh` reads feedback reports from `feedback/` directory.
For the initial cleanup there are no feedback reports — the 39 existing LL entries
live in SKILL.md files. The script would find 0 reports, print "Nothing to do",
and exit. The initial migration step cannot execute.

**Resolution:** No bootstrap infrastructure needed. The initial cleanup uses
the same skill reviewer prompts invoked directly by an agent — the same way
`/code-review` can be run on a file without a PR. The agent reads the SKILL.md,
spawns 5 reviewers, collects scored findings, and applies edits.

This is also how the reviewer prompts get tested and refined before any
launch-phase infrastructure is built.

Strategy:
- Pass 1: multi-agent-orchestration only (20 entries, test + refine prompts)
- Pass 2: remaining 5 skills (19 entries, refined prompts)
- After cleanup: switch to debrief model, `curate-skills.sh` handles future runs

**Location in plan:** "Initial LL Cleanup" section.

---

---

### C4: Contradiction — "all 6 skills" vs "multi-agent-orchestration only"

**Found by:** Agent #2 (bugs) — internal contradiction

**Problem:** The Initial LL Cleanup section said "runs all 6 skills as parallel
groups in one invocation." The Bootstrapping section said "Run Pass 1 on
multi-agent-orchestration only." Both described the first curation pass with
contradictory scope.

**Resolution:** Resolved in favor of the phased approach:
- Pass 1: multi-agent-orchestration only (test prompts on hardest case)
- Pass 2: remaining 5 skills (with refined prompts)
Both sections now say the same thing.

**Location in plan:** "Initial LL Cleanup" and "Bootstrapping" sections.

---

### C5: Missing `validate.md` in curation prompts directory

**Found by:** Agent #5 (completeness) — verified by checking `scripts/lib/validate.sh`

**Problem:** `launch-phase.sh validate` looks for `${PROMPTS_DIR}/validate.md`.
The proposed `docs/prompts/curation/` directory listing did not include this file.
The validate step would fail with "Missing prompt file".

**Resolution:** Added `validate.md` to the directory listing. The validation
prompt for curation should verify: skill files parse correctly, no broken
cross-references, net token delta is negative or neutral, no `<!-- NEW -->`
or `<!-- DELETED -->` markers left in project structure map.

**Location in plan:** "Reusable Prompt Templates" directory listing.

---

### C6: YAML config malformed — missing `name`, `merge_message`, wrong indentation

**Found by:** Agent #5 (completeness) + Agent #2 (bugs) — verified against
existing launch configs

**Problem:** The proposed skill-curation.yaml had:
- `stages: - groups:` as sibling keys (YAML indentation error)
- No `name` field per stage (required by `config.sh`)
- No `merge_message` per group (used by `merge.sh` for commit messages)
- `labels: ["skill-curation"]` in `pr:` section (not read by `pr.sh`)

Existing configs (e.g., `phase17-datecalc/launch-config.yaml`) all have
`name` per stage and `merge_message` per group.

**Resolution:** Config rewritten with:
```yaml
stages:
  - name: "Skill curation"
    groups:
      - id: scheduling-engine
        branch: curation/scheduling-engine
        prompt: docs/prompts/curation/curator.md
        merge_message: "docs: scheduling-engine skill"
```
Proper indentation, `name` and `merge_message` included. `labels` removed
from config (agent applies label when creating PR).

**Location in plan:** "Launch Config" section.
