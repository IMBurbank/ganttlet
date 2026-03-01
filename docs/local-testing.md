# Local Testing Guide

How to run Ganttlet locally with Google Sheets sync and real-time collaboration.

## Prerequisites

- Node.js 20+
- Docker (for the relay server, unless you have Rust installed locally)
- A Google account

## 1. Google Cloud Console Setup

Go to [console.cloud.google.com](https://console.cloud.google.com).

### Create a project

Create a new project (e.g. `ganttlet-dev`). All resources below live in this project.

### Enable APIs

Go to **APIs & Services > Library** and enable:

- **Google Sheets API**
- **Google Drive API**

### Configure OAuth consent screen

Go to **APIs & Services > OAuth consent screen**:

1. Choose **External** user type
2. Fill in the app name (e.g. "Ganttlet Dev") and your email
3. Add these scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
4. Add your Google email as a **test user** (required while the app is in "Testing" status)

### Create OAuth credentials

Go to **APIs & Services > Credentials**:

1. Click **Create Credentials > OAuth client ID**
2. Application type: **Web application**
3. Authorized JavaScript origins: `http://localhost:5173`
4. Click **Create** and copy the **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`)

## 2. Configure the Frontend

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_COLLAB_URL=ws://localhost:4000
```

## 3. Run the Relay Server

The relay server handles real-time collaboration (Yjs CRDT sync over WebSocket).

### Option A: Docker (recommended if you don't have Rust)

```bash
docker compose up relay
```

This builds the Rust server in a container and exposes it on `localhost:4000`.

### Option B: Cargo (if you have Rust installed)

```bash
cd server
cargo run --release
```

### Option C: Skip it

The relay server is optional. Without it, the app works fine in single-user mode — you just won't get real-time collaboration. Google Sheets sync still works independently.

## 4. Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Copy the spreadsheet ID from the URL:

```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_IS_THIS_PART/edit
```

The sheet can be empty — Ganttlet will populate it with task data on first sync.

## 5. Start the App

```bash
npm install   # first time only
npm run dev
```

Open in your browser:

```
http://localhost:5173/?sheet=SPREADSHEET_ID&room=SPREADSHEET_ID
```

| Parameter | Purpose |
|-----------|---------|
| `sheet`   | Enables two-way Google Sheets sync |
| `room`    | Enables real-time collaboration via relay server |

You can use either or both:

- `?sheet=ID` — Sheets sync only, no collab
- `?room=ID` — Collab only, no Sheets persistence
- `?sheet=ID&room=ID` — Both (use the same ID for both)
- No params — Local-only mode with sample data

## 6. Sign In

Click the **Sign in with Google** button in the top-right corner of the header. This authorizes the app to read/write your Google Sheet.

## 7. Test Real-Time Collaboration

Open the same URL in a second browser tab (or a different browser). Both tabs connect to the same room. You should see:

- Two presence avatars in the header
- Edits in one tab appear in the other in real time
- Both tabs sync to the same Google Sheet

## Troubleshooting

**"Google Identity Services not loaded"**
- Check that `VITE_GOOGLE_CLIENT_ID` is set in `.env`
- Make sure you restarted the dev server after editing `.env`

**Sign-in popup closes with no effect**
- Your email must be listed as a test user in the OAuth consent screen
- Check the browser console for errors

**"No Sheet" in the sync indicator**
- Make sure the `?sheet=` parameter is in the URL
- Make sure you're signed in first

**Relay server connection fails**
- Check that the relay server is running on port 4000
- Check that `VITE_COLLAB_URL=ws://localhost:4000` is in `.env`
- The app falls back to local-only mode gracefully — this isn't a blocker

**Docker build fails for relay server**
- The Rust build can take a few minutes the first time (downloading + compiling dependencies)
- Make sure Docker has enough memory allocated (at least 4 GB)
