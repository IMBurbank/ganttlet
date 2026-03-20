---
date: 2026-03-20
agent: agent/instruction-tiers
task: "Curate curation skill (target: curation)"
commits:
  first: b9ae081
  last: b9ae081
---

observations:
  - type: threshold_calibration
    summary: "Threshold evaluation for curation skill"
    evidence: |
      total_findings: 5
      scored_below_threshold:
        count: 5
        real_issues: 2
        examples:
          - "Note paragraph placement between subsections (~40) — content correct, recently added deliberately in 3fbb88b"
          - "moves processed feedback reports omits 20-report cap (~50) — imprecision acceptable, cap enforced in curator prompt"
          - "LL sections in issue-workflow and multi-agent-orchestration pending cleanup (~50) — real gap, but belongs to those skills' curators"
      scored_above_threshold:
        count: 0
        false_positives: 0
        examples: []
      recommendation: "keep at 70"
    files: ["docs/prompts/curation/threshold.txt"]

  - type: undocumented_behavior
    summary: "When Agent tool is unavailable (no deferred tool match), curator must self-conduct all 5 reviewer angles"
    evidence: "Agent tool was not in available deferred tools during this curation pass. The curator prompt (step 2) requires 'subagent_type: skill-reviewer' which is only available via Agent tool. Without it, the curator conducts all angles directly. This fallback is not documented anywhere in the curation skill or curator prompt."
    files: [".claude/skills/curation/SKILL.md", "docs/prompts/curation/curator.md"]

  - type: workflow_gap
    summary: "The curator prompt step 2 references 'subagent_type: skill-reviewer' but Agent tool availability is environment-dependent"
    evidence: "ToolSearch query 'select:Agent' returned 'No matching deferred tools found'. The curator prompt has no fallback instruction for when Agent tool is unavailable. In practice, the curator can self-review all 5 angles but loses the benefit of independent parallel review."
    files: ["docs/prompts/curation/curator.md", ".claude/agents/skill-reviewer.md"]
