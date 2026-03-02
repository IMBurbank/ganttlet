# Phase 9 Group A — UX Polish

You are implementing Phase 9 Group A for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- src/components/layout/Header.tsx
- src/components/panels/UserPresence.tsx
- src/state/GanttContext.tsx

## Tasks — execute in order:

### A1: Add share button to Header.tsx

Add a "Share" button in the header controls area — after `SyncStatusIndicator`, before the Google sign-in section (around line 38 in the `<div className="flex items-center gap-4">` block).

**Implementation:**
1. Add local state: `const [copied, setCopied] = useState(false);`
2. Add a click handler that copies the current URL:
   ```typescript
   const handleShare = useCallback(() => {
     navigator.clipboard.writeText(window.location.href).then(() => {
       setCopied(true);
       setTimeout(() => setCopied(false), 2000);
     });
   }, []);
   ```
3. Add the button JSX between `<SyncStatusIndicator />` and the Google sign-in section:
   ```tsx
   <button
     onClick={handleShare}
     className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
   >
     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
       <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
       <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
     </svg>
     {copied ? 'Copied!' : 'Share'}
   </button>
   ```
4. Style should match existing header buttons (`text-xs`, `text-text-secondary`, hover patterns).

### A2: Remove fake user presence icons

**In `UserPresence.tsx`:**
- Remove the entire fallback block (lines 48-74) that renders `users` (fake data) when collab is disconnected.
- Instead, return `null` when `!(isCollabConnected && collabUsers.length > 0)`.
- The component should ONLY render real collab users (the first return block, lines 9-45).

**In `GanttContext.tsx`:**
- Line 29: change `users: fakeUsers` to `users: []`
- Line 5: remove `fakeUsers` from the import. Keep `fakeTasks`, `fakeChangeHistory`, `defaultColumns`.

## Verification
After all tasks, run:
```bash
npx tsc --noEmit && npm run test
```
Both must pass. Commit your changes with descriptive messages.
