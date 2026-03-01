# 🏰 Ganttlet

A free, open-source Gantt chart with real-time collaboration and two-way Google Sheets sync — built to bring real project scheduling power (critical path, dependency cascades, WBS) to everyone.

## Why Ganttlet?

Most free Gantt tools give you colored bars on a timeline. Ganttlet gives you an actual scheduling engine:

- **Dependency-driven scheduling** — Change a task's date and watch all downstream tasks cascade automatically
- **Critical Path Method** — Know which tasks can slip and which ones can't
- **Real-time collaboration** — See other users' cursors and edits live, like Google Sheets
- **Two-way Google Sheets sync** — Your team edits in Sheets, you edit in the app, everyone stays in sync
- **Google Drive permissions** — Sheet editors can edit, viewers can view. No separate accounts.
- **Finish-to-Start, Start-to-Start, and more** — Real dependency types with lead/lag support

Think Microsoft Project or Primavera P6, but free and in your browser.

## Status

Early development — not yet usable. Contributions and ideas welcome!

## Getting Started (Development)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Git](https://git-scm.com/)
- An [Anthropic API key](https://console.anthropic.com/) (if using Claude Code for development)

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/ganttlet.git
cd ganttlet
cp .env.example .env
# Edit .env with your API keys

# Start the dev container
docker compose run dev

# Inside the container:
npm install
npm run dev
# Open http://localhost:5173 in your browser
```

## Architecture

Ganttlet has two components: a browser client (where all business logic runs) and a thin relay server (for real-time collaboration).

| Layer | Technology | Runs in |
|-------|-----------|---------|
| Frontend | React + TypeScript (Vite) | Browser |
| Scheduling Engine | Rust → WebAssembly | Browser |
| Real-Time Sync | Yjs (client) + Yrs (server) | Both |
| Collaboration Server | Rust (axum + WebSocket) | Server |
| Sheets Sync | Google Sheets API v4 (OAuth2) | Browser |
| Auth | Google OAuth2 + Drive permissions | Both |

### How it works

- **All scheduling and rendering** happens in the browser — the server has no business logic
- **Real-time edits** flow between users via CRDT (Yjs/Yrs) over WebSocket through the relay server
- **Google Sheets** is the persistence layer — clients read/write directly using the user's OAuth token
- **Permissions** come from Google Drive — if you can edit the Sheet, you can edit in Ganttlet
- **If the server goes down**, the app still works — you just lose live collaboration until it's back

### Deployment

The relay server is a single Rust binary configured via environment variables. It stores no data, holds no credentials, and makes no outbound calls except to Google APIs for token validation. Same binary works for public hosting and enterprise (on-prem/VPC) deployment.

## License

MIT
