# Proposal: User Onboarding & New Schedule Experience

**Status**: Draft — open for discussion
**Date**: 2026-03-15
**Scope**: How users start, connect, and manage schedules in Ganttlet
**Baseline**: Rebased on main after phases 16, 16b, 16c (commit 730473b)

---

## Problem Statement

Ganttlet currently injects hardcoded sample data ("Q2 Product Launch" — 32 tasks, fake
owners, fake dates) into every session as the initial React state. When a user connects a
Google Sheet, the auto-save effect writes this fake data to the sheet within seconds. There
is no way to:

- Start with a blank schedule
- Connect an existing sheet without risking data pollution
- Select a sheet without manually pasting a spreadsheet ID into the URL
- Switch between sheets or disconnect from one
- Choose a project template
- Understand what the app does on first visit

This was acceptable during development but blocks real usage.

### Root Cause (code trace)

```
src/data/fakeData.ts          — 32 hardcoded tasks ("Q2 Product Launch")
src/state/GanttContext.tsx:23  — initialState.tasks = fakeTasks (always)
src/state/GanttContext.tsx:137 — loadFromSheet() returns [] for empty sheets
src/state/GanttContext.tsx:138 — if (tasks.length > 0) — condition fails, state stays as fakeTasks
src/state/GanttContext.tsx:150 — useEffect watches state.tasks, calls scheduleSave()
src/sheets/sheetsSync.ts:55   — scheduleSave() writes to sheet after 2s debounce
```

**Result**: Every empty Google Sheet connected to Ganttlet gets populated with fake data.

The Yjs hydration path has the same issue (`GanttContext.tsx:185-187`): if no sheet tasks
were loaded, it falls back to `fakeTasks` and hydrates the CRDT document with sample data,
propagating it to all collaborators.

---

## Competitive Research Summary

Reviewed: Microsoft Project, Smartsheet, Monday.com, Asana, TeamGantt, GanttProject,
Instagantt, ClickUp, Linear, Notion.

### Key patterns from best-in-class tools

| Pattern | Examples | Relevance |
|---|---|---|
| **Template gallery at creation** | Monday.com (200+ templates), Smartsheet, Instagantt | Start with 2-3, not 200 |
| **Demo data you learn by exploring** | Linear's "anti-onboarding" — workspace pre-populated, learn by doing | High — fits OSS ethos |
| **Google Picker API for sheet selection** | Google Workspace add-ons (GANTTophant) | Eliminates URL-pasting |
| **Column auto-detection + mapping** | TeamGantt CSV import, Dromo (AI-powered mapping) | Critical for "bring your sheet" |
| **Structured empty state with CTAs** | ClickUp, Notion, Asana | Never show a blank/confusing screen |
| **3-step onboarding (< 60 seconds)** | Linear | Sign in → pick sheet → see chart |
| **Spreadsheet IS the product** | Smartsheet | Architectural parallel to Ganttlet |

### Ganttlet's unique differentiator

No competitor offers real-time, bidirectional Google Sheets sync with browser-based WASM
scheduling. Most tools treat Sheets as an export target, not a live data source. This is
the story to tell during onboarding.

---

## Recommendations

### R1: Separate App Modes — "Connected" vs "Sandbox"

**Problem**: Demo mode and production mode are conflated.

**Proposal**: Three distinct entry paths, chosen explicitly by the user:

1. **Sandbox mode** (no URL params, not signed in) — Interactive demo with sample data.
   Fully interactive — users can drag tasks, edit fields, add dependencies, see the
   scheduler in action. A persistent banner shows:
   *"You're exploring a demo project. [Save to Google Sheet] to keep your changes."*
   No writes to any sheet until the user explicitly opts in.

2. **Connect existing sheet** (via picker or `?sheet=ID`) — Load from sheet. If empty,
   show empty state (R2). If populated, render it. Never inject fake data.

3. **New project** — Create a new Google Sheet via Sheets API, optionally populate from a
   template (R5), redirect to connected mode.

**Sandbox → Connected promotion**: Users who explore in sandbox mode and want to keep
their work (whether it's the original demo data or a modified version) can promote to a
real sheet at any time:

1. User clicks **"Save to Google Sheet"** in the sandbox banner (or header)
2. If not signed in → triggers Google sign-in first
3. After sign-in, user chooses:
   - **"Create new sheet"** → creates a new Google Sheet, writes current tasks to it,
     transitions to connected mode
   - **"Save to existing sheet"** → opens Google Picker (R3), user selects a sheet,
     app writes current tasks to it, transitions to connected mode
4. URL updates to include `?sheet=ID`, `dataSource` flips from `'sandbox'` to `'sheet'`,
   auto-save activates, and the banner disappears

This is the key UX insight: sandbox isn't a dead end. Everything the user did in sandbox
mode — edits, dependency changes, rearranged tasks — carries forward into their real
project. The demo becomes the starting point, not a throwaway.

**What this means for the demo data**: The sample "Q2 Product Launch" project is no longer
injected silently. It's presented as an interactive playground that users can:
- Explore and discard (close the tab)
- Explore, modify, and save (promote to a sheet)
- Skip entirely (sign in → new project or existing sheet)

**State model change**: Add a `dataSource` field to `GanttState`:
```typescript
dataSource: 'sandbox' | 'sheet' | 'empty'
```
Auto-save is gated on `dataSource === 'sheet'`. The transition from `'sandbox'` to
`'sheet'` only happens through the explicit promotion flow above.

**Sandbox isolates all external writes**:
- **Sheets**: `scheduleSave()` is a no-op when `dataSource !== 'sheet'`
- **Yjs/Collaboration**: Sandbox mode **ignores the `?room=` URL param entirely** — no
  WebSocket connection, no CRDT document, no relay. The existing `connectCollab()` call
  in `GanttContext.tsx:161` is guarded by `if (!roomId || !accessToken) return;` — sandbox
  users are not signed in, so this already blocks. But we should add an explicit
  `dataSource !== 'sandbox'` guard as defense-in-depth, because a user could sign in
  (to browse sheets) without leaving sandbox mode.
- **Dispatch**: Sandbox uses `localDispatch` only (React state, no Yjs). The existing
  split dispatch architecture (`localDispatch` vs `collabDispatch`) in GanttContext.tsx
  makes this straightforward — sandbox mode wires `GanttDispatchContext` to `dispatch`
  instead of `collabDispatch`.

**`dataSource` lifecycle**:
```
App loads:
  No ?sheet= param → dataSource = 'sandbox', load fakeTasks into state
  Has ?sheet= param → dataSource = 'empty' (until loadFromSheet completes)
    ↓ loadFromSheet() resolves:
      tasks.length > 0 → dataSource = 'sheet', dispatch SET_TASKS
      tasks.length === 0 → dataSource stays 'empty', show empty state (R2)
    ↓ user makes first edit (any TASK_MODIFYING_ACTION):
      if dataSource === 'empty' → transition to dataSource = 'sheet'
      (this is the "intent gate" — first edit enables auto-save)
```

**Promotion flow implementation**:
```typescript
async function promoteToSheet(sheetId: string, tasks: Task[]) {
  // 1. Write current state to sheet (whatever the user has in sandbox)
  const rows = tasksToRows(tasks);
  // Note: column count must match SHEET_COLUMNS.length (currently 20 = column T)
  await updateSheet(sheetId, `Sheet1!A1:T${rows.length}`, rows);

  // 2. Initialize sync (enables polling + auto-save)
  initSync(sheetId, dispatch);
  startPolling();

  // 3. Update URL: add ?sheet= and ?room= (same ID enables collaboration)
  const url = new URL(window.location.href);
  url.searchParams.set('sheet', sheetId);
  url.searchParams.set('room', sheetId);
  window.history.replaceState({}, '', url.toString());

  // 4. Transition state — this triggers the Yjs connection effect
  //    (GanttContext watches accessToken + roomId, and dataSource !== 'sandbox'
  //    allows the connection to proceed)
  dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'sheet' });

  // 5. Yjs connects automatically via the existing useEffect that watches
  //    accessToken — the user is already signed in (required for step 1),
  //    and roomId is now in the URL. hydrateYjsFromTasks() will find
  //    loadedSheetTasksRef populated from step 1, so it hydrates from
  //    real data, not fakeTasks.
}
```

**URL convention**: Promotion always sets both `?sheet=` and `?room=` to the same
spreadsheet ID. This matches the existing convention documented in `docs/local-testing.md`
and enables collaboration immediately after promotion. The relay room is created
implicitly when the first client connects — no separate creation step is needed (the
relay server is a stateless WebSocket forwarder that creates rooms on demand).

**Shareable URL**: After promotion, the URL looks like
`https://ganttlet.app/?sheet=ABC123&room=ABC123` — sharing this URL gives collaborators
both Sheets sync and real-time collaboration.

### R2: Empty State with Structure

**Problem**: Empty sheets show fake data instead of guidance.

**Proposal**: When connected to an empty sheet, render:

- Timeline header, grid lines, today marker (the visual scaffolding of a Gantt chart)
- A centered call-to-action area:
  - **Primary**: "Add your first task" — inline task-creation row at the top of the table
  - **Secondary**: "Or start from a template" — opens template picker (R5)
- Brief value prop copy: *"Changes sync to your Google Sheet in real time"*
- The table panel shows the column headers but no rows (except the add-task row)

This follows NN/g's three guidelines for empty states: communicate system status, increase
learnability, and provide direct pathways to key tasks.

### R3: Sheet Selection UI

**Problem**: Users must manually copy spreadsheet IDs into URLs.

**Proposal**: Two-phase approach:

**Phase B (no new scopes)**: Lightweight in-app sheet browser using the existing
`drive.metadata.readonly` scope. Lists the user's recent spreadsheets via
`GET drive/v3/files?q=mimeType='spreadsheet'`. Also accepts pasted Google Sheets URLs
(extracts the spreadsheet ID automatically). See "OAuth & Scope Strategy" section for
the implementation sketch and wireframe.

**Phase C (adds `drive.file`)**: Full Google Picker API integration for browsing Drive
folders, searching, and selecting sheets. Also enables folder placement for new sheets.
Uses incremental authorization — only requested when the user clicks "Browse Drive."

**Flow** (Phase B):
1. User signs in with Google (existing OAuth flow)
2. User clicks "Connect Google Sheet" in header
3. In-app modal shows recent sheets + paste-URL input
4. User selects a sheet or pastes a URL
5. App updates URL param and loads data
6. If sheet has data → render. If empty → show empty state (R2)

**Implementation notes**:
- Phase B requires **no new scopes** — `drive.metadata.readonly` is already granted
- Store recently-connected sheets in `localStorage` for quick reconnection
- Parse pasted URLs: extract ID from `docs.google.com/spreadsheets/d/{ID}/...`
- Phase C's Google Picker returns the spreadsheet ID, title, and URL natively

### R4: Column Auto-Detection & Mapping

**Problem**: Connecting a sheet with non-standard columns fails silently or produces
garbled data.

**Proposal**: When connecting a sheet that has data:

1. **Read the header row** (first row of `Sheet1`)
2. **Auto-map recognized columns** using fuzzy matching:
   - Exact matches: `name`, `start_date`, `end_date`, `duration`, `owner`
   - Fuzzy: `task name` → `name`, `assignee` → `owner`, `begin` → `start_date`
   - Unmapped columns shown as "custom fields" (read-only initially)
3. **Show a mapping preview modal**:
   ```
   ┌─ Column Mapping ────────────────────────┐
   │                                         │
   │  Your Column      →  Ganttlet Field     │
   │  ─────────────────────────────────────  │
   │  Task Name        →  Name         ✓    │
   │  Start            →  Start Date   ✓    │
   │  End              →  End Date     ✓    │
   │  Assigned To      →  Owner        ▼    │
   │  Priority         →  (unmapped)   ▼    │
   │                                         │
   │           [Confirm & Load]              │
   └─────────────────────────────────────────┘
   ```
4. **Render the Gantt chart** with mapped data
5. **Store the mapping** in a `_ganttlet_meta` sheet tab (hidden, auto-created) so it
   persists across sessions

**Effort**: This is the largest recommendation. Consider shipping R1-R3 first and adding
column mapping as a fast-follow.

### R5: Project Templates

**Problem**: No way to start a structured project without building from scratch.

**Proposal**: 3-5 built-in templates, each 8-15 tasks:

| Template | Phases | Tasks |
|---|---|---|
| **Blank** | — | Header row only, no tasks |
| **Software Release** | Planning → Development → Testing → Launch | ~12 tasks |
| **Marketing Campaign** | Strategy → Content Creation → Launch → Analysis | ~10 tasks |
| **Event Planning** | Venue & Logistics → Promotion → Execution → Post-event | ~10 tasks |

Templates are stored as static data (like `fakeData.ts` but intentionally structured).
When a user selects a template for a new project:

1. Create a new Google Sheet via Sheets API
2. Write the template's header row + task rows
3. Load the sheet in Ganttlet (connected mode)

The existing `fakeTasks` data could be refactored into the "Software Release" template
rather than deleted, giving it a purposeful home.

### R6: Onboarding Flow (3 Steps Max)

**Problem**: No guided onboarding. Users must read docs to learn about URL params.

**Proposal**: First-visit experience (detected via `localStorage` flag):

```
┌─ Step 1: Welcome ──────────────────────────────────────────────┐
│                                                                │
│  Ganttlet                                                      │
│  Free Gantt charts with real-time Google Sheets sync           │
│                                                                │
│  [Try the demo]              [Sign in with Google]             │
│                                                                │
│  ✦ Two-way sync — edit in the chart or the sheet               │
│  ✦ Real-time collaboration — see changes as they happen        │
│  ✦ Runs in your browser — your data stays in your Google Drive │
│                                                                │
└────────────────────────────────────────────────────────────────┘

  ↓ Try the demo                   ↓ Sign in

┌─ Sandbox ──────────────────┐   ┌─ Step 2: Choose path ────────┐
│                            │   │                              │
│  Full interactive demo     │   │  ┌──────────┐ ┌──────────┐  │
│  with sample project.      │   │  │ New      │ │ Existing │  │
│  User can explore freely.  │   │  │ Project  │ │ Sheet    │  │
│                            │   │  └──────────┘ └──────────┘  │
│  Banner:                   │   │                              │
│  [Save to Google Sheet]    │   └──────────────────────────────┘
│                            │
│  ↓ clicks Save             │     ↓ New Project       ↓ Existing
│                            │
│  Signs in (if needed)      │   ┌─ Template ─────┐  ┌─ Picker ─┐
│  → New sheet or Picker     │   │ ○ Blank        │  │ Google   │
│  → Current tasks written   │   │ ○ SW Release   │  │ Picker   │
│  → Transitions to          │   │ ○ Marketing    │  │ or paste │
│    connected mode          │   │ ○ Event        │  │ URL      │
│                            │   │ [Create]       │  │[Connect] │
└────────────────────────────┘   └────────────────┘  └──────────┘
                                         │                │
                                         └───────┬────────┘
                                                 ↓
                                    Connected mode (auto-save on)
```

**Key flows**:
- **Explore first** → Try demo → play around → Save to Sheet → connected mode
- **Direct start** → Sign in → New project from template → connected mode
- **Bring your data** → Sign in → Pick existing sheet → connected mode

All paths converge on the same connected mode. Nothing is lost when transitioning.

**Total time target**: Under 60 seconds from landing to seeing your Gantt chart.

### R7: Sheet Management UI

**Problem**: No way to switch sheets, disconnect, or see what's connected.

**Proposal**: Add to the header bar (when signed in and connected):

- **Sheet name** (fetched via Sheets API `spreadsheets.get`) displayed as a clickable link
  that opens the sheet in Google Sheets in a new tab
- **Dropdown menu** on the sheet name:
  - "Open in Google Sheets" → new tab
  - "Switch sheet" → Google Picker (R3)
  - "Create new project" → template picker (R5)
  - "Disconnect" → returns to welcome/sandbox
- **Recent sheets** stored in `localStorage` for quick switching

### R8: Decouple Fake Data from Production Code

**Problem**: `fakeData.ts` is imported unconditionally and used as initial state.

**Proposal** (minimal, ship-first fix):

```typescript
// Before (GanttContext.tsx:22-23)
const initialState: GanttState = {
  tasks: fakeTasks,
  changeHistory: fakeChangeHistory,
  // ...
};

// After
const initialState: GanttState = {
  tasks: [],
  changeHistory: [],
  dataSource: 'empty',
  // ...
};
```

- `fakeTasks` is only imported and used in sandbox mode (lazy import)
- Auto-save guard: `scheduleSave` only fires when `dataSource === 'sheet'`
- Yjs hydration guard: only hydrate from loaded sheet tasks, never from fake data
- The `fakeData.ts` file moves to `src/data/templates/softwareRelease.ts` and becomes one
  of the template options (R5)

### R9: Preserve Existing Sheet Data

**Problem**: The auto-save + polling flow can overwrite sheet data in edge cases.

**Proposal**:
- **Fix write range** (prerequisite, Phase A): `sheetsSync.ts:66` currently writes to
  `A1:R` (18 columns) but `SHEET_COLUMNS` has 20 entries. Columns S (`constraintType`)
  and T (`constraintDate`) are silently dropped on every save. Fix: derive the range
  from `SHEET_COLUMNS.length` instead of hardcoding the column letter. This is a 1-line
  fix that should ship before any other sync changes.
- **Read-before-write**: On first connect, always complete `loadFromSheet()` before
  enabling auto-save. The `dataSource` lifecycle in R1 handles this — `dataSource` starts
  as `'empty'` when `?sheet=` is present, and only transitions to `'sheet'` after the
  load completes and the user makes an intentional edit.
- **Intent-gated writes**: Don't write to the sheet until the user has performed an
  explicit action (add task, edit field, drag bar). Merely loading the app should never
  trigger a write. The `dataSource` state machine in R1/R8 provides this gate.
- **Source tracking**: Tag writes with a `_ganttlet_last_modified` cell (e.g., `U1`) so
  the app can detect if the sheet was modified externally between polls. (Column U, not T,
  since T is now `constraintDate`.)
- **Conflict warning**: If the sheet changed externally between polls and the user also
  made local changes, show a merge confirmation dialog instead of silently overwriting.

---

## Priority & Phasing

### Phase A — Stop the bleeding (P0)

| Rec | What | Effort | Effect |
|---|---|---|---|
| — | Fix write range `A1:R` → `A1:T` in sheetsSync.ts:66 | Tiny (1 line) | Constraint columns no longer silently dropped |
| R8 | Decouple fake data, gate auto-save | Small (1-2 files) | Stops polluting production sheets |
| R2 | Empty state UI | Small (new component) | Users see guidance, not fake data |

The write range fix is a prerequisite — without it, even correctly-gated saves would
still truncate constraint data. All three changes are safe to ship as a single PR.

### Phase B — Onboarding v1 (P1)

| Rec | What | Effort | Effect |
|---|---|---|---|
| R1 | App modes (sandbox/connected/empty) | Medium | Clear separation of concerns |
| R6 | Welcome + onboarding flow | Medium | First impression; gates adoption |
| R3 | Sheet browser (lightweight, no new scopes) | Medium | Eliminates URL-pasting friction |

These form a cohesive "first experience" milestone. Depends on Phase A.
No new OAuth scopes needed — uses existing `drive.metadata.readonly`.

### Phase C — Templates & Management (P2)

| Rec | What | Effort | Effect |
|---|---|---|---|
| R5 | Project templates | Medium | Accelerates time-to-value |
| R7 | Sheet management UI | Medium | Quality-of-life for ongoing use |
| R3+ | Google Picker upgrade (adds `drive.file`) | Small | Full Drive browsing + folder placement |

### Phase D — Advanced Import (P3)

| Rec | What | Effort | Effect |
|---|---|---|---|
| R4 | Column auto-detection & mapping | Large | "Bring your own sheet" story |
| R9 | Data safety / conflict resolution | Medium | Edge-case protection |

---

## Open Questions

1. ~~Google Picker scope~~ **Resolved** — see "OAuth & Scope Strategy" section below.

2. ~~Sheet creation via API~~ **Resolved** — see "OAuth & Scope Strategy" section below.

3. **Template ownership**: Should templates live as static JSON in the app bundle, or as
   public Google Sheets that get copied? Static is simpler; Sheets copies let us update
   templates without app deploys.

4. **Column mapping complexity**: How far do we go with non-standard sheets? MVP could be
   "your sheet must use our column names" with a downloadable header template. Full
   mapping is a larger effort.

5. **Multi-sheet projects**: Should a user be able to have multiple sheets open as tabs
   within one Ganttlet session? Or is it always one sheet = one project?

6. **Sandbox persistence**: Should sandbox mode persist to `localStorage` so users don't
   lose their exploration work? Or is it explicitly ephemeral?

7. **Sandbox → Sheet promotion with existing data**: When a user promotes sandbox data to
   an existing sheet that already has tasks, what happens? Options:
   - **Overwrite** — replace sheet contents with sandbox state (simple, but destructive)
   - **Merge** — attempt to merge sandbox tasks with sheet tasks (complex, error-prone)
   - **Block** — only allow promotion to empty sheets; show a warning if the selected
     sheet has data ("This sheet already has data. Create a new sheet instead?")
   - **User choice** — ask: "This sheet has 12 existing tasks. Replace them with your
     demo project, or start fresh with the existing data?"
   The safest default is probably to only allow promotion to new/empty sheets, with a
   "this sheet has data — open it instead?" redirect for non-empty sheets.

8. ~~Collaboration in sandbox mode~~ **Resolved** — Sandbox mode disables Yjs entirely
   (see R1 sandbox isolation rules). Each visitor gets their own independent local copy.
   Collaboration begins only after promotion to a sheet, at which point `?room=` is set
   and Yjs connects. This avoids the thorny UX question of multi-user promotion and
   keeps the sandbox simple and predictable.

---

## OAuth & Scope Strategy

### Current scopes (oauth.ts line 115)

| Scope | Tier | Purpose |
|---|---|---|
| `spreadsheets` | **Sensitive** | Full read/write on any Google Sheet |
| `drive.metadata.readonly` | Recommended | Read-only file metadata (names, IDs, parents) |
| `userinfo.email` | Recommended | User's email |
| `userinfo.profile` | Recommended | User's name and picture |

The `spreadsheets` scope is already the heaviest scope we request — it's **sensitive**
tier, which requires Google app verification for production. All other current scopes are
"recommended" (non-sensitive, no verification needed).

This means adding `drive.file` (also recommended tier) in Phase C would **not** change
the verification requirements or make the consent screen materially scarier — the
sensitive `spreadsheets` scope already dominates the consent experience.

### What the current scopes can do

| Operation | API Call | Scope Needed | Have It? |
|---|---|---|---|
| Create a new spreadsheet | `POST /v4/spreadsheets` | `spreadsheets` | **Yes** |
| Read/write sheet data | `GET/PUT .../values/...` | `spreadsheets` | **Yes** |
| Get sheet title/metadata | `GET /v4/spreadsheets/{id}` | `spreadsheets` | **Yes** |
| Move sheet to a folder | `PATCH drive/v3/files/{id}` | `drive.file` | **No** |
| Browse Drive (Picker) | Google Picker API | `drive.file` | **No** |
| List user's sheets | `GET drive/v3/files?q=mimeType=...` | `drive.metadata.readonly` | **Yes** |

### Key finding: sheet creation works today, folder placement doesn't

`POST https://sheets.googleapis.com/v4/spreadsheets` with the `spreadsheets` scope
creates a new spreadsheet in the user's **Drive root** (My Drive). There is no parameter
on this endpoint to specify a parent folder. Moving a file to a folder requires the Drive
API (`files.update` with `addParents`), which requires `drive.file` scope.

### Recommended approach: progressive scope escalation

**Phase A/B — no new scopes needed:**

Sheet creation via `spreadsheets` scope works. New sheets land in Drive root. We can
build a lightweight "sheet list" using the existing `drive.metadata.readonly` scope:

```typescript
// List user's spreadsheets (already permitted by current scopes)
const res = await fetch(
  'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,modifiedTime,iconLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '20',
  }),
  { headers: { Authorization: `Bearer ${token}` } }
);
```

This gives us a "Recent Sheets" list without the Google Picker and without any new
scopes. Users can select from their recent sheets or paste a URL — no ID copying needed.

**Sheet creation implementation** (no new scope):
```typescript
async function createSheet(title: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{
        properties: { title: 'Sheet1' },
      }],
    }),
  });
  const data = await res.json();
  return data.spreadsheetId;  // e.g., "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
}
```

**Phase C — add `drive.file` when needed:**

When we implement R3 (Google Picker) and folder placement, request `drive.file` via
**incremental authorization**. Google's OAuth supports this: the app requests additional
scopes at the moment they're needed, showing a targeted consent prompt:

```typescript
// Only when user clicks "Browse Drive" or "Choose folder"
tokenClient.requestAccessToken({
  scope: 'https://www.googleapis.com/auth/drive.file',
  include_granted_scopes: true,  // keep existing scopes
});
```

The `drive.file` scope is classified as **"recommended"** by Google (not "sensitive" or
"restricted"), so it doesn't require app verification review. It only grants access to
files the user explicitly opens via Picker or that the app creates — not their entire
Drive.

**Benefits of this approach:**
- Phase A/B ships with **zero consent screen changes**
- Users who never need Picker/folders never see the extra scope request
- Users who do need it get a clear, contextual prompt ("Ganttlet wants to browse your
  Drive files") at the moment they click the browse button
- The `drive.file` scope unlocks both Picker and folder placement in one step

### Where new sheets land (by phase)

| Phase | Behavior | Scope |
|---|---|---|
| A/B | Drive root (My Drive) | `spreadsheets` (existing) |
| C | User picks folder via Picker, or Drive root as default | `drive.file` (new, incremental) |

### Drive file listing as a lightweight Picker alternative

Since `drive.metadata.readonly` is already granted, we can build an in-app sheet browser
without the Google Picker API. This is simpler to implement (no Picker SDK to load) and
avoids the `drive.file` scope:

```
┌─ Select a Google Sheet ────────────────────────┐
│                                                │
│  Recent spreadsheets:                          │
│  ┌────────────────────────────────────────┐    │
│  │ 📊 Q2 Product Launch    Modified 2h ago│    │
│  │ 📊 Sprint Planning      Modified 1d ago│    │
│  │ 📊 Budget 2026          Modified 3d ago│    │
│  └────────────────────────────────────────┘    │
│                                                │
│  Or paste a Google Sheets URL:                 │
│  ┌────────────────────────────────────────┐    │
│  │ https://docs.google.com/spreadsheets/  │    │
│  └────────────────────────────────────────┘    │
│                                                │
│           [Connect]    [Create New Sheet]       │
└────────────────────────────────────────────────┘
```

This could ship in Phase B alongside R1/R6, giving users a proper sheet selection UI
with zero scope changes.

---

## Appendix: Architecture Context

### Phase 16/16b/16c changes relevant to this proposal

These phases landed between the initial draft and this revision. Key impacts:

**Date convention hardening (Phase 16)**:
- `end_date` is now explicitly **inclusive** (the last working day the task occupies)
- `duration` = business days in `[startDate, endDate]` counting both endpoints
- All callsites migrated from `workingDaysBetween()` → `taskDuration()` (14 sites)
- `addBusinessDaysToDate()` deleted, replaced by `taskEndDate()`
- Pre-commit hook rejects deprecated function names
- **Impact on R5 (templates)**: Template data must use the inclusive convention.
  The existing `fakeData.ts` already does, so refactoring it into a template is safe.

**Constraint fields (Phase 15, stabilized in 16)**:
- `Task` interface now includes `constraintType?` and `constraintDate?`
- 8 constraint types: ASAP, SNET, ALAP, SNLT, FNET, FNLT, MSO, MFO
- `sheetsMapper.ts` reads/writes constraint columns (positions 19-20)
- **Impact on R4 (column mapping)**: The sheet schema is now 20 columns, not 18.
  `SHEET_COLUMNS` and `HEADER_ROW` are exported from `sheetsMapper.ts` and can be
  used directly for header detection and template generation.

**Duration sync fix (Phase 16, Bug 14)**:
- `UPDATE_TASK_FIELD` now recomputes `duration` via `taskDuration()` when dates change
- **Impact on R9 (data safety)**: Reduces risk of stale data being written to sheets.

**Weekend violation detection (Phase 16)**:
- Rust scheduler now detects `WEEKEND_VIOLATION` conflicts
- **Impact on R5 (templates)**: Templates must not have tasks starting/ending on weekends.

**E2E attestation system (Phase 16c)**:
- New `scripts/attest-e2e.sh` posts commit status to bypass CI re-run
- `ATTEST_E2E=1 ./scripts/full-verify.sh` auto-attests on success
- **Impact on implementation**: Use attestation flow when shipping proposal phases.

**Drag reliability (Phase 14, stabilized in 16)**:
- `COMPLETE_DRAG` is atomic (position + cascade in one reducer pass)
- `guardedDispatch` protects dragged task from concurrent `SET_TASKS`
- Split dispatch: `localDispatch` (React-only) vs `collabDispatch` (React + Yjs)
- **Impact on R1 (sandbox mode)**: Sandbox must use `localDispatch` only (no Yjs
  writes). The existing split dispatch architecture makes this straightforward.

### Pre-existing bugs discovered during review

**Bug: Write range truncates constraint columns** (`sheetsSync.ts:66`)
The `scheduleSave()` function writes to range `Sheet1!A1:R{N}` — column R is the 18th
column. But `SHEET_COLUMNS` has 20 entries (columns A-T). Columns S (`constraintType`)
and T (`constraintDate`) are silently dropped on every write. Reads use the full
`Sheet1` range and work correctly. This bug predates this proposal — it was introduced
when Phase 15 added constraint columns without updating the write range. Should be fixed
as a prerequisite to Phase A (or alongside it).

**Bug: Root task duration is 84, should be 85** (`fakeData.ts`)
The root summary task "Q2 Product Launch" has `startDate: '2026-03-02'`,
`endDate: '2026-06-26'`, `duration: 84`. Inclusive business-day count from 2026-03-02
to 2026-06-26 is 85. This is a data bug in `fakeData.ts`, not a code bug — when this
data is refactored into a template (R5/R8), the duration should be corrected. (Note:
summary task durations are typically auto-calculated from children, so this field is
overwritten at render time and doesn't affect behavior.)

### Current data model (post-Phase 16)

**Sheet schema** — 20 columns defined in `sheetsMapper.ts:SHEET_COLUMNS`:
```
id, name, startDate, endDate, duration, owner, workStream, project,
functionalArea, done, description, isMilestone, isSummary, parentId,
childIds, dependencies, notes, okrs, constraintType, constraintDate
```

**GanttState** — the `dataSource` field proposed in R1/R8 would extend this interface
(`src/types/index.ts:96-125`). No conflicts with Phase 16 additions. The state already
has `isSyncing`, `syncComplete`, `isCollabConnected` which provide the infrastructure
for mode-aware behavior.

### Current data flow
```
fakeTasks (hardcoded)
  ↓ initialState
GanttContext reducer
  ↓ state.tasks changes
scheduleSave() → sheetsSync → Google Sheets API → writes to sheet
  ↓ also
hydrateYjsFromTasks() → Yjs doc → relay → other collaborators
```

### Proposed data flow
```
User chooses path:

  Sandbox → load demo data → local state only (no writes)
    ↓ user edits freely (drag, add, delete — all local)
    ↓ clicks "Save to Google Sheet"
    ↓ sign in if needed → create new sheet or pick empty sheet
    ↓ write current tasks to sheet → transition to connected mode

  New project → sign in → pick template → create sheet → connected mode

  Existing sheet → sign in → Picker/URL → loadFromSheet()
    ↓
    Sheet empty? → empty state UI (no fake data)
    Sheet has data? → column mapping → render

  Connected mode:
    ↓ user makes intentional edit → auto-save writes to sheet
    ↓ polling reads external changes → merge into state
    ↓ Yjs syncs to collaborators
```

### Key files to modify

| File | Change |
|---|---|
| `src/types/index.ts` | Add `dataSource` to `GanttState` |
| `src/state/GanttContext.tsx` | Empty initial state, data source tracking, save gating |
| `src/state/ganttReducer.ts` | Handle `SET_DATA_SOURCE` action |
| `src/data/fakeData.ts` | Move to `src/data/templates/softwareRelease.ts` |
| `src/sheets/sheetsSync.ts` | Intent-gated saves, read-before-write |
| `src/sheets/sheetsMapper.ts` | Use `HEADER_ROW` export for template sheet creation |
| `src/components/layout/Header.tsx` | Sheet picker button, sheet name display, sandbox banner |
| New: `src/components/onboarding/` | Welcome, template picker, empty state components |
| New: `src/sheets/sheetsPicker.ts` | Drive file listing + Google Picker integration |
| New: `src/data/templates/` | Template task arrays (software release, marketing, etc.) |
