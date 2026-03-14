#!/usr/bin/env bash
# setup-e2e-ruleset.sh — Create GitHub Ruleset requiring e2e-verified status.
#
# Run once by a repo admin after the e2e.yml workflow changes are merged.
# Creates the ruleset in "active" mode. (evaluate/dry-run requires Enterprise.)
# Repo admins are bypass actors and can merge without E2E if needed.
#
# To disable temporarily:
#   RULESET_ID=$(gh api repos/OWNER/REPO/rulesets --jq '.[] | select(.name == "Require E2E verification") | .id')
#   gh api repos/OWNER/REPO/rulesets/$RULESET_ID --method PUT -f enforcement=disabled
#
# Requires: gh CLI with admin access to the repo.
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
OWNER=$(echo "$REPO" | cut -d/ -f1)
REPO_NAME=$(echo "$REPO" | cut -d/ -f2)

echo "Creating E2E required status ruleset for $REPO..."

RESULT=$(gh api "repos/$OWNER/$REPO_NAME/rulesets" \
  --method POST \
  --input - <<'EOF'
{
  "name": "Require E2E verification",
  "target": "branch",
  "enforcement": "active",
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
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          {
            "context": "e2e-verified",
            "integration_id": 15368
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
echo "Ruleset created (ID: $RULESET_ID), enforcement: active."
echo "Repo admins can bypass when needed."
echo ""
echo "To disable:  gh api repos/$OWNER/$REPO_NAME/rulesets/$RULESET_ID --method PUT -f enforcement=disabled"
echo "To list:     gh api repos/$OWNER/$REPO_NAME/rulesets"
echo "To delete:   gh api repos/$OWNER/$REPO_NAME/rulesets/$RULESET_ID --method DELETE"
