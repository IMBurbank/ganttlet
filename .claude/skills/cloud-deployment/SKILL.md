---
name: cloud-deployment
description: "Use when working on Cloud Run deployment, staging/prod environments, health checks, or GCP configuration. Covers promotable artifacts, environment injection, and verification."
---

# Cloud Deployment Guide

## Promotable Artifacts Pattern
Frontend and relay Docker images must be identical across environments (dev → staging → prod).
Environment-specific config is injected at deploy time — never baked into the build.

## Environment Variable Injection
- OAuth client IDs, relay URLs, allowed origins → Cloud Run env vars or Secret Manager
- Test-specific code paths (e.g., `__ganttlet_setTestAuth`) must not exist in production builds
- E2E tests against cloud environments inject auth via Playwright's `page.addInitScript()`

## Cloud Run Pipeline
- Frontend: static build served from Cloud Run container
- Relay: Rust binary in a separate Cloud Run service
- Both services scale independently

## Health Checks & Smoke Tests
See `docs/cloud-verification-plan.md` for the staged verification plan:
1. Health checks (liveness/readiness endpoints)
2. Service account smoke tests
3. E2E against live Cloud Run
4. Staging project with Secret Manager
5. Visual regression baselines

## GCP Project Layout
- Separate staging and production projects
- Secret Manager for sensitive config
- Cloud Build or GitHub Actions for CI/CD
- See `docs/cloud-verification-plan.md` for full details
