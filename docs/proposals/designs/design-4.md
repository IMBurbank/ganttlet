# Design 4: Sandbox Promotion Flow

## Summary

Implement the "Save to Google Sheet" flow that promotes sandbox state to a real
Google Sheet. Sign-in gating, destination picker (new vs existing), three-way
target sheet check, write + transition.

## Requirements

REQ-PROMO-1–6

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
   - Empty → write directly
   - Headers match SHEET_COLUMNS (`validateHeaders` from Design 1) → prompt replace/open
   - Headers don't match → warn, recommend new sheet
5. Write tasks via `updateSheet()`, update URL, init sync, set `dataSource='sheet'`
6. Call `scheduleSave()` (from `sheetsSync.ts`) which writes and updates `lastWriteHash`
   internally — this prevents double-write since the next auto-save cycle will see matching hashes

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
