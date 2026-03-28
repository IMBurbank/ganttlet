# Task Queue

Claimable tasks for multi-agent development.
**Convention**: write your agent/branch name next to claimed tasks.

Prior phases (0-14, 13a, Plugin Adoption) are complete. See `docs/completed-phases.md`.

## Active Phase

(none)

## Completed

- **Phase 20**: Frontend Redesign — Y.Doc state, TaskStore/UIStore, SheetsAdapter, virtualization, undo, drag perf — DONE

- **Phase 18**: Onboarding UX — State Machine, Welcome Flows & Sheet Management — PR #70 + PR #75 — DONE
  - Design-7 sync fixes (T1.1–T2.5, T3.1–T3.2) all implemented
  - 35 E2E tests, 584 unit tests passing

- **Phase 16**: Date Calculation Bug Fixes — Inclusive Convention — [`docs/tasks/phase16.yaml`](tasks/phase16.yaml) — DONE

- **Phase 15**: Scheduling Engine — Constraints, Dependencies & Conflict Detection — [`docs/tasks/phase15.yaml`](tasks/phase15.yaml) — DONE

- **Phase 14**: Drag Interaction Reliability & Sync Integrity — [`docs/tasks/phase14.yaml`](tasks/phase14.yaml) — DONE

## Backlog (unstructured)

### Accessibility
- [ ] Modal backdrop dismiss not keyboard-accessible — OKRPickerModal, TaskBarPopover, DependencyEditorModal, ConflictResolutionModal all use `onClick` on backdrop `<div>` without `role="button"` or keyboard handling. Escape key works via separate `onKeyDown` listener, but backdrop dismiss requires a mouse click. Fix: migrate to `<dialog>` element or add `role="button"` + `tabIndex={0}` + `onKeyDown` to backdrops.

### Performance & Scale

**Sync layer (medium priority at 500+ tasks):**
- [ ] Server-push via SSE or Yjs relay — replace 30s polling with push notifications for changes. Current polling is adequate for <50 concurrent users but doesn't scale to 100+

**API efficiency (low priority):**
- [ ] Batch updateSheet + clearSheet into a single `spreadsheets.values.batchUpdate` call (saves one round-trip per save)
- [ ] Add ETag/If-None-Match to polling — skip full response when sheet hasn't changed

### Resource Assignment & Leveling
- [ ] Define resource data model (id, name, capacity, calendar)
- [ ] Add resource assignment UI (task → resource mapping)
- [ ] Implement overallocation detection
- [ ] Implement basic resource leveling

### Baseline Tracking
- [ ] Define baseline data model (snapshot of dates per task)
- [ ] Add "Save Baseline" action
- [ ] Render baseline bars on Gantt chart
- [ ] Add variance columns (planned vs. actual)

### Export
- [ ] Export to PDF
- [ ] Export to PNG
- [ ] Export to CSV
