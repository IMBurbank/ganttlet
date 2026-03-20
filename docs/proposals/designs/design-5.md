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

## Files

| File | Action | Change |
|---|---|---|
| `src/data/templates/marketingCampaign.ts` | Create | ~10 tasks |
| `src/data/templates/eventPlanning.ts` | Create | ~10 tasks |
| `src/data/templates/index.ts` | Create | Template registry + types |
| `src/components/onboarding/TemplatePicker.tsx` | Create | Template selection UI |
| `src/sheets/sheetCreation.ts` | Modify | Add `createProjectFromTemplate(name, templateId)` |
| `src/components/layout/Header.tsx` | Modify | Sheet title, share button, dropdown menu |
| `src/components/onboarding/EmptyState.tsx` | Modify | Wire "Start from template" to TemplatePicker |

## Implementation Details

**Template data constraints** (enforced by tests):

- Every task: `id`, `name`, `startDate`, `endDate`, `duration`
- No weekend dates (`ensureBusinessDay` / `prevBusinessDay`)
- `duration === taskDuration(startDate, endDate)` inclusive
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

Lazy loading via dynamic `import()` for each template.

**Header sheet management:**

- Sheet title fetched via `GET /v4/spreadsheets/{id}?fields=properties.title`
- Clicking title → opens sheet in Google Sheets (new tab)
- Share button → copies URL to clipboard, adds `?room=` if missing
- Dropdown: "Open in Google Sheets", "Switch sheet" (→ SheetSelector),
  "Create new project" (→ TemplatePicker), "Disconnect" (→ clears URL, resets state)

**Disconnect flow:**

- Clear `?sheet=` and `?room=` from URL
- `stopPolling()`, disconnect Yjs
- Set `dataSource = undefined` → WelcomeGate takes over

## Tests

1. `src/data/templates/__tests__/templateValidation.test.ts` — all templates pass constraints
2. `src/components/onboarding/__tests__/TemplatePicker.test.tsx`
3. `src/components/layout/__tests__/Header.test.tsx` — share, disconnect, switch

## Commits

1. `feat: add marketing campaign and event planning templates`
2. `feat: add template picker and project creation flow`
3. `feat: add sheet management to header (title, share, dropdown)`
