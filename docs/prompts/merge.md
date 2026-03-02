You are merging Phase 8 Groups A and B into main for the Ganttlet project.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation. Execute all steps.

Steps:
1. From /workspace (main branch):
   git merge feature/phase8-table-okr --no-ff -m "Merge feature/phase8-table-okr: fix cell editability, OKR picker, seed data"
   git merge feature/phase8-critpath-cascade --no-ff -m "Merge feature/phase8-critpath-cascade: critical path fixes, cascade shadow trail"

2. Resolve any merge conflicts (there should be none — groups have zero file overlap).

3. Verify:
   npx tsc --noEmit
   npm run test
   cd crates/scheduler && cargo test

4. If all pass, clean up worktrees:
   git worktree remove /workspace/.claude/worktrees/phase8-groupA
   git worktree remove /workspace/.claude/worktrees/phase8-groupB
   git branch -d feature/phase8-table-okr feature/phase8-critpath-cascade

5. Report results.
