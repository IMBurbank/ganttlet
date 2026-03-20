---
phase: 18
group: E
stage: 3
agent_count: 1
scope:
  modify:
    - src/components/onboarding/WelcomeGate.tsx
  create:
    - src/sheets/sheetCreation.ts
    - src/components/onboarding/PromotionFlow.tsx
    - src/components/onboarding/TargetSheetCheck.tsx
  test:
    - src/components/onboarding/__tests__/PromotionFlow.test.tsx
    - src/components/onboarding/__tests__/TargetSheetCheck.test.tsx
    - src/sheets/__tests__/sheetCreation.test.ts
  read_only:
    - src/types/index.ts
    - src/state/actions.ts
    - src/sheets/sheetsSync.ts
    - src/sheets/sheetsMapper.ts
    - src/sheets/oauth.ts
    - src/components/onboarding/SheetSelector.tsx
depends_on: [A, B, C]
merge_after: [D]
tasks:
  - id: E1
    summary: "Read sheetsSync.ts, sheetsMapper.ts, oauth.ts"
  - id: E2
    summary: "Create sheetCreation.ts"
  - id: E3
    summary: "Create TargetSheetCheck.tsx"
  - id: E4
    summary: "Create PromotionFlow.tsx"
  - id: E5
    summary: "Wire sandbox banner in WelcomeGate.tsx"
---

# Phase 18 Group E — Sheet Creation + Sandbox Promotion Flow

You are implementing Phase 18 Group E for the Ganttlet project.
Read `CLAUDE.md` for full project context. Read `docs/proposals/designs/design-4.md` for the
detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time Google Sheets sync. This group builds
the sandbox promotion flow — saving a demo project to a real Google Sheet.

## Your files:
Modify:
- `src/components/onboarding/WelcomeGate.tsx` — Add sandbox banner (ONLY the banner —
  Group D owns the routing logic. Your branch merges AFTER D's.)

Create:
- `src/sheets/sheetCreation.ts` — createSheet(title) via Sheets API
- `src/components/onboarding/PromotionFlow.tsx` — Destination picker + write + transition
- `src/components/onboarding/TargetSheetCheck.tsx` — Three-way check UI

Read-only:
- `src/types/index.ts` — DataSource, SyncError types
- `src/state/actions.ts` — SET_DATA_SOURCE, SET_SYNC_ERROR actions
- `src/sheets/sheetsSync.ts` — scheduleSave, initSync, startPolling (from Group A)
- `src/sheets/sheetsMapper.ts` — validateHeaders, SHEET_COLUMNS
- `src/sheets/oauth.ts` — getAccessToken, signIn, isSignedIn
- `src/components/onboarding/SheetSelector.tsx` — reuse for "Save to existing" (from Group B)

## Tasks — execute in order

### E1: Read and understand sync/auth patterns
Read sheetsSync.ts (`scheduleSave`, `initSync`, `startPolling` — understand their signatures),
sheetsMapper.ts (`validateHeaders`, `SHEET_COLUMNS`), oauth.ts (`getAccessToken`, `signIn`).

### E2: Create sheetCreation.ts
```typescript
import { getAccessToken } from './oauth';

export async function createSheet(title: string): Promise<string> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Sheet1' } }],
    }),
  });
  if (!res.ok) throw res;
  const data = await res.json();
  return data.spreadsheetId;
}
```
Unit test with fetch mock in `src/sheets/__tests__/sheetCreation.test.ts`.

### E3: Create TargetSheetCheck.tsx
Three-way check based on target sheet state:
1. **Empty sheet** → proceed directly (no confirmation)
2. **Headers match** (`validateHeaders` returns true) → prompt: "This sheet has N existing
   tasks. Replace them with your current project, or open the existing data instead?"
   Actions: [Replace] / [Open existing]
3. **Headers don't match** → warn: "This sheet has data that isn't in Ganttlet format.
   Creating a new sheet is recommended." Primary: [Create New Sheet]. Secondary: "Overwrite anyway"

Component test covers all three paths.

### E4: Create PromotionFlow.tsx
Full promotion flow:
1. If not signed in → `signIn()` first, resume flow after OAuth completes
2. Show destination picker: "Create new sheet" (recommended) or "Save to existing"
3. If "existing" → open SheetSelector (from Group B), then run TargetSheetCheck
4. Execute transition in this order:
   (1) Update URL to `?sheet=ID&room=ID`
   (2) `initSync(spreadsheetId, syncCallback)`
   (3) `startPolling()`
   (4) `scheduleSave(state.tasks)` — writes data + sets lastWriteHash
   (5) Dispatch `SET_DATA_SOURCE('sheet')` — activates auto-save/Yjs useEffects
   (6) Dispatch `SET_SYNC_ERROR(null)`, set `sandboxDirty = false`
5. All sandbox edits (new/deleted/moved tasks, changed deps) are preserved because
   `state.tasks` already holds them

Component test covers: sign-in gate, destination picker, write + transition.

### E5: Wire sandbox banner in WelcomeGate.tsx
Add to WelcomeGate: when `dataSource === 'sandbox'`, render a persistent banner at the top:
"You're exploring a demo project. Nothing is saved. [Save to Google Sheet]"
Click [Save to Google Sheet] → opens PromotionFlow modal.

This is the ONLY change to WelcomeGate.tsx — do NOT modify the routing logic (owned by Group D).

## Error Handling
- NEVER compute dates mentally — use `taskEndDate`/`taskDuration` shell functions
- If a task fails after 3 approaches, commit WIP and move to the next task
- Commit after each logical change with conventional commits

## Success Criteria:
1. createSheet creates a spreadsheet via Sheets API, checks res.ok, returns ID
2. TargetSheetCheck handles all three cases (empty/Ganttlet/non-Ganttlet)
3. PromotionFlow: sign-in gate → destination picker → write → transition in correct order
4. scheduleSave called before SET_DATA_SOURCE to prevent race condition
5. sandboxDirty reset to false after promotion
6. Sandbox banner shows when dataSource='sandbox', opens PromotionFlow
7. All tests pass, all changes committed
