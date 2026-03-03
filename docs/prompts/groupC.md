# Phase 10 Group C (Stage 2) — Sheets Sync Hardening + Yjs Hydration

You are implementing Phase 10 Group C (Stage 2) for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- src/sheets/sheetsClient.ts
- src/sheets/sheetsSync.ts
- src/sheets/sheetsMapper.ts
- src/state/GanttContext.tsx
- src/collab/yjsBinding.ts

## Background

The Sheets sync layer has several robustness issues identified in the architecture review:
1. No retry/backoff when API calls fail or hit rate limits
2. Each save does `clearSheet()` then `writeSheet()` — a crash between them leaves an empty sheet
3. Polling replaces all local state with sheet data, overwriting in-progress edits
4. External Sheet changes don't propagate to Yjs, so other collaborators don't see them
5. When the relay server restarts, new clients get an empty Yjs doc instead of Sheets data

## Tasks — execute in order (each builds on the previous):

### C1: Add exponential backoff to Sheets API calls

**File: `src/sheets/sheetsClient.ts`**

Add a generic retry helper at the top of the file:

```typescript
interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 5, initialDelay = 1000, maxDelay = 60000, jitterFactor = 0.2 } = opts;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxAttempts) throw error;

      // Check for Retry-After header on 429 responses
      if (error instanceof Response && error.status === 429) {
        const retryAfter = error.headers.get('Retry-After');
        if (retryAfter) {
          delay = parseInt(retryAfter, 10) * 1000;
        }
      }

      // Add jitter: +/- jitterFactor of current delay
      const jitter = delay * jitterFactor * (2 * Math.random() - 1);
      const waitTime = Math.min(delay + jitter, maxDelay);

      console.warn(`Sheets API attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(waitTime)}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      delay = Math.min(delay * 2, maxDelay);
    }
  }
  throw new Error('Unreachable');
}
```

Then wrap each existing API function. For example, if `readSheet` currently does:
```typescript
const response = await fetch(`https://sheets.googleapis.com/v4/...`);
```
Change to:
```typescript
return retryWithBackoff(async () => {
  const response = await fetch(`https://sheets.googleapis.com/v4/...`);
  if (!response.ok) throw response;  // triggers retry on non-2xx
  return response.json();
});
```

Apply the same pattern to `writeSheet()` and `clearSheet()`. Export `retryWithBackoff` for testing.

**Add a test** in a new file `src/sheets/__tests__/sheetsClient.test.ts`:
- Test that retryWithBackoff retries on failure and eventually succeeds
- Test that it respects maxAttempts and throws after exhausting retries
- Test that delay increases exponentially

### C2: Replace clear-then-write with values.update

**File: `src/sheets/sheetsClient.ts`**

Add a new function `updateSheet()` that uses the Sheets API `values.update` endpoint (PUT method) instead of the two-step clear+write:

```typescript
export async function updateSheet(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<void> {
  const token = await getAccessToken();
  return retryWithBackoff(async () => {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      },
    );
    if (!response.ok) throw response;
  });
}
```

**File: `src/sheets/sheetsSync.ts`**

Change `scheduleSave()` to use `updateSheet()` instead of `clearSheet()` + `writeSheet()`:
- Convert tasks to rows using `tasksToRows()` (from sheetsMapper)
- Include header row
- Call `updateSheet(spreadsheetId, range, allRows)` where range covers the header + all data rows
- This is an atomic single-request write — no race condition

### C3: Merge incoming Sheets data by task ID

**File: `src/sheets/sheetsSync.ts`**

Change the polling callback. Currently it does:
```typescript
dispatch({ type: 'SET_TASKS', tasks: incomingTasks });
```

Replace with a merge strategy:
1. Keep a reference to the last-known Sheets state (already partially there via `lastWriteHash`; extend to store the actual tasks array)
2. On poll, compare incoming tasks to last-known Sheets state by task ID to identify what changed externally
3. Dispatch a new action instead of SET_TASKS:
```typescript
dispatch({
  type: 'MERGE_EXTERNAL_TASKS',
  externalTasks: incomingTasks,
});
```

**File: `src/state/GanttContext.tsx`**

Add the `MERGE_EXTERNAL_TASKS` action to the reducer. The merge logic:
```typescript
case 'MERGE_EXTERNAL_TASKS': {
  const { externalTasks } = action;
  const externalMap = new Map(externalTasks.map(t => [t.id, t]));
  const localMap = new Map(state.tasks.map(t => [t.id, t]));

  // Start with all external tasks (source of truth for additions/deletions)
  const merged = externalTasks.map(ext => {
    const local = localMap.get(ext.id);
    if (!local) return ext;  // New task from sheets
    // If local task was modified since last sync, keep local version
    // Otherwise use external version
    return local;
  });

  return { ...state, tasks: merged };
}
```

Add the action type to the `GanttAction` union type.

**Add a test** for the MERGE_EXTERNAL_TASKS reducer action:
- Test: external task added → appears in merged result
- Test: external task updated, no local changes → external version used
- Test: local task in progress → local version preserved

### C4: Propagate Sheets changes to Yjs

**File: `src/sheets/sheetsSync.ts`**

After detecting external changes in the polling callback (the section you modified in C3), also update the Yjs document so all collaborators see the change:

```typescript
import { applyTasksToYjs } from '../collab/yjsBinding';
import { getDoc } from '../collab/yjsProvider';

// In the polling callback, after dispatching MERGE_EXTERNAL_TASKS:
const doc = getDoc();
if (doc) {
  applyTasksToYjs(doc, incomingTasks);
}
```

Note: `applyTasksToYjs` already exists in `yjsBinding.ts` — it writes a full task array into the Yjs document. The `isLocalUpdate` flag in yjsBinding prevents the observer from echoing these changes back to dispatch.

### C5: Hydrate Yjs from Sheets on initialization

**File: `src/collab/yjsBinding.ts`**

Add a new exported function:

```typescript
export function hydrateYjsFromTasks(doc: Y.Doc, tasks: Task[]): void {
  const yarray = doc.getArray<Y.Map<unknown>>('tasks');
  if (yarray.length > 0) return;  // Already has data, don't overwrite
  applyTasksToYjs(doc, tasks);
}
```

**File: `src/state/GanttContext.tsx`**

Change the initialization order in the useEffect that sets up Sheets + collab. Currently:
1. Init sheets sync
2. Load from sheet → dispatch SET_TASKS
3. Start polling
4. (Separately) Connect collab

Change to:
1. Load from sheet → dispatch SET_TASKS → store tasks in a ref
2. Connect collab (creates Yjs doc)
3. If Yjs array is empty, call `hydrateYjsFromTasks(doc, loadedTasks)`
4. Start polling

This ensures that when a new client joins a room where the relay server was restarted (empty Yjs doc), it gets data from Sheets immediately.

Import `hydrateYjsFromTasks` from `../collab/yjsBinding`.

## Verification
After all tasks, run:
```bash
npx tsc --noEmit && npm run test
```
Both must pass. Add tests for new functionality as specified in each task.
Commit your changes with descriptive messages after each task.
