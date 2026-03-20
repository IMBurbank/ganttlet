# Design 3: Onboarding Screens + Empty State

## Summary

Build the 4 WelcomeGate screen variants with full content (replacing Design 1's
placeholders) and the empty state UI for blank/empty sheets.

## Requirements

REQ-WG-1–3, REQ-WG-5, REQ-ES-1–2, REQ-ES-3 (prop interface only; wiring by Design 5)

## Dependencies

- Design 1 (WelcomeGate routing shell)
- Design 2 (SheetSelector, recentSheets)

## Files

| File | Action | Change |
|---|---|---|
| `src/components/onboarding/FirstVisitWelcome.tsx` | Create | Value props, [Try the demo], [Sign in with Google] |
| `src/components/onboarding/ReturnVisitorWelcome.tsx` | Create | "Welcome back, {name}", recent projects list |
| `src/components/onboarding/CollaboratorWelcome.tsx` | Create | "You've been invited...", [Sign in with Google] |
| `src/components/onboarding/ChoosePath.tsx` | Create | [New Project], [Existing Sheet] |
| `src/components/onboarding/EmptyState.tsx` | Create | Timeline scaffolding, "Add your first task" CTA |
| `src/components/onboarding/WelcomeGate.tsx` | Modify | Replace placeholder with real screen components |
| `src/App.tsx` | Modify | Render EmptyState in AppContent when `dataSource='empty'` |

## Implementation Details

**WelcomeGate routing (updated from Design 1):**

```
if dataSource defined → render children
if URL has ?sheet= or ?room=:
  if signed in → render children (loading skeleton, useEffect handles load)
  if not signed in → <CollaboratorWelcome onSignIn={signIn} />
    After sign-in completes: token becomes available → GanttContext useEffect
    re-fires → loadFromSheet() runs automatically. No intermediate screen.
else:
  if has auth + recent sheets → <ReturnVisitorWelcome />
  if has auth, no recent → <ChoosePath />
  if no auth → <FirstVisitWelcome />
```

**ReturnVisitorWelcome:**

- Uses `getRecentSheets()` from Design 2
- Displays each project with title and relative time (e.g. "2 hours ago") formatted
  from `lastOpened` timestamp
- Clicking a project → `onSelectSheet(sheetId)` → sets `?sheet=ID&room=ID`,
  `dataSource='loading'`
- Shows [New Project], [Connect Existing Sheet], [Demo] buttons
- [Connect Existing Sheet] opens `SheetSelector` from Design 2

**EmptyState:**

- Renders inside the Gantt layout (not WelcomeGate) when `dataSource='empty'`
- Timeline panel: grid lines, headers, today marker
- Table panel: column headers + add-task input row
- CTA: "Add your first task" + "Or start from a template"
- "Start from template" accepts `onSelectTemplate` callback prop (wired by Design 5;
  until then, button is hidden)
- First task creation: `startDate = ensureBusinessDay(today)`, `duration = 1`,
  dispatches `ADD_TASK` → reducer auto-transitions `dataSource` to `'sheet'` (see Design 1)

## Tests

1. `src/components/onboarding/__tests__/FirstVisitWelcome.test.tsx`
2. `src/components/onboarding/__tests__/ReturnVisitorWelcome.test.tsx`
3. `src/components/onboarding/__tests__/CollaboratorWelcome.test.tsx`
4. `src/components/onboarding/__tests__/EmptyState.test.tsx`

## Commits

1. `feat: add welcome screen variants (first visit, return, collaborator, choose path)`
2. `feat: wire WelcomeGate to real screen components`
3. `feat: add EmptyState component with add-task CTA`
