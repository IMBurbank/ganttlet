# Tiered Instruction Architecture

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
  - Test-first (one-line)
  - Conventional commits
  - Don't skip verification: `./scripts/full-verify.sh`
  - Never compute arithmetic/dates mentally — use tools (one-line, details in scheduling-engine skill)
  - Keep dependencies minimal
  - Never ask for secrets in chat
  - Pattern bug fix procedure (LSP findReferences + Grep — universal)
  - Write debrief reports when you discover non-obvious behavior (verify hook reminds you)
- Architecture Constraints (current 5 bullets — already compact)
- Reference Index (skills/agents/docs listing)

### Tier 1 — Mode-activated (loaded when entering a work mode)

| Content (current location)                    | Moves to                              |
|-----------------------------------------------|---------------------------------------|
| Error Handling Protocol (CLAUDE.md L55-61)    | `issue-workflow/SKILL.md`             |
| Progress Tracking Format (CLAUDE.md L63-105)  | `multi-agent-orchestration/SKILL.md`  |
| Commands Quick Reference (CLAUDE.md L107-124) | README.md (human) + already in skills (agent) |
| Date Conventions full (CLAUDE.md L133-141)    | `scheduling-engine/SKILL.md`          |
| Dev Environment setup (CLAUDE.md L143-149)    | README.md (human setup)               |
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
| Error escalation   | `issue-workflow/SKILL.md`           | CLAUDE.md removes full protocol     |

Also audit scoped CLAUDE.md files (`crates/scheduler/`, `src/`, `src/sheets/`, `e2e/`,
`server/`) — replace restated rules with skill references. Keep only directory-specific
constraints.

## Migration Steps (each is one commit)

1. **Move date conventions** out of root CLAUDE.md → merge into `scheduling-engine/SKILL.md`
   - Root keeps: "Never compute arithmetic/dates mentally — use tools (see scheduling-engine skill)"
   - `crates/scheduler/CLAUDE.md` and `src/CLAUDE.md` reference skill instead of restating

2. **Move progress tracking + error protocol** → merge into respective skills
   - Progress tracking → `multi-agent-orchestration/SKILL.md`
   - Error protocol → `issue-workflow/SKILL.md`
   - Root keeps nothing (these are workflow-specific)

3. **Move commands table + dev environment** → split by audience
   - Human-facing commands → README.md (setup, docker, running claude, test/verify)
   - Agent-facing commands already live in scoped CLAUDE.md files and skills:
     - `npm run test`, `cargo test` → scoped CLAUDE.md files (already there)
     - `full-verify.sh`, `attest-e2e.sh` → issue-workflow skill (already there)
     - `launch-phase.sh`, `launch-supervisor.sh`, `claude` CLI → multi-agent-orchestration skill (already there)
   - Root keeps nothing — commands table is redundant

4. **Move single-agent issue workflow** → merge into `issue-workflow/SKILL.md`
   - Root keeps nothing (skill already covers this)

5. **Move context conservation** → merge into `multi-agent-orchestration/SKILL.md`
   - Root keeps nothing

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

   **`.claude/worktrees/CLAUDE.md`** (37 → 36 lines):
   - Line 24 ("Never remove worktrees you did not create") duplicates line 17
     in the same file → remove line 24
   - This file IS the canonical location for worktree rules. No content moves out.
     Root CLAUDE.md references this file instead of restating.

   **No changes:** `server/CLAUDE.md`, `src/sheets/CLAUDE.md`, `e2e/CLAUDE.md` —
   all directory-specific, no duplication.

8. **Absorb rust-wasm into scheduling-engine** — merge 43 lines into scheduling-engine
   - Move build commands, wasm-bindgen patterns, debugging tips
   - Delete `rust-wasm/SKILL.md`
   - Update skill trigger to cover WASM build/debug tasks
   - Update reference index in root CLAUDE.md

9. **Add utility skill references** — domain skills that use shell patterns get one-line ref
   - multi-agent-orchestration: "For bash patterns: see shell-scripting skill"
   - e2e-testing, cloud-deployment, hooks: same where relevant
   - shell-scripting SKILL.md gets a note: "Utility skill — shared foundation"

10. **Add Lessons Learned timestamps** to all skill files via git blame

11. **Add curation infrastructure**
    - Create `docs/prompts/curation/` directory with prompt templates
    - Create `docs/prompts/curation/feedback/` for debrief reports
    - Create `docs/prompts/curation/skill-curation.yaml` launch config
    - Create `.claude/skills/curation/SKILL.md`
    - Add debrief check to `full-verify.sh`
    - Add curation reminder to `verify.sh` and `full-verify.sh`
    - Update CLAUDE.md: "write debrief to feedback/" replaces "append to LL"

12. **Add refinement process** — periodic review to prune stale lessons and compress verbose ones

## Lessons Learned Refinement Process

Timestamps alone don't solve the accumulation problem — they just make it visible.
Without periodic pruning, Lessons Learned sections grow unbounded and consume
increasing context for diminishing value. Older lessons may also conflict with
newer behavior.

### When to refine
- **Trigger**: Monthly baseline, or when reminder hook fires (10+ feedback reports
  or oldest report >60 days)
- **Cadence**: Monthly during active development; accelerate when busy
- **Who**: User runs `/curate-skills`; `scripts/curate-skills.sh` handles the
  mechanical loop; agent handles code review on the resulting PR

### Refinement actions (in priority order)
1. **Delete**: If the lesson is now enforced by code (e.g., a hook, a linter, a type check),
   the lesson is redundant. The code is the source of truth. Delete the lesson.
2. **Consolidate**: If multiple lessons describe the same theme, merge into one entry.
   Keep the most specific example, drop the rest. Use the earliest date.
3. **Promote**: If a lesson is important enough that every agent should know it, promote it
   to the skill's main body (Gotchas section or similar). Delete from Lessons Learned.
4. **Archive**: If a lesson is >60 days old and hasn't been promoted or consolidated,
   move it to a `## Archived Lessons` section at the bottom of the skill file. This keeps
   it searchable but out of the primary context window. Archived lessons can be deleted
   after 120 days if no one has referenced them.
5. **Compress**: Shorten verbose entries. A lesson should be 1-2 lines max. If it needs
   more, it belongs in the skill's main body, not Lessons Learned.

### The multi-agent-orchestration problem
This skill has 20 entries (~600 tokens) — the largest Lessons Learned section.
Many are now encoded in `launch-phase.sh` code (PIPESTATUS, SIGPIPE, pipe mode,
stall detection, WASM rebuild). These should be promoted or deleted during step 12.

Proposed triage for multi-agent-orchestration:

| Entry (date) | Action | Reason |
|---|---|---|
| Claude output modes (03-05) | Promote to skill body | Fundamental concept |
| WATCH requires tmux (03-05) | Delete | Enforced by script preflight check |
| PIPESTATUS (03-05) | Consolidate with shell-scripting | Duplicate of shell-scripting 03-09 |
| Heredoc quoting (03-05) | Delete | Covered by shell-scripting skill |
| setup_worktree stdout (03-05) | Keep | Non-obvious, still relevant |
| script -q -c fragile (03-05) | Delete | Already replaced in code |
| Validation log parsing (03-05) | Keep | Still relevant, non-obvious |
| Container deps (03-05) | Delete | Encoded in Dockerfile |
| CLAUDECODE env var (03-08) | Delete | Encoded in launch-phase.sh line 1 |
| Merge worktree isolation (03-08) | Promote to skill body | Architectural principle |
| Per-branch verification (03-08) | Delete | Encoded in do_merge() |
| Parallel verification (03-08) | Delete | Encoded in run_parallel_verification() |
| Code review cap (03-08) | Keep | Policy, not code |
| SIGPIPE (03-09) | Delete | Covered by shell-scripting skill |
| YAML frontmatter (03-09) | Keep | Non-obvious, still relevant |
| Validation pipe mode (03-09) | Delete | Encoded in validate.sh |
| Wall-clock timeout (03-09) | Delete | Encoded in VALIDATE_TIMEOUT |
| Stall detection (03-09) | Delete | Encoded in tmux_wait_stage() |
| Conditional WASM rebuild (03-09) | Delete | Encoded in do_merge() |
| Check output early (03-09) | Keep | Operational practice, not code |

Result: 20 entries → ~7 entries + 2 promoted. Saves ~350 tokens.

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
launch-phase.sh skill-curation.yaml all
│
├── Stage 1 (all groups in parallel, one per skill)
│   ├── Group: scheduling-engine    → curation/scheduling-engine
│   ├── Group: hooks                → curation/hooks
│   ├── Group: multi-agent-orchestration → curation/multi-agent-orchestration
│   ├── Group: e2e-testing          → curation/e2e-testing
│   ├── Group: shell-scripting      → curation/shell-scripting
│   └── Group: issue-workflow       → curation/issue-workflow
│
├── Merge (all branches → main or curation base branch)
│
├── Create PR (label: skill-curation)
│
└── Code Review Loop (curation-aware checklist, max 3 iterations)
```

Each group agent is a **consolidator** that internally spawns 5 reviewer subagents —
same pattern as the code-review plugin using 5 parallel agents with distinct angles.

### Launch Config

```yaml
phase: skill-curation
merge_target: main
stages:
  - groups:
    - id: scheduling-engine
      branch: curation/scheduling-engine
      prompt: docs/prompts/curation/consolidator.md
      prompt_vars:
        skill: scheduling-engine
        source_paths: "crates/scheduler/src/*.rs"
    - id: hooks
      branch: curation/hooks
      prompt: docs/prompts/curation/consolidator.md
      prompt_vars:
        skill: hooks
        source_paths: "crates/guard/src/*.rs"
    - id: multi-agent-orchestration
      branch: curation/multi-agent-orchestration
      prompt: docs/prompts/curation/consolidator.md
      prompt_vars:
        skill: multi-agent-orchestration
        source_paths: "scripts/lib/*.sh scripts/launch-phase.sh"
    - id: e2e-testing
      branch: curation/e2e-testing
      prompt: docs/prompts/curation/consolidator.md
      prompt_vars:
        skill: e2e-testing
        source_paths: "e2e/*.ts"
    - id: shell-scripting
      branch: curation/shell-scripting
      prompt: docs/prompts/curation/consolidator.md
      prompt_vars:
        skill: shell-scripting
        source_paths: "scripts/*.sh scripts/lib/*.sh"
    - id: issue-workflow
      branch: curation/issue-workflow
      prompt: docs/prompts/curation/consolidator.md
      prompt_vars:
        skill: issue-workflow
        source_paths: ".github/workflows/*.yml"
pr:
  title: "docs: skill curation pass"
  labels: ["skill-curation"]
```

**Key detail:** Every group uses the **same prompt template** (`consolidator.md`).
The prompt is reusable across all skills and all curation passes. Improvements
to the prompt benefit every future curation run.

**Note on `prompt_vars`:** launch-phase.sh doesn't currently support variable
substitution. The simplest v1 approach: the consolidator prompt reads its skill
name from the launch-phase group ID (available as the worktree branch name, e.g.,
`curation/scheduling-engine` → skill is `scheduling-engine`). Source paths are
discovered by reading the skill's SKILL.md, which already lists the relevant
source files. This avoids needing `prompt_vars` support entirely. The `prompt_vars`
in the config above are aspirational — they show what template support would
look like if added later.

### Reusable Prompt Templates

These live in `docs/prompts/curation/` and improve over time. Unlike task-specific
phase prompts, these are permanent infrastructure.

```
docs/prompts/curation/
├── consolidator.md          # Main agent prompt (template, parameterized by skill)
├── reviewer-accuracy.md     # Subagent prompt: check LL entries against source
├── reviewer-structure.md    # Subagent prompt: skill body quality + promotions
├── reviewer-scope.md        # Subagent prompt: cross-skill boundaries + dedup
├── reviewer-history.md      # Subagent prompt: provenance + context decay
├── reviewer-adversarial.md  # Subagent prompt: actively disprove entries
├── debrief-template.md      # Template for agent debrief reports (read by agents)
├── skill-curation.yaml      # Launch config for curation passes
└── feedback/                # Debrief reports accumulate here
```

The consolidator prompt instructs the agent to:
1. Read `feedback/.batch-manifest` for the list of reports to process
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
reasoning is weak. Forces the consolidator to validate before acting.

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

### LL Entry Triage
| # | Date | Summary | Classification | Evidence |
|---|------|---------|---------------|----------|
| 1 | 2026-03-05 | PIPESTATUS required | consolidate | Duplicate of shell-scripting LL #3. |
| 2 | 2026-03-08 | CLAUDECODE blocks nesting | delete | launch-phase.sh L3: `unset CLAUDECODE` |

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

### Consolidator Synthesis

The consolidator (group agent) collects all 5 reports and builds a consensus matrix.

**Decision rules:**

| Consensus | Action |
|-----------|--------|
| 4-5/5 agree on classification | Act on it |
| 3/5 agree | Act, cite dissenting evidence in commit message |
| 2/5 or less agree | Spawn validation subagent to investigate, then decide |
| Any reviewer says "wrong" | Always validate with subagent before acting |
| Adversarial says "suspicious" | Spawn validation subagent regardless of others |
| All 5 say "keep" | Keep — no action needed |

**Validation subagents (on-demand, spawned by consolidator):**

| Subagent | When to use | Question type |
|----------|-------------|---------------|
| **Codebase Explorer** | "Does function X exist? Does it do Y?" | Structural — answer is in the code |
| **Rust Scheduler** | "Does CPM/cascade/constraint behave as claimed?" | Domain-specific structural |
| **Verify and Diagnose** | "Does this runtime behavior actually happen?" | Behavioral — needs to run commands |

**Structural vs. behavioral distinction:** Many LL entries describe runtime
behavior (tmux signal handling, pipe exit codes, process stall patterns) that
can't be verified by reading source code alone. The consolidator should route
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

**Consensus matrix example:**
```
Entry #1 (2026-03-05: PIPESTATUS required)
  Accuracy:    consolidate (duplicate of shell-scripting)
  Structure:   delete (not worth promoting)
  Scope:       consolidate (shell-scripting owns this)
  History:     keep (added in initial skill creation, not rushed)
  Adversarial: keep (verified — genuinely required in tee pipes)
  → 2 consolidate, 1 delete, 2 keep → no consensus → validate
```

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

### How Prompts Improve Over Time

Unlike task-specific phase prompts, curation prompts are permanent and reusable.
They improve through the same mechanism they curate:

1. **After each curation pass**, agents add Lessons Learned to a `curation` skill
   (e.g., "adversarial reviewer missed X because the prompt didn't instruct it
   to check test files")
2. **Next curation pass** curates the curation skill itself — and the consolidator
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
| Review-fix loop (max 3 iterations) | Same loop on curation PR |
| `classify_pr()` routes light vs full | LL entry count routes skip vs review |
| Plugin handles parallelization | Consolidator spawns subagents in parallel |
| Read-only reviewers, one fix agent | Read-only reviewers, one consolidator writes |
| PR as audit trail | PR with reviewer reports in collapsible sections |
| Fixed prompts per aspect | **Reusable, improving prompts per angle** |

**Where curation differs:**
- **Multiple orchestrators** — one consolidator per skill (each needs deep domain context)
- **Validation subagents** — consolidator can escalate to specialists for disagreements
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

Total: 39 entries across 6 skills. The initial pass runs all 6 skills as
parallel groups in one `curate-skills.sh` invocation. Skills with 0 entries
are skipped (no consolidator group needed).

**After the initial cleanup,** LL sections are frozen — the curation pipeline
is the only writer. Ongoing curation is triggered by feedback report volume
(monthly baseline + reminder hook), not LL entry count.

### Triggers

| Trigger | Scope | Rationale |
|---------|-------|-----------|
| Monthly baseline | All skills with feedback reports | Prevents staleness, keeps process familiar |
| Reminder hook fires (10+ reports or oldest >60d) | All skills with feedback reports | Accelerate during busy periods |
| `/curate-skills` | All skills (or named skill) | Manual trigger |

Named skill override: `/curate-skills scheduling-engine` runs curation on that skill
specifically. Useful when you know an observation needs validation.

### Scoring: Evidence Strength + Consensus (No Numeric Scores)

The code-review plugin uses a black-box confidence score (threshold: 80). We
can't replicate this and don't need to. Instead, we use two transparent signals:

**1. Evidence strength per finding** — each reviewer states what level of
evidence supports its classification:

| Level | Label | Example | Sufficient for |
|---|---|---|---|
| 1 | **test** | "cargo test test_name passes, confirming behavior" | Any classification |
| 2 | **source** | "function_name at file:line implements this" | Any classification |
| 3 | **git** | "commit abc123 changed the referenced behavior" | Any classification |
| 4 | **reasoning** | "this seems like a general shell fact" | consolidate/compress only |

Reviewers must label their evidence level for each entry. This replaces a
numeric score — the consolidator and human reviewer can see exactly what
backs each classification.

**2. Consensus across reviewers** — how many of the 5 agree on classification:

| Consensus | + Evidence | Action |
|---|---|---|
| 4-5/5 agree | Any level | Act on it |
| 3/5 agree | Level 1-3 | Act, cite dissenting evidence |
| 3/5 agree | Level 4 only | Escalate to validation subagent |
| 2/5 or less | Any level | Escalate to validation subagent |
| Any says "wrong" | Any level | Always escalate |
| Adversarial says "suspicious" | Any level | Always escalate |

**Why no numeric scores:**
- Transparent: human reviewer sees evidence + consensus, not opaque numbers
- Actionable: "3/5 agree, all citing source lines" is more useful than "score: 82"
- The 5-reviewer consensus is itself a confidence signal — adding per-finding
  scores on top would be redundant
- Code review's threshold works because the plugin controls both scoring and
  filtering. We control the reviewers — we can require evidence directly.

### Guardrails

- Reviewers are read-only subagents — cannot damage skill files
- Consolidators edit only their own skill — scoped by launch-phase group
- All edits go through PR with code review — human approves before merge
- Every deletion must cite evidence (no "seems outdated" deletions)
- Net token delta must be negative or neutral per PR
- `[reviewed: keep]` tag on LL entries prevents future re-flagging
  (set by human during PR review if they disagree with a deletion)
- Curation prompts are versioned in git — bad prompt changes are revertible

### Feedback Loop: How Curation Improves Itself

The curation system has three layers that produce learning, and that learning needs
to flow back into the prompts and process. Without this loop, curation quality
is static — the same blind spots repeat every pass.

#### Sources of learning

1. **Consolidator experience.** Each consolidator encounters situations the prompts
   didn't anticipate: a reviewer angle that consistently produces low-value output,
   a type of LL entry that all 5 reviewers misclassify, a validation subagent that
   can't answer the question posed to it. The consolidator sees these failures
   firsthand.

2. **Code review findings.** The code-review loop on the curation PR catches
   systematic issues: cross-skill dupes that scope reviewers missed, deletions
   with weak evidence that slipped through consensus, promoted content that
   doesn't fit the target section. These findings point to prompt weaknesses.

3. **Human PR review.** The human reviewer catches things code review misses:
   a deleted lesson that was actually critical, a promotion that lost nuance,
   a wrong classification that passed all automated checks. Human corrections
   are the highest-signal feedback.

#### Where learning is captured

**New skill: `.claude/skills/curation/SKILL.md`**

The curation process gets its own skill file with its own Lessons Learned section.
This is the meta-skill — it documents how to curate well, and its LL entries
describe what went wrong in previous passes.

Example LL entries after a few passes:
```
- 2026-04-15: Adversarial reviewer found 0 wrong entries across 4 skills but flagged
  3 as "suspicious" that were all correct. Prompt may be too aggressive — consider
  requiring the adversarial reviewer to propose a specific test that would disprove
  the entry rather than reasoning abstractly about causation.
- 2026-04-15: Scope reviewer missed PIPESTATUS duplicate between shell-scripting and
  multi-agent-orchestration because the wording differed significantly. Prompt should
  instruct scope reviewer to match on behavior described, not just wording.
- 2026-05-20: History reviewer correctly caught a lesson added during an emergency
  commit that misidentified the root cause. This angle is high-value — keep 5
  reviewers even for skills near the threshold.
```

**When these entries hit threshold (6+), the curation skill itself gets curated.**
The consolidator for the curation skill reads the curation prompts as its source
files. Its accuracy reviewer checks whether LL entries about prompt weaknesses
have been addressed in prompt updates. Its adversarial reviewer tries to disprove
claims about what works and what doesn't.

#### How learning flows back into prompts

| Learning source | Captured in | Flows back to |
|---|---|---|
| Consolidator experience | Curation skill LL | Consolidator prompt refinement |
| Code review findings | Curation skill LL + PR comments | Reviewer prompts + curation checklist |
| Human PR review | `[reviewed: keep]` tags + PR comments | Reviewer prompts (reduce false positives) |
| Curation-of-curation pass | Curation skill body updates | All curation prompts |

#### The self-curation cycle

```
Pass 1: Curation runs → produces PR → code review finds issues → human reviews
         → lessons captured in curation skill LL

Pass 2: Curation runs (with improved prompts from Pass 1 lessons)
         → curation skill itself hits threshold
         → curation skill gets curated alongside domain skills
         → consolidator reads curation prompts as source files
         → reviewer finds: "prompt says X but Pass 1 showed Y"
         → prompt updated as part of the curation PR

Pass 3: Curation runs with double-refined prompts
         → fewer code review findings (prompts addressed prior weaknesses)
         → remaining lessons are truly novel, not repeated mistakes
```

This converges: early passes produce many lessons (the prompts are naive), later
passes produce fewer (the prompts have absorbed prior learning). The curation skill's
LL section should shrink over time as lessons are promoted into the prompts themselves.

#### Prompt versioning

Curation prompts live in `docs/prompts/curation/` and are versioned in git like
any other code. Each curation PR that modifies prompts includes:

- What changed in the prompt
- Which curation pass / code review finding motivated the change
- Before/after comparison of what the change would have caught

This makes prompt evolution reviewable and revertible. A bad prompt change that
causes a future pass to delete valid lessons can be identified and rolled back.

#### Bootstrapping

The first curation pass has no prior learning — the prompts are initial drafts.
Expected outcomes:

- **Pass 1 will be imperfect.** Some deletions will be wrong, some promotions
  will be awkward, the adversarial reviewer will be miscalibrated. This is fine.
  The code review loop and human review catch the worst issues, and the lessons
  feed into Pass 2.
- **Don't over-engineer prompts before Pass 1.** Write reasonable initial prompts,
  run the pass, learn from the results. The feedback loop is the optimization
  mechanism, not upfront prompt engineering.
- **Run Pass 1 on multi-agent-orchestration only.** It has 20 entries (far above
  threshold) and the most diversity of entry types. It's the best test case for
  all 5 reviewer angles. Use findings to refine prompts before broader rollout.

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
**Why structured YAML over prose:**

- **Parsable by consolidator.** Pre-process before spawning reviewers: count
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

Every consolidator sees all reports in the batch (max 20). The `files` field
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

**Execution: `scripts/curate-skills.sh` handles the mechanical loop.**

Every step except the final code review is deterministic and should be a
script, not agent judgment. The agent's only role is invoking the script
and then running code review on the resulting PR.

```
/curate-skills:
  1. Agent runs: ./scripts/curate-skills.sh
  2. Script handles everything:
     - Count reports, select oldest 20, write manifest
     - Run launch-phase.sh (stage + merge)
     - Move processed reports to feedback/processed/
     - Loop (max 3 iterations)
     - Create PR
  3. Agent runs code review loop on the PR
```

**scripts/curate-skills.sh** (mechanical, 100% reliable):

```bash
#!/usr/bin/env bash
set -uo pipefail

FEEDBACK_DIR="docs/prompts/curation/feedback"
PROCESSED_DIR="$FEEDBACK_DIR/processed"
MANIFEST="$FEEDBACK_DIR/.batch-manifest"
CONFIG="docs/prompts/curation/skill-curation.yaml"
BATCH_SIZE=20
MAX_ITERATIONS=3

mkdir -p "$PROCESSED_DIR"

iteration=0
while true; do
    # Select oldest reports (sort by filename which starts with date)
    mapfile -t reports < <(find "$FEEDBACK_DIR" -maxdepth 1 -name "*.md" \
        -not -name "debrief-template.md" | sort | head -n "$BATCH_SIZE")
    count=${#reports[@]}

    if [ "$count" -eq 0 ]; then
        echo "[curate] No reports to process."
        break
    fi

    iteration=$((iteration + 1))
    if [ "$iteration" -gt "$MAX_ITERATIONS" ]; then
        echo "[curate] Max iterations ($MAX_ITERATIONS) reached. $count reports remaining."
        break
    fi

    echo "[curate] Iteration $iteration: processing $count reports"

    # Write manifest (consolidator prompt reads this)
    printf '%s\n' "${reports[@]}" > "$MANIFEST"

    # Run single-stage curation (all skills in parallel, then merge)
    ./scripts/launch-phase.sh "$CONFIG" all
    exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "[curate] launch-phase.sh failed (exit $exit_code). Stopping."
        break
    fi

    # Move processed reports — exactly the files in the manifest
    while IFS= read -r report; do
        mv "$report" "$PROCESSED_DIR/"
    done < "$MANIFEST"
    rm -f "$MANIFEST"
done

# Create PR if any iterations ran
if [ "$iteration" -gt 0 ]; then
    ./scripts/launch-phase.sh "$CONFIG" create-pr
    echo "[curate] PR created. Run code review."
else
    echo "[curate] Nothing to do."
fi
```

**What the script guarantees (no agent judgment needed):**
- Correct report count (find + wc)
- Correct oldest-first selection (sort by date-prefixed filename)
- Manifest matches exactly what gets processed
- Processed reports moved only after successful launch-phase
- Iteration limit enforced (max 3 = 60 reports max)
- PR created once at the end, not per iteration
- Template file excluded from report selection
- Failed launch-phase stops the loop (don't process more if merge broke)

**What the agent does (judgment needed):**
- Invoke the script
- Handle partial failures (see below)
- Run `/code-review` on the resulting PR with curation checklist
- Iterate on review findings (max 3 review rounds)
- Inform the user when the PR is ready for human review

**Failure modes and agent recovery:**

The script leaves clear state so the agent can recover without re-processing.

| Failure | State left behind | Agent action |
|---|---|---|
| Iteration N fails, previous iterations succeeded | Merge branch has iterations 1..N-1 edits. Reports 1..(N-1)*20 in `processed/`. Failed batch's manifest in `.batch-manifest`. | Check merge branch — if it has valuable edits, create PR with partial work. Note failed iteration in PR description. Remaining reports stay in `feedback/` for next run. |
| One skill's consolidator fails within a stage | Other skills' branches merged. Failed skill's branch missing or empty. | launch-phase.sh handles this (partial stage success). Agent checks which skills succeeded. Create PR with partial edits, note failed skill. |
| Script dies mid-move (reports partially moved) | `.batch-manifest` still exists. Some reports in `processed/`, some in `feedback/`. | Agent reads manifest, checks which reports are in `processed/` vs `feedback/`. Moves remaining manifest entries to `processed/` (they were already curated — the merge succeeded before the move step). |
| Code review finds issues with curated content | PR exists with edits. | Normal review-fix loop — agent fixes issues, re-pushes. Same as any code PR. |
| All 3 iterations succeed but reports remain (>60 pending) | 60 reports processed, remainder in `feedback/`. | Agent creates PR for the 60 processed. Informs user that N reports remain for the next curation run. |

**Script state artifacts the agent can inspect:**

| Artifact | Meaning |
|---|---|
| `.batch-manifest` exists | Last iteration didn't complete cleanly (manifest wasn't cleaned up) |
| `.batch-manifest` absent | Last iteration completed (or no iterations ran) |
| `processed/` has files | At least one iteration completed successfully |
| `feedback/` still has reports | Either: iterations remain, or a failure left unprocessed reports |

**Recovery principle:** Partial curation is always better than no curation.
If any iteration succeeded, create the PR with whatever edits exist. The
failed skill or remaining reports get handled in the next curation run.
Never discard successful work because a later step failed.

**The launch config is static and reusable** — never changes between
iterations or curation passes. The consolidator prompt says "read
`.batch-manifest` for your report list." The manifest is the only
variable, and the script controls it.

**No pre-filtering.** Every consolidator sees all reports in the batch
(max 20 × ~75 tokens = ~1500 tokens). The scope reviewer determines
relevance per-skill. If volume grows to where this is a problem,
file-path filtering can be added to the script later — but not now.

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

2. **Phase group prompts.** The consolidator prompt template includes the
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
3. `curate-skills.sh` writes batch manifest, runs launch-phase
4. Consolidator reads manifest, spawns 5 reviewers on batch reports
5. Reviewers classify observations; consolidator synthesizes + edits skill
6. `curate-skills.sh` moves processed reports to `feedback/processed/`
7. After all iterations, PR created; code review loop validates edits

**This replaces direct LL writes.** The CLAUDE.md instruction changes from
"append confirmed gotchas to skill Lessons Learned" to "write debrief to
feedback/ directory." The LL section becomes write-only by the curation
pipeline, not by individual agents. This is the key quality gate — no
unvalidated content enters skill files.

### Prompt Improvement via Feedback Reports

Curation agents (consolidators) also write debrief reports after each pass.
These describe prompt-level observations: which reviewer angles were useful,
what the consensus matrix couldn't resolve, what the code review caught that
reviewers missed.

Prompt feedback reports accumulate in the same `feedback/` directory, with
`files` referencing `docs/prompts/curation/*.md`. When 6+ curation-related
reports accumulate, the curation pattern runs on itself:

- "Source code" = `docs/prompts/curation/*.md` (the prompt templates)
- "LL entries" = feedback reports tagged `curation`
- 5 reviewers check whether reported prompt weaknesses have been addressed
- Consolidator edits the prompt files
- Code review validates the prompt changes

```
Level 0: Implementing agents → debrief reports (domain observations)
Level 1: Domain curation → skill edits + debrief reports (prompt observations)
Level 2: Prompt curation → prompt edits (using prompt observations as input)
```

**Recursion bottoms out naturally:**
- Level 0 produces many reports (every agent, every task)
- Level 1 produces few reports (one per skill per curation pass)
- Level 2 produces ~0-1 reports (almost nothing to observe about meta-curation)
- Level 3 never triggers (insufficient volume)

**Cadence alignment:**
- Domain curation: monthly baseline, accelerate when reminder hook fires
- Prompt curation: when 6+ curation-related feedback reports accumulate
  (roughly every 3-6 domain curation passes)
- Prompts should evolve slowly — not every pass, but not neglected either

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
AGE_THRESHOLD_DAYS=60

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
| Age: 60 days oldest | — | Beyond 60 days, referenced code likely changed; observations may be stale |

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
| How do I debug a stalled consolidator agent? | multi-agent-orchestration skill |
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

1. **Expand `scripts/` in the project structure map.** Currently one line;
   needs the same detail level as the Rust scheduler entry so the explorer
   understands what each orchestration library does:

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
- 5 prompt files: `reviewer-accuracy.md`, `reviewer-structure.md`,
  `reviewer-scope.md`, `reviewer-history.md`, `reviewer-adversarial.md`

### Open Questions

1. **Consolidator scope beyond LL.** Reviewers flag skill body issues. Should
   consolidators fix them? Recommendation: fix only clearly wrong facts (stale
   function names). Larger restructuring → separate issue.

2. **Cost calibration.** Initial pass: 5 reviewers × 6 skills = 30 subagents +
   6 consolidators. Ongoing passes depend on feedback volume. Monitor cost after
   first pass and calibrate — if a skill has only 1-2 relevant observations in
   a batch, 5 reviewers may be overkill. Consider 3 reviewers (accuracy, scope,
   adversarial) for light batches.

3. **Metrics.** Track entries deleted/promoted/wrong per pass, plus token savings.
   Defer until after 2-3 passes.

4. **Cross-skill dedup depth.** Each consolidator flags dupes; code review catches
   them in the full diff. If insufficient, add a post-merge dedup pass.

5. **`prompt_vars` in launch config.** launch-phase.sh doesn't currently support
   variable substitution in prompts. Options: (a) add template support to
   launch-phase.sh, (b) use one prompt file per skill (more files, no templating
   needed), (c) consolidator prompt reads skill name from its group ID and
   discovers source paths via a mapping in the prompt itself.

6. **Supervisor decision tree.** The supervisor prompt (`docs/prompts/supervisor.md`)
   encodes complex branching logic as prose paragraphs. A structured format (YAML
   state machine or decision table) would be more deterministic for retry/fail/skip
   decisions. Not blocking — the supervisor works today — but worth revisiting as
   the pipeline matures.

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

### Files that reference the old LL process (need updating in step 11)

- `CLAUDE.md` — behavioral rules (Tier 0 change above)
- `.claude/skills/issue-workflow/SKILL.md` — verification checklist
- Phase group prompt templates — add debrief as final step
- `.claude/skills/*/SKILL.md` — LL section header comment may reference
  the old "agents: append here" instruction

## Expected Result

| Metric                          | Before  | After       |
|---------------------------------|---------|-------------|
| Root CLAUDE.md tokens           | ~3900   | ~1500-2000  |
| Duplicate rule instances        | 3-4 each| 1 + refs    |
| "Fix a CSS bug" context cost    | ~3900   | ~1500       |
| "Scheduling fix" context cost   | ~4750   | ~2700       |
| Instruction drift risk          | High    | Low         |
