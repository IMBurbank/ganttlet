# Design 4: Sandbox Promotion Flow

## Summary

Implement the "Save to Google Sheet" flow that promotes sandbox state to a real
Google Sheet. Sign-in gating, destination picker (new vs existing), three-way
target sheet check, write + transition.

## Requirements

REQ-PROMO-1–6, REQ-SM-STATE-2 (sandbox banner UI: "You're exploring a demo project.
Nothing is saved. [Save to Google Sheet]")

## Dependencies

- Design 1 (state machine, `validateHeaders`)
- Design 2 (SheetSelector for "Save to existing")
- Design 3 (onboarding screens provide entry points)

## Files

| File | Action | Change |
|---|---|---|
| `src/components/onboarding/PromotionFlow.tsx` | Create | Destination picker modal |
| `src/components/onboarding/TargetSheetCheck.tsx` | Create | Three-way check UI (empty/Ganttlet/non-Ganttlet) |
| `src/sheets/sheetCreation.ts` | Create | `createSheet(title): Promise<string>` via Sheets API |
| `src/components/onboarding/WelcomeGate.tsx` | Modify | Sandbox banner wires to PromotionFlow |

## Implementation Details

**Promotion flow steps:**

1. If not signed in → `signIn()` first
2. Show destination picker: "Create new sheet" (recommended) or "Save to existing"
3. If existing → open SheetSelector (Design 2)
4. Check target sheet:
   - Empty → write directly (no confirmation prompt)
   - Headers match SHEET_COLUMNS (`validateHeaders` from Design 1) → prompt: "This
     sheet has N existing tasks. Replace them with your current project, or open the
     existing data instead?" Actions: [Replace] / [Open existing]
   - Headers don't match → warn: "This sheet has data that isn't in Ganttlet format.
     Creating a new sheet is recommended." Primary: [Create New Sheet].
     Secondary: "Overwrite anyway"
5. Update URL to `?sheet=ID&room=ID`
6. Call `initSync(spreadsheetId, syncCallback)` then `startPolling()` from
   `sheetsSync.ts` — these are separate calls (`initSync` only stores the sheet ID
   and callback; `startPolling` starts the poll loop)
7. Call `scheduleSave(state.tasks)` — this writes the current tasks to the sheet AND
   updates `lastWriteHash`, so the next auto-save cycle sees matching hashes and
   skips the redundant write
8. Set `dataSource='sheet'` — this activates auto-save and Yjs useEffects
9. Reset `sandboxDirty` to `false` (all sandbox edits are now preserved in the sheet)

**Sheet creation** (`sheetCreation.ts`):

```typescript
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

Uses existing `spreadsheets` scope. Creates in Drive root.

## Tests

1. `src/components/onboarding/__tests__/PromotionFlow.test.tsx` — flow states
2. `src/components/onboarding/__tests__/TargetSheetCheck.test.tsx` — three-way check
3. `src/sheets/__tests__/sheetCreation.test.ts` — API call mock

## Commits

1. `feat: add sheet creation via Sheets API`
2. `feat: add target sheet three-way check`
3. `feat: add sandbox promotion flow`
