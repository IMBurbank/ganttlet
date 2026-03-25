---
phase: 20
group: H
stage: 5
agent_count: 1
scope:
  modify:
    - src/components/gantt/TaskBar.tsx
  read_only:
    - src/mutations/index.ts
    - src/hooks/index.ts
    - src/collab/awareness.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B, C, D, E, F]
tasks:
  - id: H1
    summary: "Read architecture spec §5 (Drag) and current TaskBar.tsx drag handling"
  - id: H2
    summary: "Replace Mouse Events with Pointer Events API (onPointerDown/Move/Up, setPointerCapture)"
  - id: H3
    summary: "Implement CSS transform during drag (translateX on <g>, zero React re-renders)"
  - id: H4
    summary: "Implement commit-on-drop: no Y.Doc writes during drag, single transaction on mouseup"
  - id: H5
    summary: "Broadcast drag intent via Yjs awareness (ephemeral, not Y.Doc data)"
  - id: H6
    summary: "Add touch-action: none to SVG drag targets (required for pointer capture on touch)"
---

# Phase 20 Group H — Drag Performance (Pointer Events + CSS Transforms)

You are optimizing drag interactions for the Gantt chart task bars.
Read `docs/plans/frontend-redesign.md` section 5 (Drag: commit-on-drop).

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

Current drag uses Mouse Events with document-level listeners and dispatches MOVE_TASK
to React state on every RAF frame. This group replaces it with:
- Pointer Events API (touch support, no document listeners)
- CSS transforms during drag (GPU composited, zero React work)
- Commit-on-drop (single Y.Doc transaction on mouseup)

## Key Requirements

### Pointer Events

Replace `onMouseDown`/document `mousemove`/`mouseup` with:
- `onPointerDown` on SVG rect → `element.setPointerCapture(e.pointerId)`
- `onPointerMove` on same element (captured events route here automatically)
- `onPointerUp` → `releasePointerCapture` → commit
- `onLostPointerCapture` → cleanup (safety net for browser stealing capture)

Add `style={{ touchAction: 'none' }}` to all drag target SVG rects (required for
pointer capture on touch devices).

### CSS Transform During Drag

During drag, apply `transform: translate(${dx}px, 0)` to the task bar's `<g>` wrapper.
Do NOT update React state or Y.Doc. The bar moves visually via GPU compositing.

```typescript
const gRef = useRef<SVGGElement>(null);
// In pointer move handler:
if (gRef.current) {
  gRef.current.style.transform = `translate(${dx}px, 0)`;
}
```

On mouseup: clear the transform, write final position to Y.Doc.

### Commit-on-Drop

NO Y.Doc writes during drag. The data doesn't change until the user releases.
Table row shows pre-drag dates (correct — edit hasn't committed).
Remote peers see drag intent via Yjs awareness (ghost bar position), not data changes.

On mouseup: single `moveTask(doc, taskId, finalPos)` call = one Y.Doc transaction =
one undo step (Y.UndoManager). Includes cascade.

### Awareness Broadcast

During drag (throttled to 100ms): `setDragIntent(awareness, { taskId, startDate, endDate })`.
On mouseup: `setDragIntent(awareness, null)`. This is ephemeral — not stored in Y.Doc.

## DO NOT MODIFY

- GanttChart.tsx — Group G handles virtualization
- Do NOT change the visual rendering of task bars (colors, labels, etc.)

## Verification

1. `npx tsc --noEmit`
2. `npx playwright test e2e/gantt.spec.ts -g "drag"` — drag E2E test passes
3. Manual: drag a task bar, verify smooth 60fps with no jank (Chrome DevTools)
4. Commit with conventional commit message
