# Ganttlet

## Project Overview
Ganttlet is a free, open-source, in-browser Gantt chart with two-way Google Sheets sync. It aims to provide project management features comparable to Microsoft Project or Primavera P6 — not just static Gantt bars.

## Core Features (Planned)
- **Interactive Gantt chart**: Drag to reschedule, resize to change duration, in-browser
- **Dependency management**: FS, FF, SS, SF link types with lag/lead
- **Critical Path Method (CPM)**: Auto-calculate early/late start/finish, total/free float
- **Cascade updates**: When a task date changes, all dependent tasks auto-update
- **Two-way Google Sheets sync**: Edit in Sheets or in the app; changes flow both directions
- **WBS (Work Breakdown Structure)**: Hierarchical task grouping with summary tasks
- **Milestones**: Zero-duration markers for key dates
- **Resource assignment**: Basic resource tracking (stretch goal)

## Tech Stack
- **Frontend**: React + TypeScript, Vite bundler
- **Gantt rendering**: TBD (evaluate: frappe-gantt, dhtmlxGantt, or custom canvas/SVG)
- **Backend/API**: Node.js + Express (lightweight, handles Sheets sync)
- **Google Sheets integration**: Google Sheets API v4
- **Testing**: Vitest for unit tests, Playwright for E2E

## Architecture Principles
- Keep the scheduling engine (CPM calculations, dependency resolution) as a pure, well-tested module separate from UI
- The Google Sheets sync layer should be its own module, not coupled to the UI
- Prefer small, focused commits on feature branches
- Write tests for scheduling logic first — correctness here is critical

## Development Environment
- Runs in Docker for isolation (see docker-compose.yml)
- Vite dev server on port 5173, API on port 3000
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
- `docker compose run dev` — Enter the dev container
