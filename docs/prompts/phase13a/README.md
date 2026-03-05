# Phase 13a: Post-Implementation Cleanup — Planning Summary

## Overview

Phase 13a is an addendum cleanup stage that fixes cross-group inconsistencies identified in
the Phase 13 post-implementation review (`docs/phase13-review.md`). Phase 13 ran 4 parallel
agents that couldn't coordinate, so documentation written by Group A doesn't reflect features
built by Group B, and two skills are lighter than the others.

## Structure

**Single stage with 2 parallel groups.** Zero file overlap.

```
Stage 1 (2 groups, parallel)
├── Group E: Doc Alignment (docs/multi-agent-guide.md, CLAUDE.md)
└── Group F: Skill Enrichment (.claude/skills/google-sheets-sync/, .claude/skills/cloud-deployment/)
```

No validation stage needed — these are documentation-only changes.

## launch-phase.sh Config Block

```bash
PROMPTS_DIR="${PROMPTS_DIR:-docs/prompts/phase13a}"
PHASE="phase13a"

STAGE1_GROUPS=("groupE" "groupF")
STAGE1_BRANCHES=(
  "feature/phase13a-doc-alignment"
  "feature/phase13a-skill-enrichment"
)
STAGE1_MERGE_MESSAGES=(
  "Merge feature/phase13a-doc-alignment: sync multi-agent-guide.md with launch-phase.sh, fix WATCH mode description, add pre-commit hook to CLAUDE.md"
  "Merge feature/phase13a-skill-enrichment: enrich google-sheets-sync and cloud-deployment skills with specific gotchas"
)

STAGE2_GROUPS=()
STAGE2_BRANCHES=()
STAGE2_MERGE_MESSAGES=()
STAGE3_GROUPS=()
STAGE3_BRANCHES=()
STAGE3_MERGE_MESSAGES=()
```

## Workload Assessment

| Group | Est. Files Modified | Complexity |
|-------|-------------------|------------|
| E     | 2                 | Low — straightforward doc updates against known diffs |
| F     | 2                 | Low — reading source files and adding gotchas to skills |

## What This Does NOT Address

- **WATCH mode `-p` regression** (Priority 2 in review) — requires design work and possibly
  CLI changes. Tracked separately, not a simple doc fix.
- **`.agent-status.json` structured progress** (P2 recommendation) — acceptable to keep
  `claude-progress.txt` for now.
- **Two-pass validation** (P2 recommendation) — not addressed, low urgency.
