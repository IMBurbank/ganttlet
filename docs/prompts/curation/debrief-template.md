# Debrief Report Template

Write your debrief report. Generate the filename with this command:

```bash
echo "docs/prompts/curation/feedback/$(date +%Y-%m-%d)-$(git branch --show-current | tr '/' '-')-$(openssl rand -hex 2).md"
```

This produces unique filenames like:
- `2026-03-17-agent-issue-42-a1f2.md`
- `2026-03-18-curation-scheduling-engine-b3c4.md`

The date prefix is required — reports are processed oldest-first by filename sort.
The random suffix prevents collisions when multiple debriefs are written from
the same branch on the same day.

## Format

```yaml
---
date: YYYY-MM-DD
agent: agent/issue-42          # your branch name
task: "Brief description of what you were doing"
commits:
  first: abc1234               # your first commit on this branch
  last: def5678                # your last commit on this branch
---

observations:
  - type: undocumented_behavior
    summary: "One-line description of what you found"
    evidence: "How you verified this — source file:line, test name, or command output"
    files: ["path/to/relevant/file.rs", "path/to/other/file.ts"]

  - type: wrong_documentation
    summary: "What the docs say vs what the code actually does"
    evidence: "The specific contradiction — cite both the doc and the source"
    files: ["path/to/source.rs", ".claude/skills/skill-name/SKILL.md"]

  - type: unexpected_result
    summary: "What you expected vs what happened"
    evidence: "The command or test that produced the unexpected result"
    files: ["path/to/file.ts"]

  - type: workflow_gap
    summary: "What was missing or awkward in the development process"
    evidence: "What you had to work around and how"
    files: ["scripts/relevant-script.sh"]
```

## Observation Types

| Type | What it captures |
|---|---|
| `undocumented_behavior` | Behavior not covered by any skill or docs |
| `wrong_documentation` | Existing docs/skills contradict actual behavior |
| `unexpected_result` | Function/tool produced surprising output |
| `workflow_gap` | Missing tooling, awkward process, friction |
| `nothing_to_report` | Explicit skip — you had no observations |
| `threshold_calibration` | Scoring threshold evaluation (curation curators only) |

## If You Have Nothing to Report

```yaml
---
date: YYYY-MM-DD
agent: agent/issue-43
task: "Brief description"
commits:
  first: aaa1111
  last: aaa1111
---

observations:
  - type: nothing_to_report
```

## What Makes a Good Observation

**Good** (specific, verified, actionable):
```yaml
- type: undocumented_behavior
  summary: "cascade_dependents silently skips tasks with no start date"
  evidence: "Read cascade.rs:47 — early return on None with no log or error"
  files: ["crates/scheduler/src/cascade.rs"]
```

**Bad** (vague, unverified, not actionable):
```yaml
- type: undocumented_behavior
  summary: "cascade seems to have edge cases"
  evidence: "I noticed some tasks weren't updating"
  files: []
```

## Rules

- Only include observations you verified by reading source or running tests
- Every observation needs an `evidence` field — what you checked and what you found
- Every observation needs a `files` field — what source files are involved
- If you can't provide evidence, don't include the observation
- Skip the entire report if you genuinely have nothing to report
  (write `nothing_to_report` so the verify hook knows you didn't forget)

## Why Quality Matters

Unverified or vague observations that pass through the curation pipeline and
enter a skill file are actively harmful — not just wasteful. Research on LLM
agent memory shows that wrong content biases future agents toward incorrect
behavior. An agent reads a claim that looks relevant, follows it, and
produces wrong code. A missing observation costs nothing; a wrong observation
costs every future agent that reads it. When in doubt, leave it out.
