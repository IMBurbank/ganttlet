FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Grant the built-in node user (uid 1000) sudo access
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node

# Switch to non-root user
USER node

# Set up git config defaults (will be overridden by volume mount)

RUN git config --global init.defaultBranch main

WORKDIR /workspace

RUN echo 'alias cc="claude \${CLAUDE_CLI_FLAGS}"' >> ~/.bashrc

CMD ["bash"]
