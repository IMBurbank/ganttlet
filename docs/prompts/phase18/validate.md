---
phase: 18
type: validation
stage: final
depends_on: [A, B, C, D, E, F]
checks:
  - id: V1
    summary: "Build verification"
  - id: V2
    summary: "State machine transitions"
  - id: V3
    summary: "Sandbox isolation"
  - id: V4
    summary: "Error UI per type"
  - id: V5
    summary: "Template validation"
  - id: V6
    summary: "WelcomeGate routing"
  - id: V7
    summary: "Sheet selector"
  - id: V8
    summary: "Promotion flow"
  - id: V9
    summary: "Header management"
  - id: V10
    summary: "Empty state → first task"
  - id: V11
    summary: "Loading + 403 error UI"
---

# Phase 18 Validation — Onboarding UX

You are the validation agent for Phase 18. Your job is to verify that all six agent groups
completed their work correctly, fix any issues from the merges, and ensure everything works
together.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.

## Scope

You may modify these files to add tests and fix integration issues:
- `src/state/__tests__/ganttReducer.test.ts`

You may read (but should NOT modify unless fixing merge issues) all files modified by Groups A-F:
- `src/types/index.ts`
- `src/state/actions.ts`
- `src/state/ganttReducer.ts`
- `src/state/GanttContext.tsx`
- `src/data/defaultColumns.ts`
- `src/data/templates/softwareRelease.ts`
- `src/data/templates/marketingCampaign.ts`
- `src/data/templates/eventPlanning.ts`
- `src/data/templates/index.ts`
- `src/sheets/syncErrors.ts`
- `src/sheets/sheetsSync.ts`
- `src/sheets/sheetsMapper.ts`
- `src/sheets/sheetsClient.ts`
- `src/sheets/sheetsBrowser.ts`
- `src/sheets/sheetCreation.ts`
- `src/utils/recentSheets.ts`
- `src/utils/parseSheetUrl.ts`
- `src/components/onboarding/WelcomeGate.tsx`
- `src/components/onboarding/FirstVisitWelcome.tsx`
- `src/components/onboarding/ReturnVisitorWelcome.tsx`
- `src/components/onboarding/CollaboratorWelcome.tsx`
- `src/components/onboarding/ChoosePath.tsx`
- `src/components/onboarding/EmptyState.tsx`
- `src/components/onboarding/SheetSelector.tsx`
- `src/components/onboarding/ErrorBanner.tsx`
- `src/components/onboarding/SyncStatus.tsx`
- `src/components/onboarding/HeaderMismatchError.tsx`
- `src/components/onboarding/PromotionFlow.tsx`
- `src/components/onboarding/TargetSheetCheck.tsx`
- `src/components/onboarding/TemplatePicker.tsx`
- `src/components/layout/Header.tsx`
- `src/App.tsx`

## Phase 1: Diagnostic (do NOT fix anything yet)

Run each check below. Record PASS or FAIL. Do not attempt any fixes until all checks are done.

### V1: Build Verification
- Run `npm run build:wasm` — PASS/FAIL: ___
- Run `npx tsc --noEmit` — PASS/FAIL: ___
- Run `npm run test` — PASS/FAIL: ___
- Run `cd crates/scheduler && cargo test` — PASS/FAIL: ___

### V2: State Machine Transitions
- Read GanttContext.tsx — verify `initialState` has `tasks: [], dataSource: undefined`
- Verify sheets sync useEffect: `?sheet=` + signed in → `dataSource='loading'` → loadFromSheet
- Verify success+data → `'sheet'`, success+[] → `'empty'`, throw → syncError set
- Verify reducer: SET_DATA_SOURCE, SET_SYNC_ERROR, ENTER_SANDBOX, RESET_STATE all handled
- Verify post-processing: sandbox+edit → sandboxDirty, empty+edit → dataSource='sheet'
- PASS/FAIL: ___

### V3: Sandbox Isolation
- Verify auto-save guard: `dataSource !== 'sheet'` → return
- Verify Yjs guard: `dataSource !== 'sheet'` → return
- Verify collabDispatch guard: after dispatch(), before Yjs sync
- Verify ENTER_SANDBOX lazy-imports templates (no import at startup)
- Verify beforeunload fires when sandbox + dirty, not when not dirty
- Verify sign-in during sandbox does NOT change dataSource
- PASS/FAIL: ___

### V4: Error UI
- Read ErrorBanner.tsx — verify auth/not_found/forbidden/network banners render correctly
- Verify not_found calls stopPolling() + removeRecentSheet()
- Verify auth [Re-authorize] triggers signIn(), on success clears error + scheduleSave
- Verify rate_limit NOT a banner — shows in SyncStatus as "Sync paused — retrying automatically"
- Verify SyncStatus.tsx replaced SyncStatusIndicator.tsx (old file deleted)
- PASS/FAIL: ___

### V5: Template Validation
- Run `templateValidation.test.ts` — all templates pass constraints
- Verify: no weekend dates, duration === taskDuration, endDate === taskEndDate
- Verify: parentId ↔ childIds consistent, valid UUIDs
- Verify: Blank template has taskCount:0
- PASS/FAIL: ___

### V6: WelcomeGate Routing
- Verify: no auth + no URL → FirstVisitWelcome
- Verify: auth + recent + no URL → ReturnVisitorWelcome with relative times
- Verify: auth + no recent + no URL → ChoosePath with [Demo] button
- Verify: ?sheet= or ?room= + signed in → children (loading skeleton)
- Verify: ?sheet= or ?room= + NOT signed in → CollaboratorWelcome
- Verify: after sign-in from Collaborator → loadFromSheet auto (no intermediate screen)
- Verify: onSelectSheet callback owned by WelcomeGate, passed to children
- PASS/FAIL: ___

### V7: Sheet Selector
- Verify: SheetSelector lists Drive sheets with correct API query (mimeType filter)
- Verify: URL paste extracts spreadsheet ID, invalid URL shows error
- Verify: [Connect] sets ?sheet=ID&room=ID
- Verify: recentSheets LRU eviction at max 10
- PASS/FAIL: ___

### V8: Promotion Flow
- Verify: sandbox banner shows [Save to Google Sheet]
- Verify: PromotionFlow sign-in gate works
- Verify: TargetSheetCheck three-way check (empty/Ganttlet/non-Ganttlet)
- Verify: write order: URL → initSync → startPolling → scheduleSave → SET_DATA_SOURCE
- Verify: sandboxDirty reset to false
- PASS/FAIL: ___

### V9: Header Management
- Verify: sheet title from Sheets API, clickable
- Verify: share copies URL + adds ?room=, correct toast text
- Verify: switch sheet tears down current connection first
- Verify: disconnect: clear URL + stopPolling + Yjs disconnect + RESET_STATE
- Verify: auth persists after disconnect (return-visitor variant shows)
- PASS/FAIL: ___

### V10: Empty State → First Task
- Verify: EmptyState renders when dataSource='empty'
- Verify: add-task uses ensureBusinessDay + taskEndDate
- Verify: ADD_TASK → reducer transitions dataSource to 'sheet'
- Verify: auto-save fires after transition
- Verify: "Start from template" button wired to TemplatePicker
- PASS/FAIL: ___

### V11: Loading + 403 Error
- Verify: loadFromSheet throws on 403 (not returns [])
- Verify: dataSource stays 'loading' on error
- Verify: syncError set to {type: 'forbidden'}
- Verify: banner shows [Retry] and [Open another sheet]
- Verify: [Retry] re-calls loadFromSheet
- PASS/FAIL: ___

## Phase 2: Fix and Verify

For each FAILED check from Phase 1:
1. Diagnose the root cause
2. Fix it (only modify files in your scope unless fixing merge issues)
3. Re-run THAT check
4. Re-run ALL checks to verify no regressions

Common issues after merging 6 branches across 4 stages:
- Import conflicts (SyncStatusIndicator deleted, replaced by SyncStatus)
- WelcomeGate.tsx merge conflicts between Group D (routing) and Group E (banner)
- Header.tsx merge between Group C (ErrorBanner/SyncStatus) and Group F (sheet management)
- Missing imports for recentSheets.ts in GanttContext or ErrorBanner
- TASK_MODIFYING_ACTIONS import path (moved from GanttContext to actions.ts)

## Phase 3: Final Report

Run `./scripts/full-verify.sh` and re-run all 11 checks. Print summary:

```
╔═════════════════════════════════════════════════════╗
║ Phase 18 Validation Report                          ║
╠══════════════════════════════════╦═══════╦══════════╣
║ CHECK                            ║ RESULT║ NOTES    ║
╠══════════════════════════════════╬═══════╬══════════╣
║ V1  Build verification           ║       ║          ║
║ V2  State machine transitions    ║       ║          ║
║ V3  Sandbox isolation            ║       ║          ║
║ V4  Error UI                     ║       ║          ║
║ V5  Template validation          ║       ║          ║
║ V6  WelcomeGate routing          ║       ║          ║
║ V7  Sheet selector               ║       ║          ║
║ V8  Promotion flow               ║       ║          ║
║ V9  Header management            ║       ║          ║
║ V10 Empty state → first task     ║       ║          ║
║ V11 Loading + 403 error          ║       ║          ║
╠══════════════════════════════════╬═══════╬══════════╣
║ OVERALL                          ║       ║          ║
╚══════════════════════════════════╩═══════╩══════════╝
```

If ALL checks pass, commit any fixes/tests with: `"fix: phase 18 validation — [description]"`
