---
date: 2026-03-20
agent: agent/instruction-tiers
task: "Curate curation skill (target: curation)"
commits:
  first: 1d46976
  last: 1d46976
---

observations:
  - type: wrong_documentation
    summary: "metrics.csv listed in File Layout but does not exist in repo and no script creates it"
    evidence: "find /workspace/.claude/worktrees/instruction-tiers -name metrics.csv returned empty. grep of all scripts/curate-skills.sh, generate-retry-config.sh, check-curation.sh found no reference to metrics.csv. The skill documents it as 'appended by orchestrator' but the orchestrator is a manually-invoked step with no dedicated prompt. Removed from file layout."
    files: [".claude/skills/curation/SKILL.md", "scripts/curate-skills.sh"]

  - type: undocumented_behavior
    summary: "The curation skill itself is excluded from the automated pipeline — must be curated manually"
    evidence: "docs/prompts/curation/skill-curation.yaml line 35 contains comment '# curation skill added here once self-curation is enabled (future)'. The skill body described '8 curators in parallel' without noting this exclusion, which could mislead agents wondering why the curation skill is never automatically curated."
    files: ["docs/prompts/curation/skill-curation.yaml", ".claude/skills/curation/SKILL.md"]

  - type: undocumented_behavior
    summary: "The 'Orchestrating agent' in the flow diagram is not an automated component — it is the supervisor or human operator invoked after curate-skills.sh exits"
    evidence: "No orchestrator.md or equivalent prompt exists in docs/prompts/curation/. curate-skills.sh line 92 states 'Done. Agent should create PR and run code review.' — confirming this is a post-script manual step. The flow diagram previously labeled it 'Orchestrating agent (judgment)' without clarifying that this is manual. Relabeled to 'Operator/supervisor agent (manually invoked after script completes)'."
    files: ["docs/prompts/curation/curator.md", "scripts/curate-skills.sh", ".claude/skills/curation/SKILL.md"]

  - type: workflow_gap
    summary: "issue-workflow and multi-agent-orchestration skills still have ## Lessons Learned sections marked for curation pipeline cleanup"
    evidence: "issue-workflow/SKILL.md line 84-85: '## Lessons Learned <!-- Managed by curation pipeline — do not edit directly -->'. multi-agent-orchestration/SKILL.md line 147-148: '## Lessons Learned <!-- Managed by curation pipeline — do not edit directly -->'. The curation skill instructs curators to eliminate LL sections and integrate content, but these sections persist with pipeline markers. Not acted on in this pass (out of scope for curation skill curation), but flags a pending cleanup task for those skills."
    files: [".claude/skills/issue-workflow/SKILL.md", ".claude/skills/multi-agent-orchestration/SKILL.md"]

  - type: threshold_calibration
    summary: "Threshold evaluation for curation skill"
    evidence: |
      total_findings: 10
      scored_below_threshold:
        count: 9
        real_issues: 3
        examples:
          - "orchestrating agent framing misleading (60) — real but ambiguous enough to score below threshold; addressed via label change anyway"
          - "8 curators excludes curation skill (50) — real gap; addressed via note addition"
          - "code review protocol has no implementing prompt (40) — false positive; supervisor covers this"
      scored_above_threshold:
        count: 1
        false_positives: 0
        examples:
          - "metrics.csv in file layout but nonexistent (75) — confirmed, removed"
      recommendation: "keep at 70"
    files: ["docs/prompts/curation/threshold.txt"]
