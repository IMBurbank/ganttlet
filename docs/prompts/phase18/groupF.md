---
phase: 18
group: F
stage: 4
agent_count: 1
scope:
  modify:
    - src/sheets/sheetCreation.ts
    - src/components/layout/Header.tsx
    - src/components/onboarding/EmptyState.tsx
  create:
    - src/data/templates/marketingCampaign.ts
    - src/data/templates/eventPlanning.ts
    - src/data/templates/index.ts
    - src/components/onboarding/TemplatePicker.tsx
  test:
    - src/data/templates/__tests__/templateValidation.test.ts
    - src/components/onboarding/__tests__/TemplatePicker.test.tsx
    - src/components/layout/__tests__/Header.test.tsx
  read_only:
    - src/types/index.ts
    - src/state/actions.ts
    - src/sheets/sheetsSync.ts
    - src/sheets/sheetsMapper.ts
    - src/sheets/oauth.ts
    - src/data/templates/softwareRelease.ts
    - src/utils/recentSheets.ts
    - src/components/onboarding/SheetSelector.tsx
    - src/components/onboarding/WelcomeGate.tsx
depends_on: [A, B, C, D, E]
tasks:
  - id: F1
    summary: "Read sheetCreation.ts, Header.tsx, EmptyState.tsx, softwareRelease.ts"
  - id: F2
    summary: "Create marketingCampaign.ts and eventPlanning.ts templates"
  - id: F3
    summary: "Create templates/index.ts registry"
  - id: F4
    summary: "Create TemplatePicker.tsx"
  - id: F5
    summary: "Add createProjectFromTemplate to sheetCreation.ts"
  - id: F6
    summary: "Add sheet management to Header.tsx"
  - id: F7
    summary: "Wire EmptyState template button to TemplatePicker"
---

# Phase 18 Group F — Templates + Project Creation + Sheet Management

You are implementing Phase 18 Group F for the Ganttlet project.
Read `CLAUDE.md` for full project context. Read `docs/proposals/designs/design-5.md` for the
detailed design specification.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## What this project is

Ganttlet is a collaborative Gantt chart with real-time Google Sheets sync. This group builds
template data, template picker, project creation flow, and header sheet management.

## Your files:
Modify:
- `src/sheets/sheetCreation.ts` — Add createProjectFromTemplate (file created by Group E)
- `src/components/layout/Header.tsx` — Add sheet title, share, dropdown, disconnect
  (file already modified by Group C for ErrorBanner/SyncStatus — build on top)
- `src/components/onboarding/EmptyState.tsx` — Wire "Start from template" to TemplatePicker

Create:
- `src/data/templates/marketingCampaign.ts` — ~10 tasks
- `src/data/templates/eventPlanning.ts` — ~10 tasks
- `src/data/templates/index.ts` — Template registry
- `src/components/onboarding/TemplatePicker.tsx` — Template selection UI

Read-only:
- `src/types/index.ts`, `src/state/actions.ts`
- `src/sheets/sheetsSync.ts` — initSync, startPolling, stopPolling, scheduleSave
- `src/sheets/sheetsMapper.ts` — SHEET_COLUMNS (for header row)
- `src/sheets/oauth.ts` — getAccessToken
- `src/data/templates/softwareRelease.ts` — reference for template data structure
- `src/utils/recentSheets.ts`, `src/components/onboarding/SheetSelector.tsx`,
  `src/components/onboarding/WelcomeGate.tsx`

## Tasks — execute in order

### F1: Read and understand existing code
Read sheetCreation.ts (createSheet from Group E), Header.tsx (current state after Group C),
EmptyState.tsx (from Group D), softwareRelease.ts (template data structure to follow).

### F2: Create template data files
Create `src/data/templates/marketingCampaign.ts` (~10 tasks) and
`src/data/templates/eventPlanning.ts` (~10 tasks).

**Template data constraints** (enforced by tests):
- Every task: `id`, `name`, `startDate`, `endDate`, `duration`
- No weekend dates (`ensureBusinessDay` / `prevBusinessDay`)
- `duration === taskDuration(startDate, endDate)` (inclusive convention)
- `endDate === taskEndDate(startDate, duration)` (canonical construction)
- `parentId ↔ childIds` bidirectionally consistent
- Valid UUIDs for `id` values
- No UI state fields (`isExpanded`, `isHidden` — set defaults at load time, not in template)

CRITICAL: NEVER compute dates mentally. Use shell functions to calculate all dates:
- `taskEndDate 2026-03-16 5` → end date for a 5-day task starting Mar 16
- `taskDuration 2026-03-16 2026-03-20` → duration between two dates

### F3: Create templates/index.ts registry
```typescript
export interface Template {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  load: () => Promise<{ tasks: Task[]; changeHistory: ChangeRecord[] }>;
}
```
- Blank entry: `taskCount: 0`, `load()` returns `{ tasks: [], changeHistory: [] }`
- Software Release, Marketing Campaign, Event Planning: lazy `import()` for each
- Write `src/data/templates/__tests__/templateValidation.test.ts` that validates ALL
  templates pass the data constraints above

### F4: Create TemplatePicker.tsx
- Shows template cards with name, description, task count
- `onSelect(templateId: string)` callback
- Component test

### F5: Add createProjectFromTemplate to sheetCreation.ts
```typescript
export async function createProjectFromTemplate(
  name: string, templateId: string
): Promise<void>
```
1. Load template via `templates` registry
2. Create sheet via `createSheet(name)`
3. Write row 1 = all 20 `SHEET_COLUMNS` as headers
4. Write rows 2+ = template task rows (for non-blank)
5. Write range derived from `SHEET_COLUMNS.length` (NOT hardcoded column letter)
6. Update URL to `?sheet=ID&room=ID`
7. Call `initSync(spreadsheetId, callback)` + `startPolling()`
8. For non-blank: call `scheduleSave(tasks)`, dispatch `SET_DATA_SOURCE('sheet')`
9. For Blank: dispatch `SET_DATA_SOURCE('empty')`, empty state UI renders

### F6: Add sheet management to Header.tsx
When `dataSource='sheet'` and user is signed in:

- **Sheet title**: fetch via `GET /v4/spreadsheets/{id}?fields=properties.title`.
  Clickable → opens sheet in Google Sheets (new tab).
- **Share button**: copies URL to clipboard. Adds `?room=` if missing (using sheet ID
  as room ID). Toast: "Link copied. Anyone with access to the Google Sheet can collaborate."
- **Dropdown menu**:
  - "Open in Google Sheets" → new tab
  - "Switch sheet" → teardown current sheet first (`stopPolling()`, disconnect Yjs, clear
    auto-save), then open SheetSelector → on select, full connection cycle with new sheet
  - "Create new project" → opens TemplatePicker
  - "Disconnect" → clear `?sheet=` and `?room=` from URL, `stopPolling()`, disconnect Yjs,
    dispatch `RESET_STATE` → WelcomeGate renders return-visitor variant. Auth persists in
    localStorage — `RESET_STATE` does NOT clear Google auth.

Header test covers: share with toast, disconnect flow, switch sheet behavior.

### F7: Wire EmptyState template button
In `src/components/onboarding/EmptyState.tsx`:
- Make "Or start from a template" button visible
- On click → opens TemplatePicker
- On template select → calls `createProjectFromTemplate(name, templateId)`

## Error Handling
- NEVER compute dates mentally — use `taskEndDate`/`taskDuration` shell functions
- If a task fails after 3 approaches, commit WIP and move to the next task
- Commit after each logical change with conventional commits

## Success Criteria:
1. Both template data files pass all constraint checks (no weekend dates, taskEndDate/taskDuration match)
2. Template registry has Blank + 3 named templates with lazy loading
3. TemplatePicker renders cards and fires onSelect
4. createProjectFromTemplate creates sheet + writes headers + rows + connects
5. Header shows title, share (with toast), dropdown with all 4 actions
6. Switch sheet tears down current connection before opening selector
7. Disconnect clears URL, stops polling, disconnects Yjs, dispatches RESET_STATE
8. EmptyState "Start from template" opens TemplatePicker
9. All tests pass, all changes committed
