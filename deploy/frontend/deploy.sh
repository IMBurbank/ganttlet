#!/bin/bash
set -euo pipefail

# Deploy Ganttlet frontend to Firebase Hosting.
#
# Prerequisites:
#   - Firebase CLI installed (npm i -g firebase-tools)
#   - Logged in (firebase login)
#   - Firebase project initialized (firebase use YOUR_PROJECT_ID)
#
# Usage:
#   ./deploy/frontend/deploy.sh

echo "==> Building production bundle..."
npm run build

echo "==> Deploying to Firebase Hosting..."
firebase deploy --only hosting

echo ""
echo "==> Frontend deployment complete!"
echo "    Visit your Firebase Hosting URL to verify."
echo ""
