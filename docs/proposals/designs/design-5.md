# Design 5: Templates + Project Creation + Sheet Management

## Summary

Template data files, template picker UI, new project creation flow, header bar
sheet management (title display, share link, dropdown with switch/disconnect).

## Requirements

REQ-TP-1–3, REQ-SM-1–4

## Dependencies

- Design 1 (state machine, `defaultColumns`)
- Design 2 (SheetSelector for "Switch sheet")
- Design 3 (EmptyState wires "Start from template")
- Design 4 (`sheetCreation.ts` — `createSheet()` used by `createProjectFromTemplate`)

## Files

| File | Action | Change |
|---|---|---|
| `src/data/templates/marketingCampaign.ts` | Create | ~10 tasks |
| `src/data/templates/eventPlanning.ts` | Create | ~10 tasks |
| `src/data/templates/index.ts` | Create | Template registry + types |
| `src/components/onboarding/TemplatePicker.tsx` | Create | Template selection UI |
| `src/sheets/sheetCreation.ts` | Modify | Add `createProjectFromTemplate(name, templateId)` |
| `src/components/layout/Header.tsx` | Modify | Sheet title, share button, dropdown menu. **Note:** Design 6 lands first (Phase 18 Stage 2, additive: banner + status indicator). Design 5 adds sheet management on top in Stage 4. |
| `src/components/onboarding/EmptyState.tsx` | Modify | Wire "Start from template" to TemplatePicker |

## Implementation Details

**Template data constraints** (enforced by tests):

- Every task: `id`, `name`, `startDate`, `endDate`, `duration`
- No weekend dates (`ensureBusinessDay` / `prevBusinessDay`)
- `duration === taskDuration(startDate, endDate)` inclusive
- `endDate === taskEndDate(startDate, duration)` (canonical construction via `taskEndDate`)
- `parentId ↔ childIds` bidirectionally consistent
- Valid UUIDs for `id` values
- No UI state fields (`isExpanded`, `isHidden`)

**Template registry** (`templates/index.ts`):

```typescript
export interface Template {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  load: () => Promise<{ tasks: Task[]; changeHistory: ChangeRecord[] }>;
}
export const templates: Template[];
```

Lazy loading via dynamic `import()` for each template. The registry includes a
**Blank** entry with `taskCount: 0` whose `load()` returns `{ tasks: [], changeHistory: [] }`.

**Project creation flow** (`createProjectFromTemplate`):

1. Create sheet via `createSheet(name)` (Design 4)
2. Write row 1 = all 20 `SHEET_COLUMNS` as headers
3. Write rows 2+ = template task rows (for non-blank templates)
4. Write range derived from `SHEET_COLUMNS.length` (not hardcoded column letter)
5. Update URL to `?sheet=ID&room=ID`
6. For non-blank templates: `dataSource='sheet'`, auto-save enabled
7. For Blank template: `dataSource='empty'`, empty state UI renders (Design 3)

**Header sheet management:**

- Sheet title fetched via `GET /v4/spreadsheets/{id}?fields=properties.title`
- Clicking title → opens sheet in Google Sheets (new tab)
- Share button → copies URL to clipboard, adds `?room=` if missing. Toast: "Link
  copied. Anyone with access to the Google Sheet can collaborate."
- Dropdown: "Open in Google Sheets", "Switch sheet" (→ SheetSelector),
  "Create new project" (→ TemplatePicker), "Disconnect" (→ clears URL, resets state)

**Disconnect flow:**

- Clear `?sheet=` and `?room=` from URL
- `stopPolling()` (exported from `sheetsSync.ts`, see Design 1), disconnect Yjs
- Dispatch `RESET_STATE` (Design 1) → resets to `initialState` with `dataSource: undefined`
  → WelcomeGate takes over (return visitor variant, since auth persists in localStorage
  — `RESET_STATE` does NOT clear Google auth)

## Tests

1. `src/data/templates/__tests__/templateValidation.test.ts` — all templates pass constraints
2. `src/components/onboarding/__tests__/TemplatePicker.test.tsx`
3. `src/components/layout/__tests__/Header.test.tsx` — share, disconnect, switch

## Commits

1. `feat: add marketing campaign and event planning templates`
2. `feat: add template picker and project creation flow`
3. `feat: add sheet management to header (title, share, dropdown)`
