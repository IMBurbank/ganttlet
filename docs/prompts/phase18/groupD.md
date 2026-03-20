---
phase: 18
group: D
stage: 3
agent_count: 1
scope:
  modify:
    - src/components/onboarding/WelcomeGate.tsx
    - src/App.tsx
  create:
    - src/components/onboarding/FirstVisitWelcome.tsx
    - src/components/onboarding/ReturnVisitorWelcome.tsx
    - src/components/onboarding/CollaboratorWelcome.tsx
    - src/components/onboarding/ChoosePath.tsx
    - src/components/onboarding/EmptyState.tsx
  test:
    - src/components/onboarding/__tests__/FirstVisitWelcome.test.tsx
    - src/components/onboarding/__tests__/ReturnVisitorWelcome.test.tsx
    - src/components/onboarding/__tests__/CollaboratorWelcome.test.tsx
    - src/components/onboarding/__tests__/ChoosePath.test.tsx
    - src/components/onboarding/__tests__/EmptyState.test.tsx
  read_only:
    - src/types/index.ts
    - src/state/actions.ts
    - src/sheets/oauth.ts
    - src/utils/recentSheets.ts
    - src/components/onboarding/SheetSelector.tsx
depends_on: [A, B, C]
tasks:
  - id: D1
    summary: "Read WelcomeGate.tsx, App.tsx, recentSheets.ts, SheetSelector.tsx"
  - id: D2
    summary: "Create FirstVisitWelcome.tsx"
  - id: D3
    summary: "Create ReturnVisitorWelcome.tsx"
  - id: D4
    summary: "Create CollaboratorWelcome.tsx"
  - id: D5
    summary: "Create ChoosePath.tsx"
  - id: D6
    summary: "Update WelcomeGate.tsx with real screen routing"
  - id: D7
    summary: "Create EmptyState.tsx"
  - id: D8
    summary: "Update App.tsx for EmptyState rendering"
---

# Phase 18 Group D — Onboarding Screens + Empty State

You are implementing Phase 18 Group D for the Ganttlet project.
Read `CLAUDE.md` for full project context. Read `docs/proposals/designs/design-3.md` for the
detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time Google Sheets sync. This group builds
the 4 WelcomeGate screen variants and the empty state UI for blank sheets.

## Your files:
Modify:
- `src/components/onboarding/WelcomeGate.tsx` — Replace placeholder routing with real screens
- `src/App.tsx` — Render EmptyState in AppContent when dataSource='empty'

Create:
- `src/components/onboarding/FirstVisitWelcome.tsx`
- `src/components/onboarding/ReturnVisitorWelcome.tsx`
- `src/components/onboarding/CollaboratorWelcome.tsx`
- `src/components/onboarding/ChoosePath.tsx`
- `src/components/onboarding/EmptyState.tsx`

Read-only:
- `src/types/index.ts`, `src/state/actions.ts` — DataSource, actions
- `src/sheets/oauth.ts` — signIn, isSignedIn, getUserProfile
- `src/utils/recentSheets.ts` — getRecentSheets (from Group B)
- `src/components/onboarding/SheetSelector.tsx` — opened by ReturnVisitor/ChoosePath

## Tasks — execute in order

### D1: Read and understand current state
Read WelcomeGate.tsx (Group A's placeholder), App.tsx, recentSheets.ts, SheetSelector.tsx.
Understand how the routing shell works and what needs to be replaced.

### D2: Create FirstVisitWelcome.tsx
- Shown when: no auth, no URL params
- Content: value props visible without scrolling (above the fold)
- [Try the demo] → dispatches `ENTER_SANDBOX` (lazy imports templates)
- [Sign in with Google] → triggers OAuth → after success shows ChoosePath (NOT sandbox)
- Component test verifies both actions

### D3: Create ReturnVisitorWelcome.tsx
- Shown when: has auth + recent sheets in localStorage, no URL params
- "Welcome back, {name}" (from `getUserProfile()`)
- Recent projects listed with title and relative time from `lastOpened` (e.g. "2 hours ago")
- Click project → `onSelectSheet(sheetId)` → sets `?sheet=ID&room=ID`, `dataSource='loading'`
- [New Project], [Connect Existing Sheet], [Demo] buttons
- [Connect Existing Sheet] opens SheetSelector modal
- Component test

### D4: Create CollaboratorWelcome.tsx
- Shown when: `?sheet=` or `?room=` in URL, user NOT signed in
- "You've been invited to collaborate on a project."
- Only [Sign in with Google] shown
- After sign-in: GanttContext useEffect re-fires → `loadFromSheet()` runs automatically
- CRITICAL: Component does NOT call `loadFromSheet()` directly — the GanttContext useEffect
  handles it. This prevents double-load.
- Component test

### D5: Create ChoosePath.tsx
- Shown when: has auth, no recent sheets (or after first sign-in from FirstVisit)
- [New Project], [Existing Sheet], and [Demo] buttons
- [Demo] dispatches `ENTER_SANDBOX`
- If recent sheets exist in localStorage, they are listed below the buttons
- Component test

### D6: Update WelcomeGate.tsx — real screen routing
Replace the placeholder routing from Group A with:
```
if dataSource defined → render children
  if dataSource === 'loading' → render loading skeleton (timeline grid with spinner/shimmer)
if URL has ?sheet= or ?room=:
  if signed in → render children (loading state, useEffect handles)
  if NOT signed in → <CollaboratorWelcome />
else (no URL params):
  if has auth + recent sheets → <ReturnVisitorWelcome />
  if has auth, no recent → <ChoosePath />
  if no auth → <FirstVisitWelcome />
```
WelcomeGate owns the `onSelectSheet(sheetId)` callback (sets URL params + dispatches
`SET_DATA_SOURCE('loading')`) and passes it as a prop to ReturnVisitorWelcome, ChoosePath,
and SheetSelector.

### D7: Create EmptyState.tsx
- Renders inside the Gantt layout when `dataSource='empty'`
- Timeline panel: grid lines, column headers, today marker (visual scaffolding)
- Table panel: column headers + add-task input row (name field focused)
- CTA: "Add your first task" (pointing to input)
- First task creation: `startDate = ensureBusinessDay(today)`, `duration = 1`,
  `endDate = taskEndDate(startDate, 1)`. Dispatches `ADD_TASK` → reducer auto-transitions
  `dataSource` to `'sheet'` (see Design 1 reducer post-processing).
- `onSelectTemplate` callback prop: accepted but button hidden until Design 5 wires it
- Component test

### D8: Update App.tsx
- In `AppContent`, conditionally render `<EmptyState />` when `state.dataSource === 'empty'`
  instead of the normal Gantt chart

## Error Handling
- NEVER compute dates mentally — use `taskEndDate`/`taskDuration` shell functions
- If a task fails after 3 approaches, commit WIP and move to the next task
- Commit after each logical change with conventional commits

## Success Criteria:
1. All 4 welcome screen variants render correctly for their conditions
2. WelcomeGate routing handles all 5 paths including ?room= and loading skeleton
3. onSelectSheet callback owned by WelcomeGate, passed to children
4. EmptyState shows timeline scaffolding + add-task input + CTA
5. First task creation uses ensureBusinessDay + taskEndDate correctly
6. dataSource='empty' in App.tsx renders EmptyState instead of Gantt chart
7. All tests pass, all changes committed
