You are implementing Phase 8 Group C for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

**NOTE**: Group C runs AFTER Groups A and B have been merged to main.
You should be working directly on the main branch, not in a worktree.

## Your files (ONLY modify these):
- playwright.config.ts (new)
- e2e/ (new directory)
- deploy/frontend/ (new directory)
- deploy/README.md (new)
- package.json (add Playwright dependency and e2e script)

## Tasks — execute in order:

### C1: Playwright setup
```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Create `playwright.config.ts`:
- Base URL: `http://localhost:5173`
- Only chromium (speed over coverage at this stage)
- Test dir: `e2e/`
- Web server command: `npx vite --host 0.0.0.0` with port 5173
- Timeout: 30s per test

Add to `package.json` scripts: `"e2e": "playwright test"`

### C2: Critical E2E tests
Create `e2e/gantt.spec.ts` with these tests:

1. **Cell editing works**: navigate to app, double-click a task name cell, type a new name, blur, verify the name changed
2. **Critical path highlights**: enable critical path (find the toggle in toolbar), verify multiple task bars have the critical-path visual indicator (CSS class or style)
3. **Workstream scope doesn't crash**: open scope selector, choose a workstream, verify app is still responsive (page doesn't show error boundary)
4. **Dependency arrows connected**: verify SVG path elements exist in DependencyLayer, check they have reasonable coordinates (not 0,0)

### C3: Frontend deployment (Firebase Hosting)
Create `firebase.json`:
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

Create `deploy/frontend/deploy.sh`:
```bash
#!/bin/bash
set -euo pipefail
npm run build
firebase deploy --only hosting
```

Add environment variable support:
- `VITE_COLLAB_URL`: WebSocket URL for the Cloud Run relay server
- Create `.env.production` with placeholder: `VITE_COLLAB_URL=wss://your-relay-server.run.app`

### C4: Production environment config
Update `deploy/cloudrun/deploy.sh` to set `ALLOWED_ORIGINS` with the Firebase Hosting URL.

Create `deploy/README.md` documenting:
1. Prerequisites (Firebase CLI, gcloud CLI, Google Cloud project)
2. Frontend deployment steps (Firebase Hosting)
3. Relay server deployment steps (Cloud Run — already configured)
4. Environment variables needed
5. OAuth redirect URI configuration (manual step in Google Cloud Console)
6. Full end-to-end deployment pipeline

## Verification
```bash
npx playwright test  # E2E tests pass
npm run build        # production build succeeds
```

Commit your changes with descriptive messages.
