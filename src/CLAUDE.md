# Frontend

## Constraints
- `COMPLETE_DRAG` is atomic — position set + cascade in one reducer pass
- `SET_TASKS` guarded during active drag — never overwrite dragged task dates
- No Google SDK — raw `fetch()` for all Google API calls
- Prefer `date-fns` directly over project wrappers for new code

## Commands
- `npm run test` — Vitest unit tests
- `npx tsc --noEmit` — Type checking
- `npm run dev` — WASM build + Vite dev server (port 5173)

## Date Conventions
See scheduling-engine skill. Use `taskDuration`/`taskEndDate` from `dateUtils.ts`.

## Skill
See `.claude/skills/google-sheets-sync/` for Sheets integration details.
