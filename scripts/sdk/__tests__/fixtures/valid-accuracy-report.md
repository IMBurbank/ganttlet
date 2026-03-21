## Skill Review: scheduling-engine — accuracy

### Skill Content Findings
| # | Claim | Classification | Evidence | Evidence level |
|---|---|---|---|---|
| 1 | "cascade skips no-start tasks" | delete | cascade.rs:47 now validates dates | source |
| 2 | "PIPESTATUS required in tee" | consolidate | Duplicate of shell-scripting skill content | reasoning |

### Feedback Report Findings
| Report | Obs # | Summary | Classification | Evidence | Evidence level |
|---|---|---|---|---|---|
| 2026-03-17-agent-issue-42.md | 1 | "cascade skips silently" | keep | Non-obvious, not in any docs | reasoning |
| 2026-03-17-agent-issue-42.md | 2 | "skill says ES from deps only" | wrong | cascade.rs refactored in abc123 | git |
