#!/usr/bin/env bash
# setup-e2e-ruleset.sh — Create GitHub Ruleset requiring e2e-verified status.
#
# Run once by a repo admin after the e2e.yml workflow changes are merged.
# Creates the ruleset in "evaluate" (dry-run) mode.
#
# To activate after validation:
#   RULESET_ID=$(gh api repos/OWNER/REPO/rulesets --jq '.[] | select(.name == "Require E2E verification") | .id')
#   gh api repos/OWNER/REPO/rulesets/$RULESET_ID --method PUT -f enforcement=active
#
# Requires: gh CLI with admin access to the repo.
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
OWNER=$(echo "$REPO" | cut -d/ -f1)
REPO_NAME=$(echo "$REPO" | cut -d/ -f2)

echo "Creating E2E required status ruleset for $REPO in evaluate mode..."

RESULT=$(gh api "repos/$OWNER/$REPO_NAME/rulesets" \
  --method POST \
  --input - <<'EOF'
{
  "name": "Require E2E verification",
  "target": "branch",
  "enforcement": "evaluate",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "bypass_actors": [
    {
      "actor_id": 5,
      "actor_type": "RepositoryRole",
      "bypass_mode": "always"
    }
  ],
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_status_checks_policy": false,
        "do_not_enforce_on_create": true,
        "required_status_checks": [
          {
            "context": "e2e-verified"
          }
        ]
      }
    }
  ]
}
EOF
)

RULESET_ID=$(echo "$RESULT" | jq -r '.id')

echo ""
echo "Ruleset created (ID: $RULESET_ID) in evaluate mode."
echo ""
echo "Next steps:"
echo "  1. Open a test PR and verify the ruleset shows in the merge checks"
echo "  2. Confirm e2e-verified status is posted by CI or agent attestation"
echo "  3. Activate: gh api repos/$OWNER/$REPO_NAME/rulesets/$RULESET_ID --method PUT -f enforcement=active"
echo ""
echo "To list rulesets:  gh api repos/$OWNER/$REPO_NAME/rulesets"
echo "To delete:         gh api repos/$OWNER/$REPO_NAME/rulesets/$RULESET_ID --method DELETE"
