---
phase: 20
group: J
stage: 7
agent_count: 1
scope:
  modify:
    - CLAUDE.md
    - src/CLAUDE.md
    - src/sheets/CLAUDE.md
    - e2e/CLAUDE.md
    - .claude/skills/google-sheets-sync/SKILL.md
    - .claude/skills/e2e-testing/SKILL.md
    - .claude/skills/scheduling-engine/SKILL.md
    - .claude/agents/codebase-explorer.md
    - .claude/agents/rust-scheduler.md
    - docs/architecture.md
    - docs/completed-phases.md
    - docs/TASKS.md
  read_only:
    - docs/plans/frontend-redesign.md
    - src/store/TaskStore.ts
    - src/store/UIStore.ts
    - src/schema/ydoc.ts
    - src/mutations/index.ts
    - src/collab/observer.ts
    - src/sheets/SheetsAdapter.ts
    - src/state/TaskStoreProvider.tsx
    - src/state/UIStoreProvider.tsx
depends_on: [A, B, C, D, E, F, G, H, I]
tasks:
  - id: J1
    summary: "Read architecture spec and all new source files to understand final architecture"
  - id: J2
    summary: "Update root CLAUDE.md: Y.Doc architecture, three-way merge, new file structure"
  - id: J3
    summary: "Update src/CLAUDE.md: replace reducer/context constraints with Y.Doc/store patterns"
  - id: J4
    summary: "Update src/sheets/CLAUDE.md: SheetsAdapter class, three-way merge, attribution"
  - id: J5
    summary: "Update e2e/CLAUDE.md: verify fixture layer still accurate"
  - id: J6
    summary: "Update google-sheets-sync SKILL.md: SheetsAdapter, three-way merge"
  - id: J7
    summary: "Update e2e-testing SKILL.md: verify internal references"
  - id: J8
    summary: "Update scheduling-engine SKILL.md: compute-then-write pattern"
  - id: J9
    summary: "Update codebase-explorer agent: new file map"
  - id: J10
    summary: "Update docs/architecture.md: rewrite frontend section"
  - id: J11
    summary: "Update docs/completed-phases.md: add Phase 20"
  - id: J12
    summary: "Update docs/TASKS.md: remove addressed backlog items"
  - id: J13
    summary: "Grep for stale comments: GanttContext, useReducer, applyActionToYjs, etc."
---

# Phase 20 Group J — Documentation Update

You are updating all documentation, skills, agents, and comments to reflect the new
architecture delivered by Groups A-I.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

The frontend architecture has been completely redesigned:
- Y.Doc replaces useReducer for task state
- TaskStore + UIStore replace GanttContext
- Mutation functions replace ganttReducer task cases
- SheetsAdapter replaces sheetsSync module-level state
- SVG virtualization + Pointer Events for performance
- Y.UndoManager replaces snapshot-based undo
- y-indexeddb for crash recovery

Every reference to the old architecture in docs/skills/agents must be updated.

## Key Updates

### Root CLAUDE.md
- Architecture Constraints: add "Y.Doc is live session state" and "Sheet is durable truth"
- Replace "COMPLETE_DRAG is atomic" with "mutations use compute-first + atomic transact"
- Replace "SET_TASKS guarded during drag" with "commit-on-drop pattern"

### src/CLAUDE.md
- Replace "useReducer + Context" references
- Add: "TaskStore for task data, UIStore for display state, Y.Doc for collaboration"
- Update commands if any changed

### src/sheets/CLAUDE.md
- Replace "sheetsSync module" with "SheetsAdapter class"
- Add: "Three-way merge with base values in IndexedDB"
- Add: "lastModifiedBy + lastModifiedAt attribution columns"

### docs/architecture.md
- Rewrite the frontend section with the new architecture diagram
- Document the five state domains
- Document the three mutation sources → one consumption path

### docs/TASKS.md
- Remove addressed items: memoization (React Compiler), virtualization, undo, sync races
- Keep future items: semantic zoom, resource leveling, export

### Stale comment grep
```bash
grep -rn "GanttContext\|useGanttState\|useGanttDispatch\|ganttReducer\|applyActionToYjs\|collabDispatch\|guardedDispatch\|withLocalUpdate\|pendingFullSyncRef\|COMPLETE_DRAG\|SET_TASKS.*guard\|lastTaskSource" src/ docs/ .claude/ --include="*.ts" --include="*.tsx" --include="*.md" | grep -v node_modules | grep -v phase20
```
Fix or remove every stale reference found.

## Verification

1. `npx tsc --noEmit` (docs changes shouldn't break build, but verify)
2. `./scripts/lint-agent-paths.sh` — agent structure maps valid
3. No stale architecture references (grep above returns zero results)
4. Commit with conventional commit message
