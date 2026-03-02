You are merging Phase 9 Groups A, B, and C into main for the Ganttlet project.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all steps.

Steps:
1. From /workspace (main branch):
   git merge feature/phase9-ux-polish --no-ff -m "Merge feature/phase9-ux-polish: share button, remove fake presence icons"
   git merge feature/phase9-cascade-fix --no-ff -m "Merge feature/phase9-cascade-fix: cascade on duration/end-date changes"
   git merge feature/phase9-deploy-hardening --no-ff -m "Merge feature/phase9-deploy-hardening: Go frontend server, hyper HTTP client, IAP, Cloud Armor"

2. Resolve any merge conflicts (there should be none — groups have zero file overlap).

3. Verify:
   npx tsc --noEmit
   npm run test
   cd server && cargo check

4. If all pass, clean up worktrees:
   git worktree remove /workspace/.claude/worktrees/phase9-groupA
   git worktree remove /workspace/.claude/worktrees/phase9-groupB
   git worktree remove /workspace/.claude/worktrees/phase9-groupC
   git branch -d feature/phase9-ux-polish feature/phase9-cascade-fix feature/phase9-deploy-hardening

5. Report results.
