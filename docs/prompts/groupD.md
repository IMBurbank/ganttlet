# Phase 10 Group D (Stage 2) — CI/CD Pipeline + Agent Workflow

You are implementing Phase 10 Group D (Stage 2) for the Ganttlet project.
Read CLAUDE.md and TASKS.md for full context.

IMPORTANT: Do NOT enter plan mode. Do NOT ask for confirmation before proceeding.
Execute all tasks sequentially without stopping for approval.
If you encounter an error, fix it and continue. If you cannot fix it after 3 attempts, commit what you have and move on to the next task.

## Your files (ONLY modify these):
- .github/workflows/ci.yml (new)
- .github/workflows/deploy.yml (new)
- .github/workflows/agent-work.yml (new)
- CLAUDE.md (additions only — do not remove existing content)

## Background

The project currently has no CI/CD pipeline — no GitHub Actions workflows exist. Deployments are manual shell scripts. We need: automated PR checks, a deploy pipeline with pre-built images, and an agent workflow that lets labeled GitHub issues trigger autonomous Claude Code work.

## Tasks — execute in order:

### D1: CI pipeline

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

      - name: Install dependencies
        run: npm install

      - name: Build WASM
        run: npm run build:wasm

      - name: Type check
        run: npx tsc --noEmit

      - name: Unit tests
        run: npm run test

      - name: Rust tests
        run: cd crates/scheduler && cargo test

      - name: Relay server tests
        run: cd server && cargo test
```

### D2: Deploy pipeline

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy target'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: us-central1
  RELAY_SERVICE: ganttlet-relay
  FRONTEND_SERVICE: ganttlet-frontend

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  build-and-push:
    needs: ci
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev

      - name: Build and push relay image
        run: |
          IMAGE=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/ganttlet/${{ env.RELAY_SERVICE }}:${{ github.sha }}
          docker build -f Dockerfile.server -t $IMAGE ./server
          docker push $IMAGE

      - name: Build and push frontend image
        run: |
          IMAGE=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/ganttlet/${{ env.FRONTEND_SERVICE }}:${{ github.sha }}
          docker build -f deploy/frontend/Dockerfile -t $IMAGE .
          docker push $IMAGE

  deploy-staging:
    needs: build-and-push
    if: github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'staging')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Deploy relay to staging
        run: |
          gcloud run deploy ${{ env.RELAY_SERVICE }} \
            --project=${{ env.PROJECT_ID }} \
            --region=${{ env.REGION }} \
            --image=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/ganttlet/${{ env.RELAY_SERVICE }}:${{ github.sha }} \
            --platform=managed

      - name: Deploy frontend to staging
        run: |
          gcloud run deploy ${{ env.FRONTEND_SERVICE }} \
            --project=${{ env.PROJECT_ID }} \
            --region=${{ env.REGION }} \
            --image=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/ganttlet/${{ env.FRONTEND_SERVICE }}:${{ github.sha }} \
            --platform=managed

  deploy-production:
    needs: build-and-push
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'production'
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Deploy relay to production
        run: |
          gcloud run deploy ${{ env.RELAY_SERVICE }} \
            --project=${{ env.PROJECT_ID }} \
            --region=${{ env.REGION }} \
            --image=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/ganttlet/${{ env.RELAY_SERVICE }}:${{ github.sha }} \
            --platform=managed

      - name: Deploy frontend to production
        run: |
          gcloud run deploy ${{ env.FRONTEND_SERVICE }} \
            --project=${{ env.PROJECT_ID }} \
            --region=${{ env.REGION }} \
            --image=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/ganttlet/${{ env.FRONTEND_SERVICE }}:${{ github.sha }} \
            --platform=managed
```

Note: This requires GitHub secrets to be configured: `GCP_PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`. The deploy README should document this.

### D3: Agent workflow

Create `.github/workflows/agent-work.yml`:

```yaml
name: Agent Work

on:
  issues:
    types: [labeled]

jobs:
  agent:
    if: github.event.label.name == 'agent-ready'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

      - name: Install dependencies
        run: npm install

      - name: Build WASM
        run: npm run build:wasm

      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code

      - name: Create branch
        run: |
          BRANCH="agent/issue-${{ github.event.issue.number }}"
          git checkout -b "$BRANCH"
          echo "BRANCH=$BRANCH" >> $GITHUB_ENV

      - name: Run Claude Code
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude --print --dangerously-skip-permissions <<'PROMPT'
          You are working on issue #${{ github.event.issue.number }}: ${{ github.event.issue.title }}

          Issue description:
          ${{ github.event.issue.body }}

          Instructions:
          1. Read CLAUDE.md for project context
          2. Implement the changes described in the issue
          3. Run verification: npm run build:wasm && npx tsc --noEmit && npm run test && cd crates/scheduler && cargo test
          4. Commit your changes with descriptive messages
          5. Do NOT open a PR — that will be done in the next step
          PROMPT

      - name: Push and create PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git push -u origin "$BRANCH"
          gh pr create \
            --title "Agent: ${{ github.event.issue.title }}" \
            --body "$(cat <<'EOF'
          Closes #${{ github.event.issue.number }}

          This PR was generated by Claude Code in response to the issue above.
          Please review the changes carefully before merging.

          ---
          *Automated by [agent-work workflow](.github/workflows/agent-work.yml)*
          EOF
          )" \
            --head "$BRANCH" \
            --base main

      - name: Comment on issue
        if: success()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_URL=$(gh pr view "$BRANCH" --json url -q '.url')
          gh issue comment ${{ github.event.issue.number }} \
            --body "Agent has created a PR: ${PR_URL}"

      - name: Comment on failure
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue comment ${{ github.event.issue.number }} \
            --body "Agent workflow failed. Check the [workflow run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}) for details."
```

### D4: Update CLAUDE.md for single-agent issue work

Add the following section to CLAUDE.md under "Development Practices", after the existing "Multi-Agent Orchestration" subsection:

```markdown
### Single-Agent Issue Work
When working from a GitHub issue (via the `agent-ready` label workflow or manual assignment):
- Branch naming: `agent/issue-{number}`
- Full verification: `npm run build:wasm && npx tsc --noEmit && npm run test && cd crates/scheduler && cargo test`
- Open a PR with `gh pr create` — never push directly to main
- PR body must include `Closes #{issue_number}` for auto-closing
- Commit often with descriptive messages
```

## Verification
After all tasks, verify:
```bash
# Check YAML syntax
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/agent-work.yml'))"
```
All YAML must be valid. Commit your changes with descriptive messages.
