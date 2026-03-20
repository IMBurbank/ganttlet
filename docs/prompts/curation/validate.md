---
scope:
  read: [".claude/skills/*/SKILL.md", "docs/prompts/curation/"]
description: "Post-merge validation for skill curation"
skip-plan-mode: true
---

Validate the skill curation results after merge.

## Checks

1. **Skill files parse correctly.** Read each modified SKILL.md and verify:
   - YAML frontmatter is valid (name, description fields present)
   - Sections are well-formed (## headers, no orphaned content)
   - No `## Lessons Learned` section remains (should have been eliminated by curator)

2. **No broken cross-references.** For any skill body content that references
   other files (source paths, other skills, commands), verify the referenced
   files exist:
   ```bash
   ./scripts/lint-agent-paths.sh
   ```

3. **Net token impact.** Compare total token count of modified skill files
   before and after:
   ```bash
   # For each modified skill, compare current vs main
   for f in $(git diff --name-only origin/main -- .claude/skills/); do
     echo "$f: before=$(git show origin/main:$f 2>/dev/null | wc -c) after=$(wc -c < $f)"
   done
   ```
   Total should be equal or reduced. If increased, flag which skill grew and by how much.

4. **No placeholder markers.** Check for any markers that should have been
   resolved during curation:
   ```bash
   grep -r "<!-- NEW:" .claude/skills/ 2>/dev/null
   grep -r "<!-- DELETED:" .claude/skills/ 2>/dev/null
   # Also check project-structure.md if it exists:
   [ -f docs/project-structure.md ] && grep "<!-- NEW:\|<!-- DELETED:" docs/project-structure.md
   ```

5. **`[reviewed: keep]` content preserved.** Verify that no `[reviewed: keep]`
   tagged content was modified or deleted:
   ```bash
   git diff origin/main -- .claude/skills/ | grep "^-.*\[reviewed: keep\]"
   ```
   Any matches = validation failure.

## Report

Output a validation report:

```
### Curation Validation

| Check | Status |
|---|---|
| Skill files parse | PASS/FAIL |
| Cross-references | PASS/FAIL |
| Net token impact | +N / -N tokens |
| No placeholder markers | PASS/FAIL |
| [reviewed: keep] preserved | PASS/FAIL |

OVERALL: PASS / FAIL

Details:
[any failures or warnings]
```

If OVERALL FAIL, describe the specific failures so the orchestrating agent
or a fix agent can address them.
