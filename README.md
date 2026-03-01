# 🏰 Ganttlet

A free, open-source, in-browser Gantt chart with two-way Google Sheets sync — built to bring real project scheduling power (critical path, dependency cascades, WBS) to everyone.

## Why Ganttlet?

Most free Gantt tools give you colored bars on a timeline. Ganttlet gives you an actual scheduling engine:

- **Dependency-driven scheduling** — Change a task's date and watch all downstream tasks cascade automatically
- **Critical Path Method** — Know which tasks can slip and which ones can't
- **Two-way Google Sheets sync** — Your team edits in Sheets, you edit in the app, everyone stays in sync
- **Finish-to-Start, Start-to-Start, and more** — Real dependency types with lead/lag support

Think Microsoft Project or Primavera P6, but free and in your browser.

## Status

🚧 **Early development** — Not yet usable. Contributions and ideas welcome!

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript |
| Bundler | Vite |
| Backend | Node.js + Express |
| Sheets Sync | Google Sheets API v4 |
| Testing | Vitest + Playwright |

## License

MIT
