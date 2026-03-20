# Proposal: User Onboarding & New Schedule Experience

**Status**: Draft — open for discussion
**Date**: 2026-03-20
**Scope**: How users start, connect, and manage schedules in Ganttlet

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
- Return to a previously-connected project
- Start from Google Sheets and get to Ganttlet

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

## User Journeys

Every design decision in this proposal flows from these 8 user journeys. The journeys
define what users need; the recommendations (next section) describe how to deliver it.

### Journey 1: The Curious Visitor

**Who:** Someone who heard about Ganttlet, clicked a link, wants to understand what it does.

**Current experience:**
- Lands on the app, sees a full Gantt chart with "Q2 Product Launch" — 30+ tasks, fake
  owners, fake dates
- No explanation of what they're looking at or what makes Ganttlet different
- Can drag bars, edit fields, click around — but doesn't know if this is their data,
  sample data, or someone else's project
- The "Sign in" button exists but there's no reason given to click it
- If they do sign in and happen to have `?sheet=ID` in the URL (they won't), their
  sheet silently gets overwritten with this fake data

**What they need:**
- Immediate clarity: "This is a demo project. Play with it."
- A reason to care: "Real-time Google Sheets sync — edit here or in your spreadsheet,
  both update instantly"
- A low-friction path forward: either keep exploring or sign in when ready
- Safety: nothing they do in exploration should write to any external system

**Proposed experience:**
1. Landing shows the Gantt chart with sample data (same interactive demo as today —
   the product speaks for itself)
2. Persistent banner: *"You're exploring a demo project. Nothing is saved."*
3. Clear value prop visible without scrolling — the Sheets sync story, real-time collab,
   browser-based scheduling
4. Two clear CTAs: **"Sign in with Google"** to start for real, or just keep playing
5. Sandbox mode: no Sheets writes, no Yjs connection, no side effects. Pure local state.

**Design choice — banner, not modal:** A modal risks feeling like an ad. The banner
approach lets the product speak for itself — the user is already *in* a working Gantt
chart, which is more compelling than any marketing page.

**Serves:** R1 (sandbox mode), R8 (decouple fake data)

---

### Journey 2: The Return Visitor

**Who:** Used Ganttlet yesterday, connected a sheet, closed the tab. Coming back today.

**Current experience:**
- Navigates to `ganttlet.app` — sees fake data again
- Their Google session may still be valid (localStorage), but without `?sheet=ID` in the
  URL, there's no connection to their project
- Must remember the URL with their sheet ID, or dig through browser history
- Complete dead end if they can't find the URL

**What they need:**
- Instant recognition: "Welcome back. Here are your projects."
- One click to resume where they left off
- No fake data, no confusion

**Proposed experience:**
1. App detects returning user (has auth in localStorage + recent sheets list)
2. Instead of loading fake data, shows a lightweight welcome:
   ```
   Welcome back, Sarah.

   Recent projects:
     Q2 Product Launch         2 hours ago
     Sprint Planning           3 days ago

   [New Project]    [Connect Existing Sheet]    [Explore Demo]
   ```
3. Clicking a recent project loads it immediately — URL updates, sheet loads, collab
   connects
4. The recent sheets list is maintained in localStorage: `{ sheetId, title, lastOpened }`,
   updated on every successful connection

**This is the most important journey.** Every other journey happens once. This one happens
every day. If returning to your project is annoying, people stop using the tool.

**Serves:** R6 (onboarding flow), R7 (sheet management)

---

### Journey 3: The New Project Creator

**Who:** Signed-in user who wants to start a new Gantt chart backed by a real Google Sheet.

**Current experience:**
- Not possible from within the app
- User would need to: create a Google Sheet manually, set up the correct 20-column header
  row, copy the sheet ID, paste it into the URL
- Nobody will do this

**What they need:**
- "New Project" button that handles everything
- Optional template selection (blank, software release, marketing campaign, etc.)
- The sheet is created, headers written, URL updated — all in one click

**Proposed experience:**
1. User clicks "New Project" (from welcome screen or header)
2. Template picker:
   ```
   Start a new project:

     ○ Blank project (just headers, you fill in tasks)
     ○ Software Release (12 tasks — plan → develop → test → launch)
     ○ Marketing Campaign (10 tasks — strategy → content → launch)
     ○ Event Planning (10 tasks — logistics → promotion → execution)

   Project name: [My Project        ]

   [Create]
   ```
3. App creates a Google Sheet via Sheets API (works with existing `spreadsheets` scope)
4. Writes header row + template tasks (if any) to the sheet
5. URL updates to `?sheet=ID&room=ID`, auto-save activates, collab enabled
6. User is now in connected mode, editing a real project

**Where the sheet goes:** New sheets land in Drive root (My Drive). The Sheets API
`POST /v4/spreadsheets` endpoint has no `parents` parameter. This is fine — most users
won't care about folder placement for a quick project, and they can move the sheet in
Drive themselves. Folder placement via Google Picker is a future enhancement that requires
`drive.file` scope via incremental authorization.

**Serves:** R5 (templates), R3 (sheet selection)

---

### Journey 4: Bring Your Own Sheet

**Who:** Has an existing Google Sheet with project data. Wants to visualize it as a Gantt
chart.

**Current experience:**
- Must know to put `?sheet=ID` in the URL
- Must already have their sheet in the exact 20-column format Ganttlet expects
- If columns don't match, data loads as garbage with no error
- If the sheet is empty, fake data stays on screen

**What they need:**
- A way to select their sheet from within the app (browsing or pasting a URL)
- Clear feedback about whether their sheet is compatible
- If columns don't match, tell them what's wrong and what to do about it
- If the sheet is empty, show it as empty (not fake data)

**Proposed experience:**
1. User clicks "Connect Existing Sheet" (from welcome screen or header)
2. Sheet selection modal:
   ```
   Select a Google Sheet:

   Recent spreadsheets:
     Q2 Budget                 Modified yesterday
     Team Roster               Modified 3 days ago
     Sprint Backlog            Modified last week

   Or paste a Google Sheets URL:
   [https://docs.google.com/spreadsheets/d/...    ]

   [Connect]
   ```
   This list uses the existing `drive.metadata.readonly` scope — no new permissions needed.
3. App loads the sheet and checks the header row against `SHEET_COLUMNS`:
   - **Headers match** → load tasks, enter connected mode
   - **Sheet is empty** → enter connected mode with empty state (timeline scaffolding,
     "Add your first task" CTA)
   - **Headers don't match** → show validation error:
     ```
     This sheet's columns don't match Ganttlet's format.

     Expected: id, name, startDate, endDate, duration, ...
     Found: Task, Start, End, Assignee, Priority, ...

     [Create a new sheet instead]
     [Download header template]

     Full column mapping is coming in a future update.
     ```

**Short-term vs long-term:** The validation gate (check headers, show clear error) is the
MVP. The full solution is column auto-detection and mapping (R4), where users see their
column names and map them to Ganttlet fields via a UI. The mapping is stored in a
`_ganttlet_meta` tab in the sheet so it persists across sessions. R4 is a large effort
but is the real "bring your own sheet" story.

**Serves:** R3 (sheet selection), R4 (column mapping)

---

### Journey 5: The Collaborator

**Who:** Received a link from a teammate. Has never used Ganttlet before (or maybe has).
Wants to see the project and possibly make edits.

**Current experience:**
- Opens a URL like `ganttlet.app/?sheet=ABC123&room=ABC123`
- Sees fake data flash on screen (initial state is always fake tasks)
- Must sign in to see real data
- After sign-in, fake data gets replaced by sheet data — jarring transition
- If they start editing before sign-in completes, their edits are to fake data and get
  thrown away

**What they need:**
- A clear indication they're joining a specific project (not a generic landing page)
- Sign-in as the *only* action available (they can't do anything useful without it)
- No fake data, no exploration path — they have a specific intent
- After sign-in, direct entry to the project with live collab indicators

**Proposed experience:**
1. App detects `?sheet=` or `?room=` in URL → this is a collaborator, not an explorer
2. If not signed in, show a focused screen:
   ```
   You've been invited to collaborate on a project.

   [Sign in with Google]

   Ganttlet syncs with Google Sheets in real time.
   Your changes appear instantly for all collaborators.
   ```
   No "try the demo" option. No template picker. Just sign in and go.
3. After sign-in → load sheet data → connect to Yjs room → show the project with
   presence indicators
4. Loading state between sign-in and data-ready: show the timeline scaffolding (grid,
   headers, today marker) with a centered spinner or skeleton rows. Never fake data.

**This is a distinct persona from Journey 1.** The curious visitor needs persuasion and
safety. The collaborator needs speed and directness. The current app treats them
identically. The `dataSource` state model makes it possible to differentiate: if URL has
`?sheet=`, set `dataSource = 'loading'` instead of `dataSource = 'sandbox'`.

**Serves:** R1 (app modes), R6 (onboarding flow)

---

### Journey 6: Sandbox to Real Project (Promotion)

**Who:** Started with Journey 1 (curious visitor), played around, decided this is useful.
Wants to keep what they've built.

**Current experience:**
- Not possible. Everything in the demo is throwaway. There's no path from "I was playing
  around" to "I want to keep this."

**What they need:**
- A clear, always-visible escape hatch: "Save this to a real Google Sheet"
- Their edits carry forward — whatever they changed in the demo becomes their starting
  point
- Sign-in happens as part of the promotion flow if they haven't already
- After promotion, they're in connected mode with auto-save, collab, the works

**Proposed experience:**
1. User clicks "Save to Google Sheet" (persistent in sandbox banner or header)
2. If not signed in → Google sign-in first
3. After sign-in, choose destination:
   ```
   Save your project:

     ○ Create a new Google Sheet (recommended)
     ○ Save to an existing sheet

   Project name: [Q2 Product Launch    ]

   [Save]
   ```
4. If "existing sheet" → open the sheet selector (same modal as Journey 4)
   - **If selected sheet is empty** → write current tasks to it, no prompt needed
   - **If selected sheet has Ganttlet-format data** → ask: *"This sheet has 12 existing
     tasks. Replace them with your current project, or open the existing data instead?"*
   - **If selected sheet has non-Ganttlet data** → warn: *"This sheet has data that isn't
     in Ganttlet format. Creating a new sheet is recommended."* with [Create New Sheet]
     as the primary CTA and a secondary "Overwrite anyway" for users who know what
     they're doing
5. If "new sheet" → create via Sheets API, write current tasks
6. URL updates to `?sheet=ID&room=ID`, `dataSource` flips to `'sheet'`, auto-save
   activates, banner disappears
7. Everything the user built in sandbox — edits, new tasks, deleted tasks, rearranged
   dependencies — carries forward

**Sandbox is ephemeral by default.** Sandbox doesn't persist to localStorage. If you close
the tab, it's gone. This keeps things simple and avoids a confusing middle state (looks
like a project but isn't backed by anything durable). But if the user has made edits and
tries to close the tab, show a `beforeunload` warning: *"You have unsaved changes. Save
to Google Sheets to keep your work."*

**Serves:** R1 (sandbox → connected promotion)

---

### Journey 7: Mid-Session Errors & Recovery

**Who:** Any user, mid-session, when something goes wrong.

**Current experience:**
- Almost all errors are silent. Saves fail quietly (logged to console only). Token expiry
  goes unnoticed. Sheet deletion results in repeated silent 404s from polling. The user
  has no idea anything is wrong until they check their Google Sheet and find stale data.
- The sync indicator shows "Syncing..." / "Synced" / "No Sheet" — but never "Error"
- `retryWithBackoff` in sheetsClient.ts handles 429s with exponential backoff + jitter,
  but the UI never reflects retry status
- Polling errors are logged and silently continued — no backoff, no user feedback

**What they need:**
- Clear, non-blocking feedback about what went wrong
- Graceful degradation — local editing should always work, even if sync is broken
- A path to recovery without losing work

**Proposed error states:**

| Error | What user sees | Behavior |
|---|---|---|
| Sheet not found / no access (403/404) | Banner: *"Can't access this sheet. It may have been deleted or unshared."* + [Open another sheet] | Remove from recent sheets list. Stop polling. Local editing still works. |
| Token expired | Banner: *"Session expired. [Re-authorize] to keep syncing."* | Queue unsaved changes locally. Resume sync after re-auth. No data loss. |
| Sheets API rate limit (429) | Persistent status indicator: *"Sync paused — retrying automatically"* | Shown once per backoff sequence, not per retry attempt. Dismiss on success. No repeated toasts. |
| Relay down (collab) | Subtle indicator: connection dot turns orange. Tooltip: *"Real-time sync unavailable. Sheet sync still active."* | Sheets polling continues. Presence indicators disappear. Auto-reconnect when relay returns. |
| Network offline | Banner: *"You're offline. Changes saved locally."* | Detect via `navigator.onLine` + fetch failures. Resume sync on reconnect. |
| Column mismatch | See Journey 4 | Block load, show validation, offer alternatives. |

**Rate limit UX detail:** The current `retryWithBackoff` makes up to 5 attempts per
failed operation. Showing a toast per attempt would look buggy. Instead, track a
`syncError` state that transitions once (null → error type) when the first retry starts,
and clears when sync succeeds. The status indicator updates its text but doesn't
repeatedly appear/disappear. For 429 specifically, the indicator shows a calm
"retrying..." state — not an alarming error.

**The principle:** Ganttlet's browser-first architecture means local editing is always
possible. The error UX should communicate that your work is safe locally, and tell you
specifically what external connection is broken and what to do about it.

**Serves:** R9 (data safety), new error infrastructure

---

### Journey 8: The Sheets-First User

**Who:** Has a Google Sheet with project data. Discovers Ganttlet through a link, docs,
or word of mouth. Their starting point is the sheet, not the app.

**Current experience:**
- No way to go from a Google Sheet to Ganttlet
- The `?sheet=ID` URL convention exists but is undiscoverable
- Even if they find it, their sheet probably doesn't match Ganttlet's 20-column format

**What they need:**
- A way to open Ganttlet directly from their sheet
- A template or guide to structure their sheet correctly
- Eventually: column mapping so their existing structure works as-is

**Proposed experience — progressive levels:**

**Level 1 — URL convention + template (no code):**
- Document and advertise `ganttlet.app/?sheet=SHEET_ID` pattern
- Publish a **public Google Sheet template** with the correct 20-column header row and a
  few example rows. Users click "Use Template" in Google Sheets, get a copy in their
  Drive, then connect it to Ganttlet. The template sheet's ID goes right into `?sheet=`
- This is the highest-value, lowest-effort step: just a Google Sheet we publish + a link.
  The template doubles as documentation — users can see exactly what format Ganttlet
  expects

**Level 2 — "Prepare my sheet" (small feature):**
- When a user connects a non-compatible sheet (Journey 4 validation fails), offer:
  *"Add Ganttlet headers to this sheet?"*
- This inserts the 20-column header row into a **new tab** (e.g., `Ganttlet`) in their
  existing sheet. Their original data stays untouched in `Sheet1`
- They can then move/remap data at their own pace
- Ganttlet connects to the `Ganttlet` tab instead of `Sheet1`

**Caveat:** The codebase currently hardcodes `DATA_RANGE = 'Sheet1'` in `sheetsSync.ts`
for all reads, writes, and polling. Supporting a different tab name requires making this
configurable — not hard, but touches every sync path (read, write, poll, clear). This
is a medium effort, not a small one. The tab name would need to be stored (in the
`_ganttlet_meta` tab or in localStorage) and passed through the sync layer.

**Level 3 — Google Sheets Add-on (future):**
- A Workspace add-on: Extensions → Ganttlet → "Open as Gantt Chart"
- Reads the current sheet ID, opens `ganttlet.app/?sheet=ID&room=ID` in a new tab
- Could inject the correct header row into an empty sheet
- Requires Workspace Marketplace publishing + Apps Script — a separate project

**Template value:** The public template is valuable beyond Journey 8. It serves as:
- The starting point for Journey 3 (new project — the "Blank" template option could link
  to the same structure)
- Documentation for Journey 4 (what format does Ganttlet expect?)
- A reference for Journey 6 promotion (what will be written to your sheet?)
- The basis for the "Download header template" link in the column validation error

**Serves:** R4 (column mapping, long-term), R5 (templates)

---

## Journey Map

All journeys converge on connected mode. The `dataSource` state machine is the mechanism:

```
                    Journey 1          Journey 2         Journey 8
                  (Curious Visitor)  (Return Visitor)  (Sheets-First)
                        │                  │                │
                        ▼                  │                │
                    ┌────────┐             │                │
                    │Sandbox │             │                │
                    │(demo)  │             │                │
                    └───┬────┘             │                │
        Journey 6       │                  │                │
       (Promotion)      │                  │                │
                        ▼                  ▼                ▼
 Journey 3 ──► ┌──────────────┐   ┌──────────────┐   ┌──────────┐
(New Project)  │Sheet Selector│   │Recent Sheets  │   │ ?sheet=  │
               │+ Templates   │   │List           │   │ URL param│
               └──────┬───────┘   └──────┬────────┘   └────┬─────┘
                      │                  │                  │
                      ▼                  ▼                  ▼
               ┌─────────────────────────────────────────────────┐
               │              Loading (dataSource='loading')     │
               │  Timeline scaffolding, skeleton rows, spinner   │
               └──────────┬──────────────────────┬───────────────┘
                          │                      │
               ┌──────────▼──────┐    ┌──────────▼──────────┐
               │ Empty State     │    │ Connected Mode      │
               │ (dataSource=    │    │ (dataSource='sheet') │
               │  'empty')       │    │ Auto-save on, collab │
               │ "Add first task"│    │ on, polling active   │
               └────────┬────────┘    └──────────────────────┘
                        │ first edit          ▲
                        └─────────────────────┘

               Journey 5 (Collaborator) → same path as ?sheet= URL
               Journey 7 (Errors) → overlays on connected mode
```

---

## Recommendations

The recommendations below implement the journeys above. They are grouped by what they
deliver, not by priority — see "Priority & Phasing" for sequencing.

### R1: Separate App Modes — "Connected" vs "Sandbox"

**Problem**: Demo mode and production mode are conflated.

**Journeys served**: 1 (curious visitor), 5 (collaborator), 6 (promotion)

**Proposal**: Distinct entry paths, chosen by URL state and user action:

1. **Sandbox mode** (no URL params, not signed in) — Interactive demo with sample data.
   Fully interactive — users can drag tasks, edit fields, add dependencies, see the
   scheduler in action. A persistent banner shows:
   *"You're exploring a demo project. [Save to Google Sheet] to keep your changes."*
   No writes to any sheet until the user explicitly opts in.

2. **Connect existing sheet** (via picker or `?sheet=ID`) — Load from sheet. If empty,
   show empty state (R2). If populated, render it. Never inject fake data.

3. **New project** — Create a new Google Sheet via Sheets API, optionally populate from a
   template (R5), redirect to connected mode.

**State model**: Add two fields to `GanttState`:

```typescript
dataSource: 'sandbox' | 'loading' | 'sheet' | 'empty'
syncError: { type: 'auth' | 'not_found' | 'forbidden' | 'rate_limit' | 'network';
             message: string; since: number } | null
```

`dataSource` tracks the app mode. `syncError` tracks sync failures *within* connected
mode — it overlays on `dataSource = 'sheet'`, it doesn't replace it. A rate-limited
save doesn't change the mode; it sets `syncError` so the UI can show feedback while
the user continues editing locally.

**`dataSource` transitions (complete state machine):**

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
  App loads:        │   Disconnect (R7) / "Explore Demo"       │
  no ?sheet= ──► SANDBOX ◄────────────────────────────────────┤
                    │                                          │
                    │ Promotion (Journey 6)                    │
                    ▼                                          │
  App loads:     LOADING ──── success + data ──► SHEET ────────┤
  has ?sheet= ──►   │                              ▲           │
                    │── success + empty ──► EMPTY ──┘           │
                    │                     (first edit)          │
                    │                                          │
                    └── failure (403/404/network) ──► LOADING   │
                        (syncError set, UI shows error,        │
                         retry or "Open another sheet")        │
                                                               │
  Disconnect from SHEET or EMPTY ─────────────────────────────►┘
    clears ?sheet= from URL, resets to SANDBOX
```

Key transitions:
- `sandbox → sheet`: only via explicit promotion flow (Journey 6)
- `loading → sheet`: `loadFromSheet()` returns tasks
- `loading → empty`: `loadFromSheet()` returns `[]`
- `loading → loading` (with `syncError`): `loadFromSheet()` fails — stays in loading,
  sets `syncError`, UI shows error with [Retry] and [Open another sheet] actions
- `empty → sheet`: user performs first task-modifying action (intent gate)
- `sheet → sandbox`: user clicks "Disconnect" in R7 dropdown
- `empty → sandbox`: user clicks "Disconnect"
- Any state → `sandbox`: user navigates to `ganttlet.app` with no params

**`syncError` is independent of `dataSource`:** A user in `dataSource = 'sheet'` who
hits a 429 rate limit stays in `'sheet'` mode (local editing works). `syncError` is set
to `{ type: 'rate_limit', message: 'Sync paused — retrying', since: Date.now() }`. When
sync recovers, `syncError` is cleared. The error UI reads `syncError`, not `dataSource`.

Exception: if `dataSource = 'loading'` and the load itself fails (403/404), the error is
shown in the loading UI (no chart to overlay on). `syncError` is still the mechanism —
the loading screen checks it.

**Feasibility:** Confirmed by code review. Changes needed:
- Add `dataSource` and `syncError` to `GanttState` type (2 fields)
- Add `SET_DATA_SOURCE` and `SET_SYNC_ERROR` to reducer (2 cases)
- Set initial `dataSource` based on URL params in GanttContext
- One conditional render in App.tsx / main layout: if `dataSource === 'loading'`, show
  skeleton instead of chart
- No conflicts with existing state — `isSyncing`, `syncComplete`, `isCollabConnected`
  remain orthogonal

Auto-save is gated on `dataSource === 'sheet'`. The transition from `'sandbox'` to
`'sheet'` only happens through the explicit promotion flow (Journey 6).

**Sandbox isolates all external writes**:
- **Sheets**: `scheduleSave()` is a no-op when `dataSource !== 'sheet'`
- **Yjs/Collaboration**: Sandbox mode ignores `?room=` entirely. The existing
  `connectCollab()` guard (`if (!roomId || !accessToken) return;`) already blocks
  unsigned-in users. Add explicit `dataSource !== 'sandbox'` as defense-in-depth.
- **Dispatch**: Sandbox uses `localDispatch` only (React state, no Yjs). The existing
  split dispatch architecture makes this straightforward.

**Requirements:**

```
R1.1: GIVEN no ?sheet= param in the URL and user is not signed in
      WHEN the app loads
      THEN dataSource is set to 'sandbox'
      AND fakeTasks are loaded into local state
      AND a persistent banner shows: "You're exploring a demo project. Nothing is saved."
      AND the banner includes a [Save to Google Sheet] button
      AND no Sheets API calls are made
      AND no WebSocket connection is opened

R1.2: GIVEN dataSource='sandbox' and user drags a task bar
      WHEN the task position changes
      THEN state updates via localDispatch (React only)
      AND scheduleSave() is NOT called
      AND no Yjs document is updated

R1.3: GIVEN dataSource='sandbox' and user signs in (to browse sheets)
      WHEN sign-in completes
      THEN dataSource remains 'sandbox' (signing in alone doesn't change mode)
      AND no Yjs connection is opened (defense-in-depth guard)

R1.4: GIVEN ?sheet=ABC123 in the URL
      WHEN the app loads
      THEN dataSource is set to 'loading'
      AND tasks is set to [] (empty array, NOT fakeTasks)
      AND the UI shows timeline scaffolding with a loading indicator
      AND loadFromSheet() is called

R1.5: GIVEN dataSource='loading' and loadFromSheet() returns 5 tasks
      WHEN SET_TASKS is dispatched
      THEN dataSource transitions to 'sheet'
      AND the 5 tasks render in the Gantt chart
      AND auto-save is enabled
      AND polling starts (30s interval)

R1.6: GIVEN dataSource='loading' and loadFromSheet() returns []
      WHEN the load completes
      THEN dataSource transitions to 'empty'
      AND the empty state UI renders (R2)

R1.7: GIVEN dataSource='loading' and loadFromSheet() fails with 403
      WHEN the error is caught
      THEN dataSource remains 'loading'
      AND syncError is set to { type: 'forbidden', message: "Can't access this sheet..." }
      AND the UI shows the error with [Open another sheet] and [Retry]
```

**Promotion flow** (Journey 6):
```typescript
async function promoteToSheet(sheetId: string, tasks: Task[]) {
  // 1. Write current state to sheet
  const rows = tasksToRows(tasks);
  const endCol = columnLetter(SHEET_COLUMNS.length); // derived, not hardcoded
  await updateSheet(sheetId, `Sheet1!A1:${endCol}${rows.length}`, rows);

  // 2. Initialize sync (enables polling + auto-save)
  initSync(sheetId, dispatch);
  startPolling();

  // 3. Update URL
  const url = new URL(window.location.href);
  url.searchParams.set('sheet', sheetId);
  url.searchParams.set('room', sheetId);
  window.history.replaceState({}, '', url.toString());

  // 4. Transition state
  dispatch({ type: 'SET_DATA_SOURCE', dataSource: 'sheet' });
}
```

**URL convention**: Promotion always sets both `?sheet=` and `?room=` to the same
spreadsheet ID (matches existing convention in `docs/local-testing.md`). The relay room
is created implicitly when the first client connects.

**Shareable URL**: After promotion, the URL `ganttlet.app/?sheet=ABC&room=ABC` gives
collaborators both Sheets sync and real-time collaboration.

### R2: Empty State with Structure

**Problem**: Empty sheets show fake data instead of guidance.

**Journeys served**: 3 (new project, blank template), 4 (empty existing sheet)

**Proposal**: When connected to an empty sheet, render:

- Timeline header, grid lines, today marker (visual scaffolding)
- A centered call-to-action area:
  - **Primary**: "Add your first task" — inline task-creation row at the top of the table
  - **Secondary**: "Or start from a template" — opens template picker (R5)
- Brief value prop copy: *"Changes sync to your Google Sheet in real time"*
- The table panel shows column headers but no rows (except the add-task row)

**Requirements:**

```
R2.1: GIVEN dataSource='empty'
      WHEN the main layout renders
      THEN the timeline panel shows grid lines, headers, and today marker
      AND the table panel shows column headers with an add-task input row
      AND a centered CTA area shows "Add your first task" and "Or start from a template"
      AND no fake data is visible anywhere

R2.2: GIVEN dataSource='empty' and user clicks "Add your first task"
      WHEN the user types a task name and presses Enter
      THEN a new task is created with sensible defaults (startDate=today, duration=1)
      AND dataSource transitions from 'empty' to 'sheet'
      AND auto-save writes the new task to the connected Google Sheet

R2.3: GIVEN dataSource='empty' and user clicks "Or start from a template"
      WHEN the template picker opens
      THEN user can select a template (same options as R5)
      AND selecting a template populates the sheet with template tasks
      AND dataSource transitions to 'sheet'
```

### R3: Sheet Selection UI

**Problem**: Users must manually copy spreadsheet IDs into URLs.

**Journeys served**: 2 (return visitor), 3 (new project), 4 (existing sheet), 6 (promotion)

**Proposal**: Lightweight in-app sheet browser using existing `drive.metadata.readonly`
scope. Lists the user's recent spreadsheets via Drive API. Also accepts pasted Google
Sheets URLs (extracts spreadsheet ID automatically).

```
┌─ Select a Google Sheet ────────────────────────┐
│                                                │
│  Recent spreadsheets:                          │
│  ┌────────────────────────────────────────┐    │
│  │ Q2 Product Launch    Modified 2h ago   │    │
│  │ Sprint Planning      Modified 1d ago   │    │
│  │ Budget 2026          Modified 3d ago   │    │
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

**Implementation notes:**
- No new OAuth scopes needed — `drive.metadata.readonly` is already granted
- Parse pasted URLs: extract ID from `docs.google.com/spreadsheets/d/{ID}/...`
- Google Picker API (full Drive browsing, folder placement) is a future enhancement
  requiring `drive.file` scope via incremental authorization

**Recent sheets list** stored in `localStorage` under key `ganttlet-recent-sheets`:
- Schema: `Array<{ sheetId: string, title: string, lastOpened: number }>`
- Updated on every successful sheet connection (load completes without error)
- Max 10 entries, LRU eviction (oldest `lastOpened` dropped when full)
- Entries removed when a sheet returns 403/404 (Journey 7 error handling)
- Used by Journey 2 (return visitor welcome) and R7 (sheet management dropdown)

**Requirements:**

```
R3.1: GIVEN user is signed in and clicks "Connect Existing Sheet"
      WHEN the sheet selector modal opens
      THEN it shows a list of the user's recent Google spreadsheets
      (via GET drive/v3/files?q=mimeType='spreadsheet', max 20 results)
      AND a text input for pasting a Google Sheets URL

R3.2: GIVEN user pastes "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0"
      WHEN the URL is parsed
      THEN the spreadsheet ID "ABC123" is extracted
      AND the [Connect] button becomes enabled

R3.3: GIVEN user pastes an invalid URL (no spreadsheet ID found)
      WHEN the URL is parsed
      THEN an inline error shows: "Couldn't find a spreadsheet ID in this URL"

R3.4: GIVEN user selects a sheet and clicks [Connect]
      WHEN the connection succeeds
      THEN the sheet is added to the recent sheets list in localStorage
      AND the URL updates to include ?sheet=ID&room=ID

R3.5: GIVEN the recent sheets list has 10 entries
      WHEN a new sheet is connected
      THEN the oldest entry (by lastOpened) is evicted
      AND the new entry is added
```

### R4: Column Auto-Detection & Mapping

**Problem**: Connecting a sheet with non-standard columns fails silently or produces
garbled data.

**Journeys served**: 4 (existing sheet), 8 (sheets-first user)

**Two-tier approach:**

**Tier 1 — Header validation (ship early):** Read the first row of the sheet, compare
against `SHEET_COLUMNS`. The match rules are:
- Case-insensitive comparison (`StartDate` matches `startDate`)
- Exact column names only (no fuzzy matching in Tier 1)
- Order must match `SHEET_COLUMNS` — columns A through T in the defined order
- All 20 columns must be present for a match
- Extra columns after T are ignored (forward-compatible)
- A sheet with no header row (row 1 empty) is treated as an empty sheet, not a mismatch

If headers don't match, show a clear error with the expected vs found columns, and
offer to create a new sheet or download a header template CSV.

**Tier 2 — Column mapping UI (larger effort):** When connecting a sheet with data:

1. Read the header row
2. Auto-map recognized columns using fuzzy matching:
   - Exact: `name`, `start_date`, `end_date`, `duration`, `owner`
   - Fuzzy: `task name` → `name`, `assignee` → `owner`, `begin` → `start_date`
   - Unmapped columns shown as "custom fields" (read-only initially)
3. Show a mapping preview modal where users confirm or adjust mappings
4. Store the mapping in a `_ganttlet_meta` tab (hidden, auto-created) so it persists
   across sessions

**Requirements (Tier 1):**

```
R4.1: GIVEN a sheet with header row ["id","name","startDate","endDate","duration",
      "owner","workStream","project","functionalArea","done","description",
      "isMilestone","isSummary","parentId","childIds","dependencies","notes",
      "okrs","constraintType","constraintDate"]
      WHEN loadFromSheet() reads the data
      THEN headers match and tasks load normally

R4.2: GIVEN a sheet with header row ["Task","Start","End","Assignee","Priority"]
      WHEN loadFromSheet() reads the data
      THEN a column mismatch error is shown with expected vs found columns
      AND no tasks are loaded (dataSource stays 'loading' with syncError set)
      AND user sees [Create a new sheet instead] and [Download header template]

R4.3: GIVEN a sheet with header row ["ID","Name","StartDate"] (case differs)
      WHEN headers are compared
      THEN comparison is case-insensitive — "StartDate" matches "startDate"
      BUT only 3 of 20 required columns are present, so this is still a mismatch

R4.4: GIVEN a sheet with row 1 completely empty and no data
      WHEN loadFromSheet() reads the data
      THEN it is treated as an empty sheet (dataSource='empty'), not a mismatch

R4.5: GIVEN user clicks [Download header template]
      WHEN the download triggers
      THEN a CSV file is downloaded containing one row with all 20 SHEET_COLUMNS values
```

### R5: Project Templates

**Problem**: No way to start a structured project without building from scratch.

**Journeys served**: 3 (new project), 6 (promotion), 8 (sheets-first)

**Proposal**: 3-5 built-in templates, each 8-15 tasks:

| Template | Phases | Tasks |
|---|---|---|
| **Blank** | — | Header row only, no tasks |
| **Software Release** | Planning → Development → Testing → Launch | ~12 tasks |
| **Marketing Campaign** | Strategy → Content Creation → Launch → Analysis | ~10 tasks |
| **Event Planning** | Venue & Logistics → Promotion → Execution → Post-event | ~10 tasks |

Templates are stored as static data (like `fakeData.ts` but intentionally structured).
The existing `fakeTasks` data is refactored into the "Software Release" template.

**Public Google Sheet template:** In addition to in-app templates, publish a public
Google Sheet with the correct 20-column header and example rows. This serves Journey 8
(sheets-first users) and doubles as documentation of the expected format. Users click
"Use Template" in Google Sheets → get a copy in their Drive → connect to Ganttlet.

**Requirements:**

```
R5.1: GIVEN user selects "Software Release" template and clicks [Create]
      WHEN a new Google Sheet is created via POST /v4/spreadsheets
      THEN the sheet title matches the user's project name input
      AND row 1 contains all 20 SHEET_COLUMNS as headers
      AND rows 2+ contain the template tasks (refactored from current fakeData.ts)
      AND all task dates are business days (no weekends)
      AND all durations match the inclusive convention (taskDuration(start, end))
      AND the URL updates to ?sheet=ID&room=ID
      AND dataSource transitions to 'sheet'

R5.2: GIVEN user selects "Blank" template
      WHEN the sheet is created
      THEN only the header row is written (no task rows)
      AND dataSource is set to 'empty' (shows empty state, R2)

R5.3: GIVEN template data files exist in src/data/templates/
      WHEN each template is validated
      THEN every task has: id, name, startDate, endDate, duration
      AND no task starts or ends on a weekend
      AND duration === taskDuration(startDate, endDate) for every task
      AND parent/child relationships are consistent (childIds ↔ parentId)
```

### R6: Onboarding Flow

**Problem**: No guided onboarding. Users must read docs to learn about URL params.

**Journeys served**: 1 (curious visitor), 2 (return visitor), 5 (collaborator)

**Proposal**: Context-aware welcome experience:

**First visit (no auth, no URL params):**
```
┌─ Welcome ──────────────────────────────────────────────┐
│                                                        │
│  Ganttlet                                              │
│  Free Gantt charts with real-time Google Sheets sync   │
│                                                        │
│  [Try the demo]              [Sign in with Google]     │
│                                                        │
│  Two-way sync — edit in the chart or the sheet         │
│  Real-time collaboration — see changes as they happen  │
│  Runs in your browser — your data stays in Google Drive│
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Return visit (auth in localStorage + recent sheets):**
```
┌─ Welcome back ─────────────────────────────────────────┐
│                                                        │
│  Welcome back, Sarah.                                  │
│                                                        │
│  Recent projects:                                      │
│    Q2 Product Launch         2 hours ago               │
│    Sprint Planning           3 days ago                │
│                                                        │
│  [New Project]   [Connect Existing Sheet]  [Demo]      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Collaborator (has `?sheet=` or `?room=` in URL, not signed in):**
```
┌─ Collaborate ──────────────────────────────────────────┐
│                                                        │
│  You've been invited to collaborate on a project.      │
│                                                        │
│  [Sign in with Google]                                 │
│                                                        │
│  Your changes appear instantly for all collaborators.  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**After sign-in (no sheet selected):**
```
┌─ Choose path ──────────────────────────────────────────┐
│                                                        │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ New Project   │    │ Existing     │                  │
│  │               │    │ Sheet        │                  │
│  └──────────────┘    └──────────────┘                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Total time target**: Under 60 seconds from landing to seeing your Gantt chart.

**Requirements:**

```
R6.1: GIVEN first visit (no auth in localStorage, no URL params)
      WHEN the app loads
      THEN the welcome screen shows with [Try the demo] and [Sign in with Google]
      AND value props are visible without scrolling
      AND clicking [Try the demo] enters sandbox mode with fakeTasks

R6.2: GIVEN return visit (auth in localStorage, recent sheets list has entries)
      WHEN the app loads (no URL params)
      THEN the welcome screen shows "Welcome back, {name}"
      AND recent projects are listed with titles and "last opened" times
      AND clicking a recent project sets ?sheet=ID&room=ID and loads immediately
      AND [New Project], [Connect Existing Sheet], and [Demo] buttons are shown

R6.3: GIVEN ?sheet= or ?room= in URL and user is NOT signed in
      WHEN the app loads
      THEN the collaborator welcome screen shows
      AND only [Sign in with Google] is offered (no demo, no template picker)
      AND after sign-in, the sheet loads automatically (no intermediate screen)

R6.4: GIVEN user signs in from the first-visit welcome (no URL params)
      WHEN sign-in completes
      THEN the "Choose path" screen shows with [New Project] and [Existing Sheet]
      AND if recent sheets exist, they are also shown
```

### R7: Sheet Management & Share Links

**Problem**: No way to switch sheets, disconnect, see what's connected, or share.

**Journeys served**: 2 (return visitor), 5 (collaborator — receiving links)

**Proposal**: Add to the header bar (when signed in and connected):

- **Sheet name** (fetched via Sheets API `spreadsheets.get`) displayed as a clickable
  link that opens the sheet in Google Sheets in a new tab
- **Share button** that copies the current URL (`?sheet=ID&room=ID`) to clipboard with
  toast: *"Link copied. Anyone with access to the Google Sheet can collaborate."*
  If `?room=` isn't in the URL yet, the share action adds it (using sheet ID as room ID)
- **Dropdown menu** on the sheet name:
  - "Open in Google Sheets" → new tab
  - "Switch sheet" → sheet selector (R3)
  - "Create new project" → template picker (R5)
  - "Disconnect" → returns to welcome
- **Recent sheets** stored in `localStorage` for quick switching

**Requirements:**

```
R7.1: GIVEN dataSource='sheet' and user is signed in
      WHEN the header renders
      THEN the connected sheet's title is shown (fetched via spreadsheets.get)
      AND clicking the title opens the sheet in Google Sheets in a new tab
      AND a Share button is visible

R7.2: GIVEN user clicks [Share]
      WHEN the URL already has ?sheet=ID
      THEN ?room=ID is added if missing (using sheet ID as room ID)
      AND the full URL is copied to clipboard
      AND a toast shows: "Link copied. Anyone with access to the Google Sheet can
      collaborate."

R7.3: GIVEN user clicks "Disconnect" in the sheet dropdown
      WHEN the action is confirmed
      THEN ?sheet= and ?room= are removed from the URL
      AND dataSource transitions to 'sandbox'
      AND polling and auto-save stop
      AND Yjs disconnects
      AND the welcome screen shows (return visitor variant if auth persists)

R7.4: GIVEN user clicks "Switch sheet" in the dropdown
      WHEN the sheet selector opens (same as R3)
      THEN selecting a new sheet disconnects the current one
      AND connects to the new sheet (full load cycle)
```

### R8: Decouple Fake Data from Production Code

**Problem**: `fakeData.ts` is imported unconditionally and used as initial state.

**Journeys served**: All — prerequisite for every other recommendation

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
  dataSource: 'loading',  // or 'sandbox' based on URL
  // ...
};
```

- `fakeTasks` is only imported and used in sandbox mode (lazy import)
- Auto-save guard: `scheduleSave` only fires when `dataSource === 'sheet'`
- Yjs hydration guard: only hydrate from loaded sheet tasks, never from fake data
- `fakeData.ts` moves to `src/data/templates/softwareRelease.ts` and becomes a template

**Requirements:**

```
R8.1: GIVEN the app loads with ?sheet=ABC123
      WHEN GanttContext initializes
      THEN initialState.tasks is [] (empty array)
      AND initialState.dataSource is 'loading'
      AND fakeData.ts / softwareRelease.ts is NOT imported

R8.2: GIVEN the app loads with no URL params
      WHEN GanttContext initializes
      THEN initialState.dataSource is 'sandbox'
      AND fakeTasks are loaded (lazy import from templates/softwareRelease.ts)
      AND scheduleSave() is never called regardless of state.tasks changes

R8.3: GIVEN dataSource='sandbox' and Yjs connection is attempted
      WHEN connectCollab() is called
      THEN the connection is blocked (guard checks dataSource !== 'sandbox')
      AND no WebSocket is opened

R8.4: GIVEN dataSource='sheet' and state.tasks changes
      WHEN the useEffect fires
      THEN scheduleSave() is called (auto-save active)

R8.5: GIVEN dataSource='empty' and state.tasks changes (first edit)
      WHEN the useEffect fires
      THEN dataSource transitions to 'sheet'
      AND scheduleSave() is called

R8.6: GIVEN dataSource='sandbox' and user has modified tasks
      WHEN the user attempts to close/navigate away from the tab
      THEN a beforeunload dialog warns: "You have unsaved changes"

R8.7: GIVEN dataSource='sandbox' and user has NOT modified tasks
      WHEN the user closes the tab
      THEN no beforeunload warning is shown
```

**Dirty tracking for beforeunload:** Compare `state.tasks` length and content against
the initial `fakeTasks` snapshot. Set a `sandboxDirty` flag on any `TASK_MODIFYING_ACTION`
dispatch when `dataSource === 'sandbox'`. The flag is cheap — just a boolean set once on
first edit, not a deep comparison on every change.

### R9: Preserve Existing Sheet Data & Error Handling

**Problem**: Auto-save can overwrite sheet data, and all sync errors are silent.

**Journeys served**: 4 (existing sheet safety), 7 (error recovery)

**Proposal:**

**Data safety:**
- **Read-before-write**: On first connect, always complete `loadFromSheet()` before
  enabling auto-save. The `dataSource` lifecycle handles this — `dataSource` starts as
  `'loading'` and only transitions to `'sheet'` after successful load.
- **Intent-gated writes**: Don't write to the sheet until the user has performed an
  explicit action. The `dataSource` state machine provides this gate.
- **Source tracking**: Tag writes with a `_ganttlet_last_modified` cell (e.g., `U1`) to
  detect external modifications between polls.
- **Conflict warning**: If the sheet changed externally between polls and the user also
  made local changes, show a merge confirmation dialog.

**Error infrastructure:**
- Add `syncError` to `GanttState`: `{ type, message, since } | null`
- Discriminate error codes in sheetsClient.ts — 404 (sheet deleted) should not retry the
  same way as 429 (rate limit)
- Build a minimal notification system: fixed-position bar for persistent errors (auth,
  sheet access), transient status for recoverable issues (rate limit, network)
- Track error state transitions, not individual retry attempts — show one notification
  per error sequence, not per retry
- Add `navigator.onLine` detection + `online`/`offline` event listeners
- Add backoff to polling errors (currently polls every 30s regardless of failures)

**Requirements:**

```
R9.1: GIVEN dataSource='sheet' and scheduleSave() gets a 429 response
      WHEN retryWithBackoff begins retrying
      THEN syncError is set to { type: 'rate_limit', ... }
      AND the sync indicator shows "Sync paused — retrying automatically"
      AND the indicator is shown ONCE (not re-shown per retry attempt)
      AND when the save eventually succeeds, syncError is cleared
      AND the indicator returns to "Synced"

R9.2: GIVEN dataSource='sheet' and polling gets a 404 response
      WHEN the error is caught
      THEN syncError is set to { type: 'not_found', ... }
      AND polling STOPS (no point retrying a deleted sheet)
      AND a banner shows: "Can't access this sheet. It may have been deleted."
      AND the sheet is removed from the recent sheets list
      AND [Open another sheet] button is shown

R9.3: GIVEN dataSource='sheet' and the OAuth token expires
      WHEN a Sheets API call fails with 401
      THEN syncError is set to { type: 'auth', ... }
      AND a banner shows: "Session expired. [Re-authorize] to keep syncing."
      AND unsaved changes are queued locally (not discarded)
      AND clicking [Re-authorize] triggers token refresh
      AND on success, syncError clears and queued changes are saved

R9.4: GIVEN navigator.onLine transitions to false
      WHEN the offline event fires
      THEN syncError is set to { type: 'network', ... }
      AND a banner shows: "You're offline. Changes saved locally."
      AND when navigator.onLine transitions back to true
      THEN syncError is cleared
      AND a sync cycle runs immediately (save pending changes, poll for updates)

R9.5: GIVEN dataSource='sheet' and polling errors occur 3 times consecutively
      WHEN the third polling error is caught
      THEN polling interval doubles (exponential backoff, max 5 min)
      AND when a poll succeeds, interval resets to 30s

R9.6: GIVEN syncError is set (any type) and user is editing tasks locally
      WHEN the user drags a task bar or edits a field
      THEN the edit succeeds locally (state updates, chart re-renders)
      AND the edit is queued for sync when the error condition resolves
      (local editing must NEVER be blocked by sync errors)
```

---

## Implementation Order

Rough sequencing — not rigid phases, but dependency-driven ordering:

1. **Prerequisite: Write range fix** — Issue #62. Independent, ship first.
2. **Foundation: R8 (decouple fake data) + R1 (dataSource state machine)** — Everything
   else depends on the mode separation. Ship together.
3. **Core UX: R2 (empty state) + R6 (onboarding flow) + R3 (sheet selector)** — These
   form the first complete onboarding experience. Includes the return visitor welcome
   (Journey 2) and the recent sheets list.
4. **Creation: R5 (templates) + R7 (sheet management + share links)** — Enables
   Journey 3 (new project) and completes Journey 2 (quick switching).
5. **Safety: R9 (error handling + data safety)** — Can ship incrementally alongside
   3 and 4 — each error type is independent.
6. **Import: R4 Tier 1 (header validation)** — Small, can ship with group 3.
   R4 Tier 2 (column mapping UI) is a separate larger effort.
7. **Sheets-first: Journey 8** — Level 1 (template + docs) can ship anytime. Level 2
   (prepare my sheet) depends on R4. Level 3 (add-on) is a separate project.

---

## Open Questions

1. **Template ownership**: Should templates live as static JSON in the app bundle, or as
   public Google Sheets that get copied? Static is simpler; Sheets copies let us update
   templates without app deploys. **Recommendation**: Both. Static JSON for in-app
   template creation, published Google Sheet for Journey 8 (sheets-first users).

2. **Column mapping complexity**: How far do we go with non-standard sheets? MVP is
   header validation + error message + downloadable template. Full mapping is a larger
   effort. **Open**: How many mapping variations do real users actually need?

3. **Multi-sheet projects**: Should a user be able to have multiple sheets open as tabs
   within one Ganttlet session? Or is it always one sheet = one project?

4. **Sandbox → Sheet promotion with existing data**: Resolved — see Journey 6 for the
   three-way check (empty → write directly; Ganttlet-format data → offer replace/open;
   non-Ganttlet data → recommend new sheet with overwrite as secondary option).

5. ~~Collaboration in sandbox mode~~ **Resolved** — Sandbox disables Yjs entirely.

6. ~~Sandbox persistence~~ **Resolved** — Ephemeral by default with `beforeunload`
   warning if user has made edits.

7. ~~Google Picker scope~~ **Resolved** — see "OAuth & Scope Strategy" below.

8. ~~Sheet creation via API~~ **Resolved** — see "OAuth & Scope Strategy" below.

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
on this endpoint to specify a parent folder. Moving to a folder requires the Drive API
(`files.update` with `addParents`), which requires `drive.file` scope.

### Approach: start simple, escalate later

**Initial implementation — no new scopes needed:**

Sheet creation via `spreadsheets` scope works. New sheets land in Drive root. Lightweight
sheet listing uses existing `drive.metadata.readonly`:

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

Sheet creation (no new scope):
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
      sheets: [{ properties: { title: 'Sheet1' } }],
    }),
  });
  const data = await res.json();
  return data.spreadsheetId;
}
```

**Future enhancement — add `drive.file` when needed:**

Google Picker + folder placement via incremental authorization:

```typescript
// Only when user clicks "Browse Drive" or "Choose folder"
tokenClient.requestAccessToken({
  scope: 'https://www.googleapis.com/auth/drive.file',
  include_granted_scopes: true,
});
```

`drive.file` is "recommended" tier — no additional verification needed. It only grants
access to files the user explicitly opens via Picker or that the app creates.

---

## Appendix: Architecture Context

### Pre-existing bugs discovered during review

**Bug: Write range truncates constraint columns** (`sheetsSync.ts:66`)
The `scheduleSave()` function writes to range `Sheet1!A1:R{N}` — column R is the 18th
column. But `SHEET_COLUMNS` has 20 entries (columns A-T). Columns S (`constraintType`)
and T (`constraintDate`) are silently dropped on every write. This is a critical bug that
should be fixed in a separate PR before the onboarding work begins.
Tracked in [issue #62](https://github.com/IMBurbank/ganttlet/issues/62).

**Bug: Root task duration is 84, should be 85** (`fakeData.ts`)
The root summary task "Q2 Product Launch" has `startDate: '2026-03-02'`,
`endDate: '2026-06-26'`, `duration: 84`. Inclusive business-day count is 85. When this
data is refactored into a template (R5/R8), the duration should be corrected. (Summary
task durations are auto-calculated from children at render time, so this doesn't affect
behavior.)

### Current data model (post-Phase 16)

**Sheet schema** — 20 columns defined in `sheetsMapper.ts:SHEET_COLUMNS`:
```
id, name, startDate, endDate, duration, owner, workStream, project,
functionalArea, done, description, isMilestone, isSummary, parentId,
childIds, dependencies, notes, okrs, constraintType, constraintDate
```

### Current vs proposed data flow

**Current:**
```
fakeTasks (hardcoded)
  ↓ initialState (always)
GanttContext reducer
  ↓ state.tasks changes
scheduleSave() → Sheets API → writes to sheet (always, if signed in)
  ↓ also
hydrateYjsFromTasks() → Yjs doc → relay → collaborators
```

**Proposed:**
```
User arrives:
  No ?sheet= → dataSource='sandbox', load fakeTasks locally (no writes)
  Has ?sheet= → dataSource='loading', tasks=[], show skeleton

  Loading resolves:
    Data found → dataSource='sheet', SET_TASKS, auto-save on
    Empty sheet → dataSource='empty', show empty state, first edit enables save
    Error → show error state, local editing still works

  Sandbox promotion:
    User clicks "Save to Google Sheet"
    → sign in if needed → create/select sheet → write tasks → dataSource='sheet'

Connected mode:
  User makes intentional edit → auto-save writes to sheet
  Polling reads external changes → merge into state
  Yjs syncs to collaborators
```

### Key files to modify

| File | Change |
|---|---|
| `src/types/index.ts` | Add `dataSource` to `GanttState` |
| `src/state/GanttContext.tsx` | Empty initial state, data source tracking, save gating |
| `src/state/ganttReducer.ts` | Handle `SET_DATA_SOURCE`, `SET_SYNC_ERROR` actions |
| `src/data/fakeData.ts` | Move to `src/data/templates/softwareRelease.ts` |
| `src/sheets/sheetsSync.ts` | Intent-gated saves, error discrimination, polling backoff |
| `src/sheets/sheetsMapper.ts` | Header validation, `HEADER_ROW` export |
| `src/components/layout/Header.tsx` | Sheet name, share button, sandbox banner |
| New: `src/components/onboarding/` | Welcome, template picker, empty state, error states |
| New: `src/sheets/sheetsBrowser.ts` | Drive file listing (lightweight picker) |
| New: `src/data/templates/` | Template task arrays |
