---
phase: 20
group: G
stage: 5
agent_count: 1
scope:
  modify:
    - src/components/gantt/GanttChart.tsx
    - src/components/gantt/DependencyLayer.tsx
    - vite.config.ts
    - package.json
  create:
    - src/components/gantt/VirtualizedGanttChart.tsx
  read_only:
    - src/utils/layoutUtils.ts
    - src/store/TaskStore.ts
    - docs/plans/frontend-redesign.md
depends_on: [A, B, C, D, E, F]
tasks:
  - id: G1
    summary: "Read architecture spec §9 (Performance) and current GanttChart.tsx"
  - id: G2
    summary: "Implement SVG viewport virtualization: compute visible index range, render only visible task bars"
  - id: G3
    summary: "Virtualize dependency arrows: render for visible tasks + one level off-screen, truncate indicators"
  - id: G4
    summary: "Enable React Compiler in Vite config (babel-plugin-react-compiler)"
  - id: G5
    summary: "Load-test: generate 1000 demo tasks, verify scroll performance"
---

# Phase 20 Group G — SVG Virtualization + React Compiler

You are implementing viewport-based SVG virtualization for the Gantt chart.
Read `docs/plans/frontend-redesign.md` section 9 (Performance).

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all tasks sequentially.

## Context

The Gantt chart currently renders ALL visible tasks as SVG DOM elements. At 1000 tasks,
that's ~10,000 SVG nodes causing scroll jank. This group adds viewport virtualization:
only render elements in the scroll viewport.

## Key Requirements

### SVG Viewport Virtualization

Fixed-height rows: `ROW_HEIGHT = 44px`. Compute visible range:
```typescript
const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
const endIndex = Math.min(tasks.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
const OVERSCAN = 5; // buffer rows above/below viewport
```

Only render `tasks.slice(startIndex, endIndex)` as SVG elements. The SVG's total
`height` attribute = `tasks.length * ROW_HEIGHT` (provides scrollbar).

### Dependency Arrow Virtualization

Only render arrows where at least one endpoint is in the visible range.
For arrows with one off-screen endpoint: truncate to viewport edge with a small
indicator triangle (Smartsheet pattern). Skip arrows where BOTH endpoints are off-screen.

### React Compiler

**First, install the dependency:**
```bash
npm install --save-dev babel-plugin-react-compiler
```

Add `babel-plugin-react-compiler` to Vite config:
```typescript
// vite.config.ts
import ReactCompiler from 'babel-plugin-react-compiler';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [ReactCompiler],
      },
    }),
  ],
});
```

Verify: `npm run dev` works without errors. The compiler auto-memoizes components.

## DO NOT MODIFY

- TaskBar.tsx — Group H handles drag performance
- Task data or mutations — only rendering layer changes

## Verification

1. `npx tsc --noEmit`
2. `npx vitest run`
3. `npx playwright test e2e/gantt.spec.ts` — Gantt E2E tests pass
4. Manual: open app with 1000 tasks, scroll at 60fps (Chrome DevTools Performance tab)
5. Commit with conventional commit message
