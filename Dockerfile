FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Set up git config (will be overridden by your local git config via volume mount)
RUN git config --global init.defaultBranch main

WORKDIR /workspace

CMD ["bash"]
