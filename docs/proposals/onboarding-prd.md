# Product Requirements Document: User Onboarding & New Schedule Experience

**Status**: Draft
**Date**: 2026-03-20
**Source**: [Proposal](./onboarding-ux.md)
**Prerequisite**: [Issue #62 — Write range fix](https://github.com/IMBurbank/ganttlet/issues/62)

---

## 1. Overview

Ganttlet needs a user onboarding experience. Today, every session loads hardcoded fake
data, there's no way to select a sheet from within the app, and returning users have no
way to get back to their project. This PRD defines the requirements for fixing these
problems across 8 user journeys.

### Success criteria

- A first-time visitor can understand what Ganttlet does and try the demo in under 10
  seconds
- A return visitor can resume their project in one click
- A new project can be created from a template without leaving the app
- No data is ever written to a Google Sheet without explicit user intent
- All sync errors are surfaced with clear, non-blocking feedback
- Total time from first landing to seeing your own Gantt chart: under 60 seconds

---

## 2. Architecture

### 2.1 Two-Layer Rendering

The app has two layers:

1. **WelcomeGate** — a routing component that renders *before* the Gantt chart. It
   decides what to show based on URL params and auth state. It does not set `dataSource`
   — it presents choices that lead to a `dataSource` being set.

2. **GanttApp** — the Gantt chart, table, and all editing UI. Renders only after
   `dataSource` is set to one of: `'sandbox'`, `'loading'`, `'sheet'`, or `'empty'`.

```
┌─────────────────────────────────────────────────┐
│ App.tsx                                         │
│                                                 │
│   Has ?sheet= in URL? ──yes──► <GanttApp />     │
│         │                      dataSource=      │
│         no                     'loading'        │
│         │                                       │
│         ▼                                       │
│   <WelcomeGate />                               │
│   Decides welcome variant,                      │
│   user picks action,                            │
│   then renders <GanttApp />                     │
│   with appropriate dataSource                   │
└─────────────────────────────────────────────────┘
```

### 2.2 State Model

Three new fields on `GanttState`:

```typescript
// App mode — set after WelcomeGate routing or URL detection
dataSource: 'sandbox' | 'loading' | 'sheet' | 'empty'

// Sync error overlay — independent of dataSource
// Set when a sync operation fails, cleared when it recovers
syncError: {
  type: 'auth' | 'not_found' | 'forbidden' | 'rate_limit' | 'network';
  message: string;
  since: number;   // Date.now() when error first occurred
} | null

// Dirty flag for sandbox beforeunload warning
sandboxDirty: boolean
```

### 2.3 State Machine

```
  WelcomeGate                         URL has ?sheet=
  "Try the demo"                            │
       │                                    │
       ▼                                    ▼
   SANDBOX ──── promotion ────────────► LOADING
       ▲        (Journey 6)                 │
       │                           ┌────────┼────────┐
   Disconnect                      │        │        │
       │                           ▼        ▼        ▼
       │                        SHEET    EMPTY    LOADING
       ├─────────────────────── (data)   (no data) (error:
       │                          ▲        │       syncError
       │                          │        │       is set)
       │                          └────────┘
       │                          first edit
       │
  SHEET or EMPTY ── disconnect ──► WelcomeGate (return visitor variant)
```

**Transitions:**

| From | To | Trigger | Example |
|---|---|---|---|
| WelcomeGate | `sandbox` | User clicks "Try the demo" | Journey 1 |
| WelcomeGate | `loading` | User picks a recent project, selects a sheet, or creates a new project | Journeys 2, 3, 4 |
| (URL) | `loading` | App loads with `?sheet=` in URL | Journeys 5, 8 |
| `sandbox` | `sheet` | Promotion flow completes (Journey 6) | User saves demo to a real sheet |
| `loading` | `sheet` | `loadFromSheet()` returns tasks | 5 tasks loaded from the sheet |
| `loading` | `empty` | `loadFromSheet()` returns `[]` | Sheet has header row but no task rows |
| `loading` | `loading` | `loadFromSheet()` throws (HTTP error) | 403 forbidden — `syncError` is set, UI shows error |
| `empty` | `sheet` | User performs first task-modifying action | Adds a task, edits a field |
| `sheet` | WelcomeGate | User clicks "Disconnect" | URL cleared, welcome screen shown |
| `empty` | WelcomeGate | User clicks "Disconnect" | Same as above |

**Invalid transitions** (must never happen):
- `sandbox` → `loading` (sandbox exits only via promotion to `sheet`)
- `sheet` → `sandbox` (disconnect goes to WelcomeGate, not sandbox)
- `loading` → `sandbox` (loading exits to `sheet`, `empty`, or stays with error)

### 2.7 State Machine Requirements

```
REQ-SM-STATE-1: GIVEN no ?sheet= param in the URL
                WHEN the app loads
                THEN WelcomeGate renders (no Gantt chart)
                AND dataSource is NOT yet set
                AND no Sheets API calls are made
                AND no WebSocket connection is opened

REQ-SM-STATE-2: GIVEN user clicks "Try the demo" on any WelcomeGate screen
                WHEN sandbox is entered
                THEN dataSource is set to 'sandbox'
                AND fakeTasks are lazy-imported and loaded
                AND a persistent banner shows with [Save to Google Sheet]
                AND no Sheets API calls are made
                AND no WebSocket connection is opened

REQ-SM-STATE-3: GIVEN dataSource='sandbox' and user edits a task
                WHEN the edit is applied
                THEN state updates via localDispatch only (no Yjs, no Sheets)
                AND scheduleSave() is NOT called
                AND sandboxDirty is set to true

REQ-SM-STATE-4: GIVEN dataSource='sandbox' and user signs in
                WHEN sign-in completes
                THEN dataSource remains 'sandbox'
                AND no Yjs connection is opened
                AND the [Save to Google Sheet] button remains available

REQ-SM-STATE-5: GIVEN ?sheet=ABC123 in the URL and user is signed in
                WHEN the app loads
                THEN WelcomeGate is skipped
                AND dataSource is set to 'loading'
                AND tasks is [] (NOT fakeTasks)
                AND the UI shows timeline scaffolding with a loading indicator
                AND loadFromSheet() is called immediately

REQ-SM-STATE-6: GIVEN ?sheet=ABC123 in the URL and user is NOT signed in
                WHEN the app loads
                THEN the Collaborator Welcome screen shows (section 3.4)
                AND after sign-in, loadFromSheet() runs automatically

REQ-SM-STATE-7: GIVEN dataSource='loading' and loadFromSheet() returns tasks
                WHEN SET_TASKS is dispatched
                THEN dataSource transitions to 'sheet'
                AND tasks render in the Gantt chart
                AND auto-save and polling activate
                AND Yjs connects if ?room= is in URL

REQ-SM-STATE-8: GIVEN dataSource='loading' and loadFromSheet() returns []
                WHEN the load completes
                THEN dataSource transitions to 'empty'
                AND the empty state UI renders (section 7)

REQ-SM-STATE-9: GIVEN dataSource='loading' and loadFromSheet() throws HTTP 403
                WHEN the error is caught
                THEN dataSource remains 'loading'
                AND syncError is set to { type: 'forbidden' }
                AND UI shows error with [Retry] and [Open another sheet]
```

### 2.4 syncError Behavior

`syncError` overlays on `dataSource` — it doesn't replace it:

| dataSource | syncError | What user sees |
|---|---|---|
| `sheet` | `null` | Normal Gantt chart, sync indicator shows "Synced" |
| `sheet` | `{ type: 'rate_limit' }` | Normal Gantt chart + status: "Sync paused — retrying" |
| `sheet` | `{ type: 'not_found' }` | Normal Gantt chart + banner: "Can't access this sheet" |
| `sheet` | `{ type: 'auth' }` | Normal Gantt chart + banner: "Session expired. [Re-authorize]" |
| `sheet` | `{ type: 'network' }` | Normal Gantt chart + banner: "You're offline" |
| `loading` | `{ type: 'forbidden' }` | Loading skeleton + error: "Can't access. [Retry] [Open another]" |

`syncError` is set **once per error sequence** (when the first failure occurs) and
cleared when the operation succeeds. It is NOT set per retry attempt.

### 2.5 Auto-Save Gating

`scheduleSave()` only fires when `dataSource === 'sheet'`:

| dataSource | scheduleSave() behavior |
|---|---|
| `sandbox` | No-op. Never called. |
| `loading` | No-op. Never called. |
| `empty` | No-op. First edit transitions to `sheet`, THEN save fires. |
| `sheet` | Active. Debounced 2s, full-state write. |

### 2.6 Yjs Gating

Yjs (WebSocket to relay) only connects when `dataSource === 'sheet'` and `?room=` is
in the URL:

| dataSource | Yjs behavior |
|---|---|
| `sandbox` | No connection. Guard: `dataSource !== 'sandbox'` in GanttContext. |
| `loading` | No connection (waiting for data). |
| `empty` | No connection (no data to sync yet). Connects after → `sheet`. |
| `sheet` | Connects if `?room=` is in URL. Uses `collabDispatch`. |

---

## 3. WelcomeGate Routing

WelcomeGate renders one of four screens based on state. It does NOT render the Gantt
chart — it gates entry to it.

### 3.1 Decision Logic

```
Input: URL params, localStorage auth, localStorage recent sheets

if URL has ?sheet= or ?room=:
  if user is signed in:
    → skip WelcomeGate entirely, render GanttApp with dataSource='loading'
  else:
    → show Collaborator Welcome (3.4)

else (no URL params):
  if localStorage has auth AND recent sheets list is non-empty:
    → show Return Visitor Welcome (3.3)
  else if localStorage has auth but no recent sheets:
    → show Choose Path (3.5)
  else:
    → show First Visit Welcome (3.2)
```

### 3.2 First Visit Welcome

**When:** No auth in localStorage, no URL params.

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

**Actions:**
- [Try the demo] → set `dataSource='sandbox'`, lazy-import fakeTasks, render GanttApp
- [Sign in with Google] → OAuth flow → show Choose Path (3.5)

### 3.3 Return Visitor Welcome

**When:** Auth in localStorage, recent sheets list has entries, no URL params.

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

**Actions:**
- Click recent project → set `?sheet=ID&room=ID` in URL, set `dataSource='loading'`,
  render GanttApp
- [New Project] → show Template Picker (section 6)
- [Connect Existing Sheet] → show Sheet Selector (section 5)
- [Demo] → set `dataSource='sandbox'`, render GanttApp

### 3.4 Collaborator Welcome

**When:** `?sheet=` or `?room=` in URL, user is NOT signed in.

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

**Actions:**
- [Sign in with Google] → OAuth flow → `loadFromSheet()` called automatically → no
  intermediate screen

### 3.5 Choose Path

**When:** User just signed in from First Visit Welcome (3.2), no URL params, OR has auth
but no recent sheets.

```
┌─ Choose path ──────────────────────────────────────────┐
│                                                        │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ New Project   │    │ Existing     │                  │
│  │               │    │ Sheet        │                  │
│  └──────────────┘    └──────────────┘                  │
│                                                        │
│  (Recent projects shown here if any exist)             │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Actions:**
- [New Project] → show Template Picker (section 6)
- [Existing Sheet] → show Sheet Selector (section 5)

### 3.6 WelcomeGate Requirements

```
REQ-WG-1: GIVEN first visit (no auth, no URL params)
          WHEN app loads
          THEN First Visit Welcome (3.2) renders
          AND [Try the demo] and [Sign in with Google] are shown
          AND value props are visible without scrolling
          AND Gantt chart is NOT rendered

REQ-WG-2: GIVEN return visit (auth in localStorage, recent sheets exist, no URL params)
          WHEN app loads
          THEN Return Visitor Welcome (3.3) renders with "Welcome back, {name}"
          AND recent projects listed with titles and relative times
          AND clicking a recent project sets ?sheet=ID&room=ID and loads immediately

REQ-WG-3: GIVEN ?sheet= or ?room= in URL and user is NOT signed in
          WHEN app loads
          THEN Collaborator Welcome (3.4) renders
          AND only [Sign in with Google] is offered
          AND after sign-in, loadFromSheet() runs automatically (no intermediate screen)

REQ-WG-4: GIVEN ?sheet= in URL and user IS already signed in
          WHEN app loads
          THEN WelcomeGate is skipped entirely
          AND dataSource set to 'loading', loadFromSheet() runs immediately

REQ-WG-5: GIVEN user signs in from First Visit Welcome (no URL params)
          WHEN sign-in completes
          THEN Choose Path (3.5) renders with [New Project] and [Existing Sheet]
          AND if recent sheets exist, they are shown
          AND user is NOT dropped into sandbox
```

---

## 4. Sandbox Mode

### 4.1 Entry

User clicks "Try the demo" or [Demo] on any WelcomeGate screen.

### 4.2 Behavior

- `dataSource = 'sandbox'`
- `fakeTasks` loaded via lazy import from `src/data/templates/softwareRelease.ts`
- Persistent banner at top of Gantt chart:
  *"You're exploring a demo project. Nothing is saved. [Save to Google Sheet]"*
- All edits use `localDispatch` (React state only, no Yjs)
- `scheduleSave()` is a no-op
- No WebSocket connection opened
- User CAN sign in while in sandbox (to browse sheets later) — this does NOT change
  `dataSource` or trigger any writes

### 4.3 Dirty Tracking

- `sandboxDirty` flag set to `true` on first `TASK_MODIFYING_ACTION` dispatch
- If `sandboxDirty === true` and user tries to close/navigate away → `beforeunload`
  event triggers (browser shows generic warning — custom text is ignored)
- If `sandboxDirty === false` → no warning

### 4.4 Promotion Flow (Sandbox → Sheet)

User clicks [Save to Google Sheet] in the sandbox banner.

**Step 1**: If not signed in → Google OAuth sign-in first.

**Step 2**: Choose destination:
```
Save your project:

  ○ Create a new Google Sheet (recommended)
  ○ Save to an existing sheet

Project name: [Q2 Product Launch    ]

[Save]
```

**Step 3**: If "existing sheet" → open Sheet Selector (section 5). Then:

| Target sheet state | Behavior |
|---|---|
| Empty (no data) | Write current tasks directly. No prompt. |
| Has Ganttlet-format data (headers match) | Ask: "This sheet has N existing tasks. Replace them with your current project, or open the existing data instead?" |
| Has non-Ganttlet data (headers don't match) | Warn: "This sheet has data that isn't in Ganttlet format. Creating a new sheet is recommended." Primary: [Create New Sheet]. Secondary: "Overwrite anyway". |

**Step 4**: Write tasks to sheet, update URL, transition state:

```
1. Write current tasks to sheet (before enabling auto-save)
2. Update URL to ?sheet=ID&room=ID
3. Initialize sync (polling + auto-save), set lastWriteHash to prevent double-write
4. Set dataSource='sheet' — this enables auto-save and triggers Yjs connection
5. Yjs connects automatically (useEffect watches URL params + auth)
```

**Step 5**: Banner disappears. User is now in connected mode.

### 4.5 Promotion Requirements

```
REQ-PROMO-1: GIVEN dataSource='sandbox' and user clicks [Save to Google Sheet]
             WHEN they are not signed in
             THEN Google OAuth sign-in is triggered first
             AND after sign-in, the save destination picker shows

REQ-PROMO-2: GIVEN user chooses "Create a new Google Sheet" and enters name "My Project"
             WHEN they click [Save]
             THEN a new sheet titled "My Project" is created via Sheets API
             AND current sandbox tasks are written to the sheet
             AND URL updates to ?sheet=ID&room=ID
             AND dataSource transitions to 'sheet'
             AND sandbox banner disappears
             AND auto-save, polling, and Yjs activate

REQ-PROMO-3: GIVEN user chooses "Save to an existing sheet" and selects an empty sheet
             WHEN the sheet is verified as empty
             THEN current sandbox tasks are written directly (no confirmation prompt)
             AND dataSource transitions to 'sheet'

REQ-PROMO-4: GIVEN user selects an existing sheet with Ganttlet-format data (12 tasks)
             WHEN the sheet headers match SHEET_COLUMNS
             THEN a prompt asks: "This sheet has 12 existing tasks. Replace them with
             your current project, or open the existing data instead?"
             AND "Replace" writes sandbox tasks, "Open existing" loads sheet data

REQ-PROMO-5: GIVEN user selects an existing sheet with non-Ganttlet data
             WHEN headers don't match SHEET_COLUMNS
             THEN a warning shows: "This sheet has data that isn't in Ganttlet format.
             Creating a new sheet is recommended."
             AND primary CTA is [Create New Sheet]
             AND secondary option is "Overwrite anyway"

REQ-PROMO-6: GIVEN promotion completes successfully
             WHEN dataSource transitions to 'sheet'
             THEN all edits made during sandbox (new tasks, deleted tasks, moved tasks,
             changed dependencies) are preserved in the written data
             AND sandboxDirty is reset to false
```

---

## 5. Sheet Selector

A modal for browsing and connecting to Google Sheets. Used by: Journey 2 (recent
project), Journey 3 (new project), Journey 4 (existing sheet), Journey 6 (promotion).

### 5.1 Layout

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

### 5.2 Data Sources

**Drive API listing** (top section):
- `GET drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&trashed=false`
- Uses existing `drive.metadata.readonly` scope — no new permissions
- Fields: `id, name, modifiedTime, iconLink`
- Sorted by `modifiedTime desc`, max 20 results
- Note: this lists ALL spreadsheets the user can access (including shared), which may
  be noisy for users with many shared sheets

**URL paste** (bottom section):
- Regex to extract spreadsheet ID from Google Sheets URLs
- Pattern: `docs.google.com/spreadsheets/d/{ID}/...`
- If ID cannot be extracted → inline error: "Couldn't find a spreadsheet ID in this URL"

### 5.3 Recent Sheets List (localStorage)

Stored under key `ganttlet-recent-sheets`:

```typescript
type RecentSheet = { sheetId: string; title: string; lastOpened: number };
// Array<RecentSheet>, max 10 entries, LRU eviction
```

| Event | Action |
|---|---|
| Successful sheet connection (load completes) | Add/update entry, set `lastOpened = Date.now()` |
| List exceeds 10 entries | Drop entry with oldest `lastOpened` |
| Sheet returns 403/404 | Remove entry from list |
| User clears browser data / incognito | List is empty (no server fallback) |

**Limitation**: localStorage is per-browser, not per-account. This is a convenience
feature, not a reliable record.

### 5.4 Connection Flow

After user selects/pastes a sheet:
1. Set `?sheet=ID&room=ID` in URL
2. Set `dataSource = 'loading'`
3. `loadFromSheet()` runs → validates headers → loads tasks or shows error
4. Add to recent sheets list on success

### 5.5 Requirements

```
REQ-SS-1: GIVEN user is signed in and opens the sheet selector
          WHEN the modal renders
          THEN it lists up to 20 recent Google spreadsheets from Drive API
          AND shows a text input for pasting a Google Sheets URL

REQ-SS-2: GIVEN user pastes "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0"
          WHEN the URL is parsed
          THEN spreadsheet ID "ABC123" is extracted
          AND the [Connect] button becomes enabled

REQ-SS-3: GIVEN user pastes "https://example.com/not-a-sheet"
          WHEN the URL is parsed
          THEN inline error shows: "Couldn't find a spreadsheet ID in this URL"
          AND the [Connect] button remains disabled

REQ-SS-4: GIVEN user clicks [Connect] on a valid sheet
          WHEN the connection succeeds
          THEN the sheet is added to the recent sheets list
          AND the URL updates to ?sheet=ID&room=ID

REQ-SS-5: GIVEN recent sheets list has 10 entries
          WHEN a new sheet is connected
          THEN the entry with the oldest lastOpened is removed
          AND the new entry is added
```

---

## 6. Template Picker & Project Creation

### 6.1 Templates

| Template | Description | Tasks | Source |
|---|---|---|---|
| **Blank** | Header row only | 0 | Generated from `SHEET_COLUMNS` |
| **Software Release** | Plan → Develop → Test → Launch | ~12 | Refactored from current `fakeData.ts` |
| **Marketing Campaign** | Strategy → Content → Launch → Analysis | ~10 | New static data |
| **Event Planning** | Logistics → Promotion → Execution → Post-event | ~10 | New static data |

Templates stored as static TypeScript in `src/data/templates/`:
- `softwareRelease.ts` (refactored from `fakeData.ts`)
- `marketingCampaign.ts`
- `eventPlanning.ts`

### 6.2 Template Data Constraints

Every template must satisfy:
- Every task has: `id`, `name`, `startDate`, `endDate`, `duration`
- No task starts or ends on a weekend (Saturday or Sunday)
- `duration === taskDuration(startDate, endDate)` for every task (inclusive convention)
- `parentId` ↔ `childIds` relationships are consistent
- `id` values are valid UUIDs
- Templates do NOT include UI state fields (`isExpanded`, `isHidden`, etc.)

### 6.3 Creation Flow

1. User selects a template and enters a project name
2. App calls `POST /v4/spreadsheets` with the project name as sheet title
   (uses existing `spreadsheets` scope — sheet lands in Drive root)
3. App writes header row (`SHEET_COLUMNS`) + template task rows to the new sheet
   (write range derived from `SHEET_COLUMNS.length`, not hardcoded)
4. URL updates to `?sheet=ID&room=ID`
5. For non-blank templates: `dataSource = 'sheet'`, auto-save enabled
6. For blank template: `dataSource = 'empty'`, empty state UI shown

### 6.4 Public Google Sheet Template

In addition to in-app templates, publish a public Google Sheet with the correct
20-column header and a few example rows. Serves Journey 8 (sheets-first users).

- Users click "Use Template" in Google Sheets → get a copy in their Drive
- The template ID goes into `?sheet=` URL
- Doubles as documentation of the expected column format

### 6.5 Requirements

```
REQ-TP-1: GIVEN user selects "Software Release" and enters name "My Project"
          WHEN they click [Create]
          THEN a new Google Sheet titled "My Project" is created via Sheets API
          AND row 1 contains all 20 SHEET_COLUMNS as headers
          AND rows 2+ contain the Software Release template tasks
          AND URL updates to ?sheet=ID&room=ID
          AND dataSource transitions to 'sheet'

REQ-TP-2: GIVEN user selects "Blank"
          WHEN the sheet is created
          THEN only the header row is written
          AND dataSource is set to 'empty'
          AND the empty state UI renders (section 7)

REQ-TP-3: GIVEN the Software Release template data
          WHEN validated at build time or in tests
          THEN every task has id, name, startDate, endDate, duration
          AND no task starts or ends on a weekend
          AND duration === taskDuration(startDate, endDate) for all tasks
          AND childIds ↔ parentId relationships are bidirectionally consistent
```

---

## 7. Empty State

### 7.1 When it appears

`dataSource = 'empty'` — the connected sheet exists but has no task data (either a
blank template or an existing empty sheet).

### 7.2 What it shows

- Timeline panel: grid lines, column headers, today marker (visual scaffolding)
- Table panel: column headers with an add-task input row (name field focused)
- Centered CTA area:
  - Primary: "Add your first task" (points to the input row)
  - Secondary: "Or start from a template" (opens template picker)
- Value prop: *"Changes sync to your Google Sheet in real time"*

### 7.3 Requirements

```
REQ-ES-1: GIVEN dataSource='empty'
          WHEN the layout renders
          THEN the timeline shows grid lines, headers, and today marker
          AND the table shows column headers with an add-task input row
          AND a CTA area shows "Add your first task" and "Or start from a template"
          AND no fake data is visible

REQ-ES-2: GIVEN dataSource='empty' and user types a task name and presses Enter
          WHEN the task is created
          THEN startDate defaults to today (ensured to be a business day)
          AND duration defaults to 1
          AND dataSource transitions to 'sheet'
          AND auto-save writes the task to the Google Sheet

REQ-ES-3: GIVEN dataSource='empty' and user clicks "Or start from a template"
          WHEN the template picker opens and user selects a template
          THEN template tasks are written to the sheet
          AND dataSource transitions to 'sheet'
```

---

## 8. Header Validation

### 8.1 When it runs

Every time `loadFromSheet()` reads data from a sheet, before parsing tasks.

### 8.2 Match Rules

- Read row 1 of the sheet
- Compare each cell against `SHEET_COLUMNS` (20 expected columns)
- **Case-insensitive** comparison (`StartDate` matches `startDate`)
- **Order must match** — columns A through T in the defined order
- **All 20 columns must be present** for a match
- **Extra columns after T** are ignored (forward-compatible)
- **Row 1 completely empty** → treated as empty sheet (`dataSource='empty'`), not a
  mismatch

### 8.3 On Mismatch

Show error UI:

```
This sheet's columns don't match Ganttlet's format.

Expected: id, name, startDate, endDate, duration, ...
Found: Task, Start, End, Assignee, Priority, ...

[Create a new sheet instead]    [Download header template]

Full column mapping is coming in a future update.
```

- `dataSource` stays `'loading'`
- `syncError` is set with type indicating column mismatch
- No tasks are loaded
- [Download header template] → CSV file with one row containing all 20 `SHEET_COLUMNS`

### 8.4 Requirements

```
REQ-HV-1: GIVEN a sheet with all 20 SHEET_COLUMNS in correct order (case may vary)
          WHEN loadFromSheet() reads the data
          THEN headers pass validation and tasks load normally

REQ-HV-2: GIVEN a sheet with headers ["Task","Start","End","Assignee","Priority"]
          WHEN loadFromSheet() reads the data
          THEN column mismatch error is shown
          AND expected vs found columns are displayed
          AND [Create a new sheet instead] and [Download header template] are shown
          AND no tasks are loaded

REQ-HV-3: GIVEN a sheet with headers ["ID","Name","StartDate"] (3 of 20, case differs)
          WHEN headers are compared
          THEN case-insensitive match passes for those 3
          BUT only 3 of 20 required columns are present → mismatch

REQ-HV-4: GIVEN a sheet with row 1 completely empty
          WHEN loadFromSheet() reads the data
          THEN treated as empty sheet (dataSource='empty'), not a mismatch

REQ-HV-5: GIVEN user clicks [Download header template]
          THEN a CSV file downloads containing one row with all 20 SHEET_COLUMNS
```

---

## 9. Sheet Management & Share Links

### 9.1 Header Bar (Connected Mode)

When `dataSource='sheet'` and user is signed in, the header shows:

- **Sheet title** — fetched via `GET /v4/spreadsheets/{id}` (fields: `properties.title`).
  Clickable → opens sheet in Google Sheets (new tab).
- **Share button** — copies URL to clipboard. If `?room=` is missing, adds it (using
  sheet ID as room ID). Toast: *"Link copied. Anyone with access to the Google Sheet can
  collaborate."*
- **Dropdown menu** on sheet title:
  - "Open in Google Sheets" → new tab
  - "Switch sheet" → Sheet Selector (section 5)
  - "Create new project" → Template Picker (section 6)
  - "Disconnect" → clears URL params, unmounts GanttApp, shows WelcomeGate

### 9.2 Sandbox Banner

When `dataSource='sandbox'`, a persistent banner at the top of the Gantt chart:
*"You're exploring a demo project. Nothing is saved. [Save to Google Sheet]"*

### 9.3 Requirements

```
REQ-SM-1: GIVEN dataSource='sheet' and user is signed in
          WHEN the header renders
          THEN the sheet title is shown, clickable to open in Google Sheets
          AND a Share button is visible

REQ-SM-2: GIVEN user clicks [Share] and URL has ?sheet=ABC but no ?room=
          WHEN the share action runs
          THEN ?room=ABC is added to the URL
          AND the full URL is copied to clipboard
          AND toast shows: "Link copied. Anyone with access to the Google Sheet
          can collaborate."

REQ-SM-3: GIVEN user clicks "Disconnect"
          WHEN confirmed
          THEN ?sheet= and ?room= are removed from URL
          AND auto-save and polling stop
          AND Yjs disconnects
          AND WelcomeGate renders (return visitor variant, auth persists)

REQ-SM-4: GIVEN user clicks "Switch sheet"
          WHEN Sheet Selector opens and user picks a new sheet
          THEN the current sheet is disconnected (polling, auto-save, Yjs stop)
          AND the new sheet loads (full connection cycle)
```

---

## 10. Error Handling

### 10.1 Error Discrimination

`loadFromSheet()` must be changed to **throw on HTTP errors** instead of returning `[]`.
Error discrimination happens in the GanttContext catch block:

| HTTP Status | `syncError.type` | Retryable? |
|---|---|---|
| 401 | `auth` | Yes — after re-authorization |
| 403 | `forbidden` | No — permission issue |
| 404 | `not_found` | No — sheet deleted |
| 429 | `rate_limit` | Yes — automatic (retryWithBackoff handles it) |
| Network failure | `network` | Yes — automatic on reconnect |

### 10.2 Error UI Patterns

| Error type | UI element | Persistence | Dismissal |
|---|---|---|---|
| `auth` | Banner (top of page) | Until re-auth | User clicks [Re-authorize] → success |
| `forbidden` | Banner | Until user navigates away | [Open another sheet] |
| `not_found` | Banner | Until user navigates away | [Open another sheet]. Sheet removed from recent list. |
| `rate_limit` | Sync status indicator | Until sync succeeds | Automatic. Shows "Sync paused — retrying." |
| `network` | Banner | Until back online | Automatic. Detected via `navigator.onLine`. |

**Critical rule**: `syncError` is set **once per error sequence**. If `retryWithBackoff`
makes 5 attempts, the UI shows one persistent indicator — not 5 toasts.

### 10.3 Polling Backoff

Current behavior: polls every 30s regardless of errors.

New behavior:
- On polling error: increment consecutive error counter
- After 3 consecutive errors: double the interval (60s → 120s → max 300s)
- On successful poll: reset to 30s and clear error counter

### 10.4 Offline Detection

- Listen for `online`/`offline` events on `window`
- On `offline`: set `syncError = { type: 'network', ... }`
- On `online`: clear `syncError`, run immediate sync cycle

### 10.5 Conflict Detection (Future Enhancement)

When polling detects that the sheet was modified externally (by another user editing
directly in Google Sheets) AND the local user also has unsaved changes:

- **Source tracking**: Tag writes with a `_ganttlet_last_modified` cell (e.g., `U1`)
  containing a timestamp. On poll, compare the cell's value to the last write timestamp.
- **Conflict warning**: If the sheet's `_ganttlet_last_modified` doesn't match what we
  last wrote, and the user has local pending changes, show a merge confirmation dialog
  instead of silently overwriting.
- **Scope**: This is a future enhancement. Initial implementation does not include
  conflict detection — the existing `MERGE_EXTERNAL_TASKS` action handles most cases,
  but concurrent edits to the same task can still be lost.

### 10.6 Local Editing During Errors

**Local editing must NEVER be blocked by sync errors.** Regardless of `syncError` state:
- Task drags succeed (state updates, chart re-renders)
- Field edits succeed
- Task creation/deletion succeeds
- All changes are held in `state.tasks` (always current)
- When error resolves, `scheduleSave()` writes the current full `state.tasks`
  (no explicit change queue needed — the debounced full-state write handles recovery)

### 10.7 Requirements

```
REQ-EH-1: GIVEN dataSource='sheet' and save gets 429
          WHEN retryWithBackoff begins
          THEN syncError is set (once, not per retry)
          AND sync indicator shows "Sync paused — retrying automatically"
          AND when save succeeds, syncError clears and indicator shows "Synced"

REQ-EH-2: GIVEN dataSource='sheet' and polling gets 404
          WHEN error is caught
          THEN syncError is set to { type: 'not_found' }
          AND polling STOPS
          AND banner: "Can't access this sheet. It may have been deleted."
          AND sheet removed from recent sheets list
          AND [Open another sheet] button shown

REQ-EH-3: GIVEN OAuth token expires and API returns 401
          THEN syncError is set to { type: 'auth' }
          AND banner: "Session expired. [Re-authorize] to keep syncing."
          AND local editing continues
          AND on re-auth success: syncError clears, scheduleSave() runs

REQ-EH-4: GIVEN navigator.onLine transitions to false
          THEN syncError is set to { type: 'network' }
          AND banner: "You're offline. Changes saved locally."
          AND on reconnect: syncError clears, sync cycle runs immediately

REQ-EH-5: GIVEN 3 consecutive polling errors
          THEN polling interval doubles (max 300s)
          AND on next success, interval resets to 30s

REQ-EH-6: GIVEN syncError is set (any type) and user edits a task
          THEN the edit succeeds locally
          AND when error resolves, full state.tasks is written to sheet
```

---

## 11. Decouple Fake Data

### 11.1 Current State

```typescript
// GanttContext.tsx:22-23 — ALWAYS loads fake data
const initialState: GanttState = {
  tasks: fakeTasks,
  changeHistory: fakeChangeHistory,
};
```

### 11.2 Target State

```typescript
const initialState: GanttState = {
  tasks: [],
  changeHistory: [],
  dataSource: 'loading',  // overridden by WelcomeGate or URL detection
  syncError: null,
  sandboxDirty: false,
};
```

### 11.3 Changes

- `src/data/fakeData.ts` → `src/data/templates/softwareRelease.ts`
- `fakeTasks` imported lazily, only when `dataSource` is set to `'sandbox'`
- `fakeChangeHistory` removed or moved to template
- `initialState.tasks` is always `[]` — populated by routing decision
- Auto-save gated on `dataSource === 'sheet'`
- Yjs hydration gated: never hydrate from fake data

### 11.4 Requirements

```
REQ-FD-1: GIVEN app loads with ?sheet=
          THEN fakeData / softwareRelease template is NOT imported
          AND initialState.tasks is []

REQ-FD-2: GIVEN user enters sandbox mode
          THEN fakeTasks are lazy-imported from templates/softwareRelease.ts
          AND scheduleSave() is never called

REQ-FD-3: GIVEN dataSource='sandbox' and Yjs connection is attempted
          THEN connection is blocked (dataSource check)
          AND no WebSocket opens

REQ-FD-4: GIVEN dataSource='sheet' and state.tasks changes
          THEN scheduleSave() fires (auto-save active)

REQ-FD-5: GIVEN dataSource='empty' and user creates first task
          THEN dataSource transitions to 'sheet'
          AND scheduleSave() fires

REQ-FD-6: GIVEN sandboxDirty is true and user closes tab
          THEN beforeunload dialog is triggered

REQ-FD-7: GIVEN sandboxDirty is false and user closes tab
          THEN no beforeunload dialog
```

---

## 12. Sheets-First User (Journey 8)

### 12.1 Level 1 — Template + Documentation (no code)

- Publish a public Google Sheet with correct 20-column header + example rows
- Document `ganttlet.app/?sheet=SHEET_ID` URL pattern
- Template doubles as format documentation
- Users: "Use Template" in Google Sheets → copy to their Drive → paste ID in URL

### 12.2 Level 2 — "Prepare My Sheet" (future, medium effort)

When header validation fails (section 8), offer: "Add Ganttlet headers to this sheet?"
- Inserts 20-column header into a new tab named `Ganttlet` (original data untouched)
- **Caveat**: codebase hardcodes `DATA_RANGE = 'Sheet1'` in `sheetsSync.ts`. Supporting
  a different tab name touches every sync path (read, write, poll, clear). Medium effort,
  not small.

### 12.3 Level 3 — Google Sheets Add-on (future, separate project)

- Workspace add-on: Extensions → Ganttlet → "Open as Gantt Chart"
- Requires Apps Script + Marketplace publishing — separate project scope

---

## 13. OAuth & Scopes

### 13.1 Current Scopes (no changes needed for initial implementation)

| Scope | Tier | Used For |
|---|---|---|
| `spreadsheets` | Sensitive | Read/write sheet data, create new sheets |
| `drive.metadata.readonly` | Recommended | List user's sheets in selector |
| `userinfo.email` | Recommended | Display user email |
| `userinfo.profile` | Recommended | Display user name/avatar |

### 13.2 Future Scope (for Google Picker / folder placement)

| Scope | Tier | Used For |
|---|---|---|
| `drive.file` | **Restricted** | Browse Drive via Picker, move sheets to folders |

- Requested via incremental authorization only when user clicks "Browse Drive"
- `drive.file` is **restricted** tier — requires security assessment during verification
- Since we already require verification for `spreadsheets` (sensitive), this extends the
  existing requirement rather than introducing a new one

### 13.3 Sheet Creation

```typescript
// Works with current scopes — creates in Drive root (My Drive)
POST https://sheets.googleapis.com/v4/spreadsheets
{ properties: { title: "Project Name" }, sheets: [{ properties: { title: "Sheet1" } }] }
// Returns: { spreadsheetId: "..." }
```

No folder placement possible without `drive.file`. Users can move sheets in Drive.

---

## 14. Implementation Order

Dependency-driven, not rigid phases:

| Order | What | PRD Sections | Depends on | Journeys |
|---|---|---|---|---|
| 0 | Write range fix (issue #62) | — | Nothing | All |
| 1 | Decouple fake data + dataSource state machine + WelcomeGate | §2, §3, §4, §11 (REQ-SM-STATE-*, REQ-WG-*, REQ-FD-*) | #62 | All |
| 2 | Onboarding flows + sheet selector + empty state | §3, §5, §7 (REQ-WG-*, REQ-SS-*, REQ-ES-*) | Order 1 | 1, 2, 3, 4, 5 |
| 3 | Header validation (Tier 1) | §8 (REQ-HV-*) | Order 1 | 4, 8 |
| 4 | Templates + sheet management + share links | §6, §9 (REQ-TP-*, REQ-SM-*) | Order 2 | 2, 3, 8 |
| 5 | Error handling (can ship incrementally) | §10 (REQ-EH-*) | Order 1 | 7 |
| 6 | Sandbox promotion flow | §4.4 (REQ-PROMO-*) | Order 2 | 6 |
| 7 | Sheets-first template + docs (no code) | §12.1 | Nothing | 8 |
| 8 | Column mapping UI (Tier 2, separate effort) | §8 (future) | Order 3 | 4, 8 |

---

## 15. Files to Create or Modify

| File | Change |
|---|---|
| `src/types/index.ts` | Add `dataSource`, `syncError`, `sandboxDirty` to `GanttState` |
| `src/state/ganttReducer.ts` | Add `SET_DATA_SOURCE`, `SET_SYNC_ERROR` cases. Set `sandboxDirty` on task-modifying actions when sandbox. |
| `src/state/GanttContext.tsx` | Empty initial state. `dataSource`-based save gating. Error discrimination in `loadFromSheet` catch. `beforeunload` listener. |
| `src/state/actions.ts` | Add new action types |
| `src/sheets/sheetsSync.ts` | `loadFromSheet()` throws on HTTP errors. `scheduleSave()` checks `dataSource`. Polling backoff. |
| `src/sheets/sheetsMapper.ts` | Export header validation function |
| `src/components/layout/Header.tsx` | Sheet title, share button, sandbox banner, dropdown menu |
| `src/data/fakeData.ts` | Move to `src/data/templates/softwareRelease.ts` |
| **New**: `src/components/onboarding/WelcomeGate.tsx` | Routing layer component |
| **New**: `src/components/onboarding/WelcomeScreen.tsx` | First visit / return visit / collaborator variants |
| **New**: `src/components/onboarding/TemplatePicker.tsx` | Template selection UI |
| **New**: `src/components/onboarding/EmptyState.tsx` | Empty sheet CTA UI |
| **New**: `src/components/onboarding/SheetSelector.tsx` | Sheet browser modal |
| **New**: `src/components/onboarding/ErrorBanner.tsx` | Sync error banners |
| **New**: `src/sheets/sheetsBrowser.ts` | Drive API file listing |
| **New**: `src/data/templates/marketingCampaign.ts` | Template data |
| **New**: `src/data/templates/eventPlanning.ts` | Template data |
| **New**: `src/data/templates/index.ts` | Template registry/exports |

---

## 16. Open Questions

1. **Template ownership**: Static JSON in bundle AND published Google Sheet? (Recommended: both)
2. **Column mapping complexity**: How many mapping variations do real users need?
3. **Multi-sheet projects**: One sheet = one project, or tabs within a session?

---

## 17. Known Limitations

1. **localStorage for recent sheets**: Per-browser, not per-account. Lost in incognito or
   on device switch. No server-side state (architecture constraint).
2. **New sheets land in Drive root**: No folder placement without `drive.file` scope.
   Users can move sheets in Drive manually.
3. **`beforeunload` messages**: Modern browsers ignore custom text and show generic dialog.
4. **Drive listing may be noisy**: Shows all accessible spreadsheets including shared ones.
   No filtering by ownership in initial implementation.
5. **`DATA_RANGE = 'Sheet1'` is hardcoded**: Supporting different tab names (Journey 8
   Level 2) requires changes across the entire sync layer.
6. **Concurrent edit conflicts during promotion**: Writing sandbox data to a sheet that
   another user is actively editing will overwrite their changes silently. Noted as a
   known limitation — not addressed in initial implementation.
