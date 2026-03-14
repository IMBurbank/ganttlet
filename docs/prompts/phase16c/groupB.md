---
phase: 16c
group: B
stage: 1
agent_count: 1
scope:
  modify:
    - src/components/table/TaskRow.tsx
    - src/components/gantt/TaskBarPopover.tsx
    - src/sheets/sheetsMapper.ts
    - src/sheets/__tests__/sheetsMapper.test.ts
  read_only:
    - src/utils/taskFieldValidation.ts
    - src/utils/__tests__/taskFieldValidation.test.ts
    - docs/tasks/phase16c.yaml
depends_on: []
tasks:
  - id: B1
    summary: "Wire validateStartDate to TaskRow InlineEdit"
  - id: B2
    summary: "Add imperative validation to TaskBarPopover"
  - id: B3
    summary: "Add validation to sheetsMapper rowToTask"
---

# Phase 16c Group B — Input Validation Consolidation

You are implementing Phase 16c Group B for the Ganttlet project.
Read `CLAUDE.md` for full project context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.

## Context

Input validation for dates and duration is scattered across 4 UI components with
inconsistent guards. `validateStartDate` exists in `taskFieldValidation.ts` with 5
passing tests but is never wired to any UI component. `TaskBarPopover` uses raw
`<input type="date">` elements with no validation at all. `sheetsMapper.ts` (a system
boundary parsing external Google Sheets data) has no date/duration validation.

## Your files (ONLY modify these):

**Modify:**
- `src/components/table/TaskRow.tsx` — wire `validateStartDate` to startDate InlineEdit
- `src/components/gantt/TaskBarPopover.tsx` — add imperative date validation
- `src/sheets/sheetsMapper.ts` — add system boundary validation
- `src/sheets/__tests__/sheetsMapper.test.ts` — add invalid input tests

**Read-only:**
- `src/utils/taskFieldValidation.ts` — existing validators to reuse
- `src/utils/__tests__/taskFieldValidation.test.ts` — existing test patterns

## Tasks — execute in order:

### B1: Wire validateStartDate to TaskRow InlineEdit

Read `src/components/table/TaskRow.tsx`. Find the startDate `InlineEdit` (around line
201). It currently has NO `validate` prop.

Read `src/utils/taskFieldValidation.ts` to see the `validateStartDate` function signature.

**Changes:**

1. Add `validateStartDate` to the import from `taskFieldValidation.ts`:
```typescript
import { validateTaskName, validateDuration, validateEndDate, validateStartDate } from '../utils/taskFieldValidation';
```

2. Add the validate prop to the startDate InlineEdit:
```typescript
validate={(v) => validateStartDate(v, task.endDate)}
```

Read `src/utils/__tests__/taskFieldValidation.test.ts` to confirm `validateStartDate`
already has tests (lines 75-99). No new unit tests needed for the function itself.

Commit: `"fix: wire validateStartDate to TaskRow startDate InlineEdit"`

### B2: Add imperative validation to TaskBarPopover

Read `src/components/gantt/TaskBarPopover.tsx` in full. Note:
- Uses raw `<input type="date">` elements (lines 159-180), NOT `InlineEdit`
- There is NO `validate` prop available on raw inputs
- startDate: no validation at all — weekend dates pass through
- endDate: has `newDuration < 1` guard but silently drops with no user feedback
- constraintDate (lines 226-238): no weekend check

**Changes:**

1. Import `validateStartDate`, `validateEndDate` from `taskFieldValidation.ts`
   and `isWeekendDate` from `dateUtils.ts` (if not already imported).

2. Add local error state:
```typescript
const [dateError, setDateError] = useState<string | null>(null);
```

3. In the `saveField` function, add validation before dispatching:
   - For `startDate`: call `validateStartDate(value, task.endDate)`. If it returns
     a string (error), set `dateError` and return without dispatching.
   - For `endDate`: the existing `newDuration < 1` guard is correct but silent.
     Call `validateEndDate(task.startDate, value)` and show the error.
   - For `constraintDate`: check `isWeekendDate(value)` — if true, set error and
     return.

4. Display the error near the relevant input (a small `<span>` with the error text,
   cleared on next valid input).

5. Clear `dateError` when the popover closes or when a valid value is entered.

Commit: `"fix: add imperative date validation to TaskBarPopover"`

### B3: Add validation to sheetsMapper rowToTask

Read `src/sheets/sheetsMapper.ts`. Find `rowToTask` (around line 55). This is a system
boundary — it parses raw string arrays from Google Sheets.

**Changes to `rowToTask`:**

1. After extracting `startDate` and `endDate` strings, snap weekend dates.
   Note: `ensureBusinessDay` and `prevBusinessDay` take `Date` objects, not strings.
   You must convert:
```typescript
import { ensureBusinessDay, prevBusinessDay, taskDuration } from '../utils/dateUtils';
import { parseISO, format } from 'date-fns';

// After extracting dates from the row:
if (startDate) startDate = format(ensureBusinessDay(parseISO(startDate)), 'yyyy-MM-dd');
if (endDate) endDate = format(prevBusinessDay(parseISO(endDate)), 'yyyy-MM-dd');
```

2. Add duration guard — if computed duration < 1, default to 1:
```typescript
const dur = (startDate && endDate) ? Math.max(taskDuration(startDate, endDate), 1) : (parseInt(get(4)) || 1);
```

3. Add endDate >= startDate guard — if end is before start after snapping, set end = start:
```typescript
if (startDate && endDate && endDate < startDate) {
  endDate = startDate;
}
```

4. Log warnings for corrected values (use `console.warn`).

**Changes to `parseConstraintFields`** (around line 102):

Add weekend check for `constraintDate` (same Date conversion needed):
```typescript
if (constraintDate) constraintDate = format(ensureBusinessDay(parseISO(constraintDate)), 'yyyy-MM-dd');
```

**Tests** — add to `src/sheets/__tests__/sheetsMapper.test.ts`:

```typescript
describe('rowToTask invalid input handling', () => {
  it('snaps weekend startDate to Monday', () => { ... });
  it('snaps weekend endDate to Friday', () => { ... });
  it('ensures duration >= 1', () => { ... });
  it('corrects endDate before startDate', () => { ... });
  it('snaps weekend constraintDate to Monday', () => { ... });
});
```

Use `node -e` to verify expected snapped dates before writing assertions.

Commit: `"fix: add date validation to sheetsMapper system boundary"`

### Final verification

```bash
npx tsc --noEmit 2>&1 | tail -5
npx vitest run 2>&1 | tail -10
```

Both must pass.

## Progress Tracking

Update `.agent-status.json` after each task.

## Error Handling Protocol

- Level 1: Fix and retry (up to 3 approaches).
- Level 2: Commit WIP, move to next task.
- Level 3: Commit, mark blocked.
- Emergency: `git add -A && git commit -m "emergency: groupB saving work"`.
- **Calculations**: NEVER do mental math — use `node -e` or `python3 -c`.
