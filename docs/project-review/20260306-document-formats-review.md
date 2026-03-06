# Document Formats Review

**Date:** 2026-03-06
**Scope:** Plain text document usage across the project — documentation, planning, tracking, context, and rule management
**Goal:** Compare current practices to state-of-the-art for project management and agent orchestration; recommend where structured formats would yield significant improvements

---

## Document Inventory by Use Case

| Use Case | Files | Current Format |
|---|---|---|
| Agent Rules | `CLAUDE.md` | Prose + bullets + table |
| Task Queue | `docs/TASKS.md` | Checkboxes + nested headings |
| Agent Prompts | `docs/prompts/phase*/group*.md` | Prose + numbered steps + code |
| Phase Planning | `docs/prompts/phase*/README.md` | Prose + ASCII diagrams + bash config |
| Progress Tracking | `claude-progress.txt` | Append-only plain text lines |
| Issue Backlog | `docs/unplanned-issues.md` | Checkboxes + manual sections |
| Architecture | `docs/architecture.md` | Prose + bullets |
| Phase History | `docs/completed-phases.md` | Prose + bullets (inconsistent) |
| Orchestration Guide | `docs/multi-agent-guide.md` | Prose + tables + code examples |
| Skills | `.claude/skills/*/SKILL.md` | YAML frontmatter + markdown |
| Agent Memory | `memory/MEMORY.md` | Headings + bullets |
| Runbooks | `docs/plugin-adoption-plan.md` | Tables + checkboxes + prose |
| RCA / Analysis | `docs/phase14-recommendations.md` | Deep prose + code snippets |

---

## Assessment by Use Case

### 1. Agent Prompts (`docs/prompts/phase*/group*.md`) — HIGH improvement potential

**Current state:** Free-form markdown with implicit conventions (task IDs like `B1:`, file scope in prose, success criteria as bullets). Each prompt re-embeds shared rules (Error Handling Protocol, commit conventions).

**Problem:** No machine-parseable structure means `launch-phase.sh` can't validate file scope overlap between agents, can't auto-generate progress templates, and can't detect when two groups claim the same file. The orchestrator treats prompts as opaque blobs.

**Recommendation: YAML frontmatter + templated sections**

```yaml
---
phase: 14
group: B
agent_count: 1
scope:
  modify:
    - src/state/ganttReducer.ts
    - src/state/actions.ts
  read_only:
    - src/types/index.ts
depends_on: []
tasks:
  - id: B1
    summary: "Fix drag-end snap to grid"
    files: [src/state/ganttReducer.ts]
  - id: B2
    summary: "Add RESIZE_TASK newDuration validation"
    files: [src/state/actions.ts]
---
```

**Why it matters:**
- Scope overlap detection becomes trivial — parse frontmatter, compare `scope.modify` arrays
- Progress tracking can auto-scaffold from `tasks[].id`
- Shared rules (Error Handling, commit conventions) can be injected by `launch-phase.sh` instead of duplicated
- This is what production multi-agent orchestration systems (e.g., Devin's task specs, SWE-agent's instance configs) do — structured metadata envelope around natural-language instructions

**Effort:** Medium. Requires updating `launch-phase.sh` to parse frontmatter and modifying the prompt template.

---

### 2. Task Queue (`docs/TASKS.md`) — MEDIUM-HIGH improvement potential

**Current state:** 505-line markdown file mixing completed phase history, planning prose, and active task checkboxes. Execution order is implicit in nesting. No separation between "done" and "active."

**Problem:** A single file serves as both historical record and active work queue. Agents must read 500+ lines to find their tasks. Checkbox status requires manual editing and has no timestamps, no assignee tracking, no dependency graph.

**Recommendation: Split into structured task definitions**

Option A — YAML task files (one per phase):
```yaml
# docs/tasks/phase14.yaml
phase: 14
status: in_progress
groups:
  - id: A
    tasks:
      - id: A1
        summary: "Drag preview layer"
        status: done
        assignee: agent-1
      - id: A2
        summary: "Pointer capture management"
        status: in_progress
        depends_on: [A1]
```

Option B — GitHub Issues + Projects (if you want external tooling): Use GitHub Projects board with custom fields for phase/group/task-id. Agents interact via `gh` CLI.

**Why it matters:** Structured task data enables automated status dashboards, dependency validation, and prevents the "500-line scroll" problem for agents consuming context tokens on irrelevant history.

**Effort:** Medium. Migration script can parse existing checkboxes.

---

### 3. Progress Tracking (`claude-progress.txt`) — MEDIUM improvement potential

**Current state:** Append-only plain text with semi-structured lines like `B1: DONE — description`. No schema, no timestamps, no validation.

**Problem:** Format is almost machine-parseable but not quite — status values aren't enumerated, no timestamps means you can't distinguish stale entries from fresh ones, and "append-only" means the file grows monotonically with no cleanup. Agents re-reading it on restart waste tokens on completed work.

**Recommendation: Structured log format**

```jsonl
{"task":"B1","status":"DONE","group":"B","phase":14,"ts":"2026-03-06T10:23:00Z","msg":"Fixed drag snap"}
{"task":"B2","status":"BLOCKED","group":"B","phase":14,"ts":"2026-03-06T10:45:00Z","msg":"Waiting on A1"}
```

Or tighten the existing format with a documented schema:
```
# Format: PHASE.GROUP.TASK | STATUS | TIMESTAMP | MESSAGE
# STATUS values: TODO, IN_PROGRESS, DONE, BLOCKED, SKIPPED
14.B.1 | DONE | 2026-03-06T10:23Z | Fixed drag snap
```

**Why it matters:** Timestamps let restart logic skip old entries. Enumerated statuses enable automated phase-completion checks. JSONL is trivially parseable by both scripts and agents.

**Effort:** Low. Just define the schema and update the CLAUDE.md instruction.

---

### 4. Agent Rules (`CLAUDE.md`) — LOW improvement potential (keep as-is)

**Current state:** Well-organized markdown with clear headings, a command reference table, and behavioral rules in bullets.

**Assessment:** Already close to best practice. CLAUDE.md is consumed by the LLM context window, not by machines. Markdown is the optimal format — human-readable, version-controllable, and natively understood by LLMs. Adding YAML or JSON structure would hurt readability without helping comprehension.

**Minor recommendation:** Add explicit section anchors so other docs can deep-link, and consider splitting the "Commands Quick Reference" table into a separate file to reduce always-loaded context size.

---

### 5. Skills (`.claude/skills/*/SKILL.md`) — LOW improvement potential (already good)

**Current state:** YAML frontmatter + markdown body.

**Assessment:** This is the gold standard in this project. The frontmatter enables tool matching; the markdown body provides context. No changes needed.

---

### 6. Architecture & Phase History — LOW improvement potential

**Current state:** Prose-heavy narrative documentation.

**Assessment:** Reference documents for human and agent understanding. Prose is appropriate. The inconsistent structure between phases in `completed-phases.md` is mildly annoying but doesn't cause real problems.

**Minor recommendation:** Add a summary table at the top of `completed-phases.md`:

```markdown
| Phase | Name | Status | Groups | Key Deliverable |
|-------|------|--------|--------|-----------------|
| 0 | Project Setup | DONE | 1 | Vite + React scaffold |
| 1 | Gantt Rendering | DONE | 2 | Canvas timeline |
```

---

### 7. Issue Backlog (`unplanned-issues.md`) — LOW-MEDIUM improvement potential

**Current state:** 38-line file with manual Backlog/Claimed/Planned sections.

**Assessment:** Duplicates GitHub Issues but worse — no labels, assignees, timestamps, or cross-references. Small enough that overhead of structured format isn't justified.

**Recommendation:** Migrate to GitHub Issues with an `unplanned` label, or keep as-is given its small size.

---

### 8. Phase Planning READMEs — MEDIUM improvement potential

**Current state:** Prose-heavy with embedded bash config blocks for `launch-phase.sh`.

**Problem:** Bash config embedded in markdown is copy-pasted into invocations. Typos aren't caught until runtime.

**Recommendation:** Extract launch config into a dedicated file:

```yaml
# docs/prompts/phase14/launch-config.yaml
phase: 14
stages:
  - groups: [A, B, C]
    branches: [phase14/drag-preview, phase14/sync-integrity, phase14/constraint-engine]
    merge_message: "Merge phase14 stage 1: core fixes"
  - groups: [D, E, F]
    depends_on_stage: 1
```

Then `launch-phase.sh` reads this directly instead of relying on copy-pasted bash arrays.

**Effort:** Medium. Requires modifying `launch-phase.sh` to parse YAML (or use `yq`).

---

### 9. Agent Memory (`MEMORY.md`) — LOW improvement potential (keep as-is)

**Assessment:** Consumed exclusively by the LLM. Free-form markdown with cross-references to topic files is the right pattern.

---

## Priority Summary

| Priority | Use Case | Current | Recommended | Impact |
|----------|----------|---------|-------------|--------|
| 1 (High) | Agent Prompts | Free-form MD | YAML frontmatter + MD body | Scope validation, dedup, auto-scaffolding |
| 2 (High) | Task Queue | Single 500-line MD | Per-phase YAML or split files | Token efficiency, dependency tracking |
| 3 (Med) | Progress Tracking | Append-only text | JSONL or schema'd text | Restart efficiency, automated checks |
| 4 (Med) | Launch Config | Bash arrays in prose | Dedicated YAML config | Typo prevention, tooling integration |
| 5 (Low) | Phase History | Inconsistent prose | Add summary table | Quick agent indexing |
| 6 (None) | CLAUDE.md, Skills, Memory, Architecture | Already appropriate | Keep as-is | N/A |

## Key Principle

**Is this document consumed by automation/tooling, or only by humans/LLMs?**

- **Human/LLM-consumed** (CLAUDE.md, architecture, memory, skills body): Markdown prose is optimal. Don't over-structure.
- **Tooling-consumed** (prompts metadata, task status, progress logs, launch config): Structure pays for itself immediately in validation, automation, and reduced duplication.
- **Both** (TASKS.md, phase READMEs): Use structured metadata (frontmatter/YAML) for the machine-consumed parts, keep prose for the human-consumed narrative.

The project's skills files already demonstrate this dual pattern — YAML frontmatter for tooling, markdown body for context. Extending that pattern to prompts, tasks, and launch config would be the highest-leverage improvement.

## Naming Convention for Review Documents

This project uses `docs/project-review/` with the pattern:

```
YYYYMMDD-<scope>-<type>.md
```

- Date-prefix gives chronological sorting
- Scope identifies what was reviewed
- Type suffix (`-review`, `-recommendations`, `-rca`, `-decision`) distinguishes purpose
