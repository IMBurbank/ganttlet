#!/bin/bash
set -e

# =============================================================================
# Ganttlet — First-time setup script for macOS
# Run this once after cloning the repo: ./setup.sh
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "🏰 Ganttlet — Development Environment Setup"
echo "============================================="
echo ""

# --- Check prerequisites ---
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 found: $(command -v "$1")"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

MISSING=0

echo "Checking prerequisites..."
check_command git || MISSING=1
check_command docker || MISSING=1
check_command node || echo -e "${YELLOW}⚠${NC} Node.js not found (optional — only needed outside Docker)"
check_command code || echo -e "${YELLOW}⚠${NC} VS Code CLI not found (optional — install 'code' command from VS Code)"

echo ""

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}Missing required tools. Please install them and re-run this script.${NC}"
    exit 1
fi

# --- Create .env from example if it doesn't exist ---
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} Created .env from .env.example"
    echo -e "${YELLOW}  → Edit .env to add your ANTHROPIC_API_KEY${NC}"
else
    echo -e "${GREEN}✓${NC} .env already exists"
fi

# --- Build the Docker image ---
echo ""
echo "Building Docker image (this may take a minute the first time)..."
docker compose build

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your ANTHROPIC_API_KEY"
echo "  2. Start the dev container:"
echo "     docker compose run --service-ports dev"
echo "  3. Inside the container, run:"
echo "     claude"
echo "  4. Start building Ganttlet! 🚀"
echo ""
echo "Tip: Use --service-ports so localhost:5173 works in your browser."
echo ""
