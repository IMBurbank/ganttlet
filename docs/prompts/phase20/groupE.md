---
phase: 20
group: E
stage: 3
agent_count: 1
scope:
  modify:
    - src/sheets/sheetCreation.ts
    - src/sheets/sheetsSync.ts
    - src/components/onboarding/WelcomeGate.tsx
    - src/components/onboarding/SyncStatus.tsx
    - src/components/onboarding/ErrorBanner.tsx
    - src/components/onboarding/FirstVisitWelcome.tsx
    - src/components/onboarding/PromotionFlow.tsx
    - src/components/onboarding/ReturnVisitorWelcome.tsx
    - src/components/onboarding/EmptyState.tsx
    - src/components/onboarding/ChoosePath.tsx
    - src/components/onboarding/CollaboratorWelcome.tsx
    - src/components/onboarding/HeaderMismatchError.tsx
    - src/components/shared/ContextMenu.tsx
    - src/components/panels/ChangeHistoryPanel.tsx
    - src/components/panels/UserPresence.tsx
  delete:
    - src/state/GanttContext.tsx
    - src/state/ganttReducer.ts
    - src/state/actions.ts
    - src/state/initialState.ts
    - src/collab/yjsBinding.ts
    - src/state/__tests__/ganttReducer.test.ts
    - src/state/__tests__/dataSource.test.ts
    - src/collab/__tests__/yjsBinding.test.ts
  read_only:
    - src/store/TaskStore.ts
    - src/store/UIStore.ts
    - src/hooks/index.ts
    - src/mutations/index.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B, C]
tasks:
  - id: E1
    summary: "Read Group A/B/C outputs and the old files to understand what's being replaced"
  - id: E2
    summary: "Migrate onboarding components: WelcomeGate, FirstVisitWelcome, ChoosePath, ReturnVisitorWelcome, CollaboratorWelcome, EmptyState"
  - id: E3
    summary: "Migrate PromotionFlow — sandbox Y.Doc → Sheet promotion handoff"
  - id: E4
    summary: "Migrate ErrorBanner, SyncStatus — UIStore for dataSource/syncError"
  - id: E5
    summary: "Migrate shared: ContextMenu, UserPresence, ChangeHistoryPanel"
  - id: E6
    summary: "Delete old architecture files: GanttContext, ganttReducer, actions, initialState, yjsBinding"
  - id: E7
    summary: "Delete old test files: ganttReducer.test.ts, dataSource.test.ts, yjsBinding.test.ts"
  - id: E8
    summary: "Verify: grep for useGanttState/useGanttDispatch — zero results in production code"
---

# Phase 20 Group E — Onboarding Migration + Old Architecture Deletion

You are migrating the onboarding and shared components, then deleting the old architecture.

Read `docs/plans/frontend-redesign.md` for the architecture spec.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Groups A-C created the new architecture (stores, schema, mutations, observer, providers).
Group D runs in parallel with this group and migrates the Gantt/table/layout components.
This group migrates the onboarding components and shared modals, then deletes the old files.

NOTE: Group D runs in parallel — do NOT depend on D's output. Only depend on A+B+C outputs.

## Migration Pattern

Same as Group D — replace `useGanttState`/`useGanttDispatch` with new hooks.

### WelcomeGate routing

WelcomeGate reads `dataSource` from UIStore:
```typescript
const dataSource = useUIStore(s => s.dataSource);
```

### PromotionFlow: sandbox → sheet handoff

Per the architecture spec (§7 Sandbox → Sheet promotion):
1. SheetsAdapter writes current Y.Doc tasks to Sheet
2. WebSocket provider added to SAME Y.Doc
3. Y.UndoManager cleared (Phase 4 handles this — for now, just note the TODO)
4. UIStore.setDataSource('sheet')

### ErrorBanner + SyncStatus

`syncError` and `isSyncing` are Phase 2 (Sheets Adapter) concerns and are NOT yet in
UIState. For Phase 1: add `syncError: SyncError | null` and `isSyncing: boolean` to
UIState as stub fields (default: `null` and `false`). The Sheets Adapter (Phase 2) will
populate them. SyncStatus and ErrorBanner should compile and render correctly with these
defaults (showing no error, not syncing).

### Broken imports: sheetCreation.ts + sheetsSync.ts

Deleting `actions.ts` and `yjsBinding.ts` breaks imports in `sheetsSync.ts` and
`sheetCreation.ts`. These files are NOT deleted yet (Group F replaces them in Stage 4).
You must stub their broken imports so `tsc --noEmit` passes at the Stage 3 gate:

**`src/sheets/sheetsSync.ts`:** Remove imports from `../state/actions` and
`../collab/yjsBinding`. Replace function bodies with no-ops or stubs that log
"sheetsSync disabled — SheetsAdapter replaces this in Stage 4". The file must compile
but doesn't need to function. Group F deletes it entirely.

**`src/sheets/sheetCreation.ts`:** Remove `import type { GanttAction }` from
`../state/actions`. Replace the `dispatch: Dispatch<GanttAction>` parameter with
`mutate: (action: MutateAction) => void` from the new hooks. Update callers in
`PromotionFlow.tsx`, `EmptyState.tsx`, and `Header.tsx` (if in your scope) to pass
`mutate` instead of `dispatch`. For functions that call `sheetsSync` (initSync,
startPolling, scheduleSave), replace with TODOs: `// Stage 4 (Group F): wire to SheetsAdapter`.

## Deletion (CRITICAL)

After all migrations AND the stub fixes above, delete:
- `src/state/GanttContext.tsx` — replaced by TaskStoreProvider + UIStoreProvider
- `src/state/ganttReducer.ts` — replaced by mutation functions
- `src/state/actions.ts` — replaced by MutateAction type in hooks
- `src/state/initialState.ts` — replaced by store constructors
- `src/collab/yjsBinding.ts` — replaced by schema/ydoc.ts + mutations + observer
- `src/state/__tests__/ganttReducer.test.ts` — replaced by mutations tests
- `src/state/__tests__/dataSource.test.ts` — replaced by UIStore tests
- `src/collab/__tests__/yjsBinding.test.ts` — replaced by observer tests

### Verification: zero stale references

After deletion, run:
```bash
grep -rn "useGanttState\|useGanttDispatch\|GanttContext\|ganttReducer\|applyActionToYjs\|collabDispatch\|guardedDispatch\|withLocalUpdate" src/ --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v node_modules
```
Must return ZERO results.

## DO NOT MODIFY

- Group D handles: GanttChart, TaskBar, TaskTable, TaskRow, Header, Toolbar, etc.
- Do NOT modify files in Group D's scope

## Verification

1. `npx tsc --noEmit`
2. `npx vitest run` — all remaining tests pass
3. `npx playwright test` — **27 of 29** local E2E tests pass. 2 error-state tests
   (HeaderMismatch, ErrorBanner) are expected to fail — they mock Sheets API responses
   which are not wired until Stage 4 (Group F). Mark them as `test.skip`
   with comment `// Stage 4 (Group F): requires SheetsAdapter`.
4. Zero stale references (grep check above)
5. Commit with conventional commit message
