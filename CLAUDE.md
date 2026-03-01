# Ganttlet

## Project Overview
Ganttlet is a free, open-source Gantt chart with real-time collaboration and two-way Google Sheets sync. It aims to provide a full set of project management features -- more comparable to Microsoft Project or Primavera P6 than most available free Gantt chart options that sync to Google Sheets. So far this is all tentative and subject to change.

## Core Features (Planned)
- **Interactive Gantt chart**: Drag to reschedule, resize to change duration, in-browser
- **Dependency management**: FS, FF, SS, SF link types with lag/lead
- **Critical Path Method (CPM)**: Auto-calculate early/late start/finish, total/free float
- **Cascade updates**: When a task date changes, all dependent tasks auto-update
- **Two-way Google Sheets sync**: Edit in Sheets or in the app; changes flow both directions
- **Real-time collaboration**: See other users' cursors and edits in near real-time (like Google Sheets)
- **WBS (Work Breakdown Structure)**: Hierarchical task grouping with summary tasks
- **Milestones**: Zero-duration markers for key dates
- **Resource assignment**: Basic resource tracking (stretch goal)

## Tech Stack
- **Frontend**: React + TypeScript, Vite bundler
- **Gantt rendering**: TBD (evaluate: frappe-gantt, dhtmlxGantt, or custom canvas/SVG)
- **Scheduling engine**: Rust compiled to WebAssembly (runs entirely in-browser)
- **Real-time sync**: Yjs (client) + Yrs (server) — CRDT-based conflict resolution
- **Collaboration server**: Rust (axum + tokio-tungstenite) — thin WebSocket relay, no business logic
- **Google Sheets integration**: Google Sheets API v4, called directly from the browser using OAuth2 client-side flow
- **Auth**: Google OAuth2 — identity and authorization derived from Google Drive sharing permissions
- **Testing**: TBD (Likely Vitest for unit tests, Playwright for E2E)

## Architecture

### Overview
The app has two components: a browser client and a thin relay server.

- **Client**: All business logic runs in the browser — scheduling engine (Rust→WASM), Gantt rendering, and Google Sheets reads/writes (using the user's own OAuth token).
- **Relay server**: A small Rust binary that relays CRDT updates between connected clients over WebSocket. It holds no business logic, stores no data persistently, and makes no outbound calls except to Google APIs for auth validation.

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

## Architecture Principles
- Keep the scheduling engine (CPM calculations, dependency resolution) as a pure Rust→WASM module, separate from UI
- The relay server is stateless (in-memory only) and credential-free — it never touches Google Sheets data
- The Google Sheets sync layer should be its own module, not coupled to the UI
- Prefer small, focused commits on feature branches
- Write tests for scheduling logic first — correctness here is critical

## Development Environment
- Runs in Docker for isolation (see docker-compose.yml)
- Vite dev server on port 5173
- Relay server TBD (will run alongside Vite in dev, separate container in production)
- macOS host, VS Code editor, view in browser at localhost:5173

## Git Workflow
- `main` branch is always deployable
- Work on feature branches: `feature/description`
- Commit often with descriptive messages
- Open PRs for review before merging to main

## Commands
- `npm run dev` — Start Vite dev server
- `npm run test` — Run unit tests
- `npm run build` — Production build
- `docker compose run  --service-ports dev` — Enter the dev container
- `docker exec -it $(docker ps -q) bash` - Enter the dev container from another session
- `claude --dangerously-skip-permissions` - Start claude in container without permissions checks
