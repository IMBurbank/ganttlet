You are implementing Phase 8 Group A for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- src/components/table/InlineEdit.tsx
- src/components/table/TaskRow.tsx
- src/components/table/TaskTable.tsx
- src/data/fakeData.ts
- src/components/shared/OKRPickerModal.tsx (new)

## Tasks — execute in order:

### A1: Fix cell editability bug (P0)
Most table cells are no longer editable. This is a Phase 7 regression.

**Investigation steps:**
1. Start the dev server: `npx vite --host 0.0.0.0`
2. Open the app and try double-clicking various cells (name, owner, description, notes, start/end dates, duration)
3. Check which cells work and which don't

**Likely root causes (investigate all):**
1. In `InlineEdit.tsx` (line 19-24): the `autoEdit` effect runs whenever `autoEdit` prop changes. If TaskTable rapidly cycles `autoFocusName` (true→false via CLEAR_FOCUS_NEW_TASK), the effect may interfere with editing state on other InlineEdit instances. Fix: guard the effect to only act on `autoEdit === true` transitions, and use a ref to track previous value.
2. In `TaskTable.tsx` (line 28-33): `CLEAR_FOCUS_NEW_TASK` fires in `requestAnimationFrame`, which triggers a re-render before InlineEdit can settle. Fix: use two nested `requestAnimationFrame` calls or a short `setTimeout` (50ms).
3. In `TaskRow.tsx` (line 208-228): verify `readOnly` is ONLY applied to:
   - `workStream` when role === 'task' (correct)
   - `project` when role === 'task' || role === 'workstream' (correct)
   - NO other cells should have `readOnly`
4. Check if the `PresenceCell` wrapper's `onClick` handler is capturing events before `onDoubleClick` on InlineEdit.

**Deliverable:** All non-inherited cells are double-click editable. Summary task dates and milestones are read-only (existing behavior). Inherited project/workStream cells remain read-only.

### A2: Populate OKR seed data
In `fakeData.ts`, add OKRs to workstream summary tasks (currently `okrs: []`):
- `pe` (Platform Engineering): `["KR: API p99 latency < 200ms", "KR: Zero-downtime migration", "KR: 99.9% uptime SLA"]`
- `ux` (User Experience): `["KR: User satisfaction > 4.5/5", "KR: Ship design system v2", "KR: WCAG 2.1 AA compliance"]`
- `gtm` (Go-to-Market): `["KR: 20% market share increase", "KR: 3x website conversion rate", "KR: 50 published content pieces"]`

Verify every leaf task already has at least one OKR from its parent workstream's set. The seed data already has OKRs on leaf tasks; just add them to the three workstream summary tasks.

### A3: Create OKR picker modal + wire into TaskRow
Create `src/components/shared/OKRPickerModal.tsx`:
- Multi-select checkbox list showing parent workstream's OKRs
- Uses `findWorkstreamAncestor()` from `src/utils/hierarchyUtils.ts` to get available OKRs
- Props: `{ taskId, currentOkrs, availableOkrs, onSave, onClose }`
- Renders as a portal-based modal (consistent with ReparentPickerModal style)
- Save button dispatches `UPDATE_TASK_FIELD` with `field: 'okrs'`

In `TaskRow.tsx`:
- Replace the OKR cell's `InlineEdit` (line 232-247) with a clickable display + modal trigger
- On click, open OKRPickerModal with the task's current OKRs and the workstream's available OKRs
- Use local state in TaskRow to manage modal open/close

### A4: Tests
Add tests in existing test files or new test files:
1. Editability regression test: create a test that renders TaskRow for each hierarchy role (project, workstream, task) and verifies which cells are editable vs read-only
2. OKR inheritance test: verify new tasks created under a workstream inherit the workstream's OKRs

## Verification
After all tasks, run:
```bash
npx tsc --noEmit && npm run test
```
Both must pass. Commit your changes with descriptive messages.
