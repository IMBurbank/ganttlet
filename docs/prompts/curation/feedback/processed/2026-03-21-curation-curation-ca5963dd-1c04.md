---
date: 2026-03-21
agent: curation/curation-ca5963dd
task: "Curate the curation skill file"
commits:
  first: 9c6d0b6
  last: 9c6d0b6
---

observations:
  - type: threshold_calibration
    summary: "Threshold evaluation for curation"
    outcome:
      status: acted
      action: "Threshold kept at 70 per recommendation"
      pass: "2026-03-21"
    evidence: |
      total_findings: 13
      scored_below_threshold:
        count: 8
        real_issues: 0
        examples:
          - "What Each Component Does restates flow diagram (25) — different purposes"
          - "Lifecycle bullet run-on (50) — stylistic only"
          - "5 reviewer angles verbose (50) — different audience than subagent"
          - "Overview research citation verbose (50) — provides motivation"
          - "Code Review Protocol duplicated (0) — section doesn't exist"
          - "Debrief filename format wrong (0) — SKILL.md is correct"
          - "skill-curation label missing (25) — misread of diagram text"
          - "Flow diagram perspective shift (25) — intentional design"
      scored_above_threshold:
        count: 5
        false_positives: 0
        examples:
          - "Flow diagram omits early-exit (100) — confirmed in curate-skills.sh:24-25"
          - "File Layout omits lint-agent-paths.sh (100) — confirmed exists + used by validate.md"
          - "No Lessons Learned section (100) — only skill without it"
          - "Report move condition undersold (75) — only moves on stage+merge success"
          - "curation-only.yaml unmentioned (75) — file exists, completely unreferenced"
      recommendation: "keep at 70"
    files: ["docs/prompts/curation/threshold.txt"]

  - type: workflow_gap
    summary: "xxd not available in Docker — debrief filename generation command fails"
    evidence: "debrief-template.md:6 uses xxd -p for random hex suffix but xxd is not installed in the Docker image. Workaround: use openssl rand -hex 2 instead."
    files: ["docs/prompts/curation/debrief-template.md"]
    outcome:
      status: acted
      action: "Replaced xxd with openssl rand -hex 2 in debrief-template.md and curate-skills.sh"
      pass: "2026-03-21"

  - type: undocumented_behavior
    summary: "History reviewer produced truncated output requiring synthesis pass"
    evidence: "The history reviewer (skill-reviewer subagent) ran out of turns investigating git blame/log and did not produce the structured ## Skill Review header. Step 2b synthesis recovered usable findings but the history angle was the weakest — only 2 findings vs 10-20 from other angles. This may be a recurring issue for history reviews on skills with long git histories."
    files: [".claude/agents/skill-reviewer.md"]
    outcome:
      status: preserved
      action: "Step 2b synthesis pass handles truncation. History efficiency improvement deferred."
      pass: "2026-03-21"
