# Completed Phases & Architecture Details

This file preserves detailed design notes from Phases 0-4 for reference.
See [CLAUDE.md](/CLAUDE.md) for the active project guide.

---

## Core Features (Planned)
- **Interactive Gantt chart**: Drag to reschedule, resize to change duration, in-browser
- **Dependency management**: FS, FF, SS link types with lag/lead (SF dropped — too rare to justify complexity)
- **Critical Path Method (CPM)**: Auto-calculate early/late start/finish, total/free float
- **Cascade updates**: When a task date changes, all dependent tasks auto-update
- **Two-way Google Sheets sync**: Edit in Sheets or in the app; changes flow both directions
- **Real-time collaboration**: See other users' cursors and edits in near real-time (like Google Sheets)
- **WBS (Work Breakdown Structure)**: Hierarchical task grouping with summary tasks
- **Milestones**: Zero-duration markers for key dates
- **Resource assignment**: Basic resource tracking (stretch goal)

---

## Architecture Details

### Real-Time Collaboration
- Uses Yjs (browser) and Yrs (server) for CRDT-based real-time sync
- One Yrs document per room (room = Google Sheet ID)
- Fast path: User edit → Yjs update → WebSocket → relay → other clients (milliseconds)
- Slow path: Client debounces Yjs changes → writes to Google Sheets API (seconds)
- Yjs awareness protocol handles cursor/presence — ephemeral, never persisted

### Auth & Permissions
- Google OAuth2 provides identity (no separate user database)
- Google Drive sharing permissions are the ACL:
  - Sheet owner/editor → can edit in Ganttlet (writer role)
  - Sheet viewer → can view the live Gantt chart (reader role)
  - No access → connection refused
- Client sends Google access token on WebSocket connect
- Server validates token with Google, checks Drive permissions, assigns role
- Server never stores tokens — validates per connection

### Google Sheets Sync
- Client-side only — the server never reads or writes Sheets
- Each client reads/writes the Sheet using the user's own OAuth token
- Clients poll for external Sheet changes on a periodic interval (~30s)
- Google Sheets is the persistence layer — if the server goes down, no data is lost
- Google Sheets version history provides audit trail for free

### Deployment Model
- Same server binary for public and enterprise deployments, different config
- Enterprise (e.g., Google): runs inside corporate VPC, behind corporate auth, no data leaves the perimeter
- Public: hosted instance with standard Google OAuth
- Server config: bind address, allowed origins, Google OAuth client ID — nothing else

---

## Phase 0: Promote ui-demo-2 to root — DONE
- Copied ui-demo-2 src/, config files to workspace root
- Removed ui-demo-1/, ui-demo-2/, ui-demo-3/
- Package renamed to "ganttlet"

## Phase 1: Bug Fixes — DONE
- **1A**: Fix cascade/drag bug in TaskBar (incorrect delta on mouseUp)
- **1B**: Remove SF dependency type, fix CPM forward/backward pass for SS/FF
- **1C**: CPM engine corrections (store dep type in adjacency list)
- **1D**: Add/Delete task CRUD (ADD_TASK, DELETE_TASK actions, context menu, toolbar button)

## Phase 2: Testing Infrastructure — DONE
- Vitest + jsdom setup
- 45 unit tests for criticalPathUtils, dependencyUtils, summaryUtils, dateUtils, ganttReducer

## Phase 3: Google Sheets Integration — DONE
- **3A**: Google OAuth2 (Identity Services, PKCE flow, sign-in/sign-out)
- **3B**: Sheets sync (sheetsClient, sheetsMapper, sheetsSync, debounced write, polling)

## Phase 4: Real-Time Collaboration — DONE
- **4A**: Yjs client (yjsProvider, yjsBinding, awareness protocol)
- **4B**: Relay server (Rust axum + tokio WebSocket, room management, auth)
- **4C**: Integration testing (build + unit tests pass)
