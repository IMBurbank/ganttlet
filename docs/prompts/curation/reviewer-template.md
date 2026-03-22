---
description: "Skill reviewer — {ANGLE} angle for {SKILL}"
skip-plan-mode: true
---

Review angle: {ANGLE}

Target skill: .claude/skills/{SKILL}/SKILL.md

Feedback reports:
Run `find docs/prompts/curation/feedback -maxdepth 1 -name "*.md" | sort | head -20`

Other skills (for cross-skill context):
Run `ls .claude/skills/*/SKILL.md`
