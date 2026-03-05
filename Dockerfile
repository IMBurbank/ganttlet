FROM node:20-slim AS dev

# Install system dependencies, Playwright Chromium OS-level libs, and fonts
RUN apt-get update && apt-get install -y \
    git curl python3 python3-pip sudo jq tmux \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    libwayland-client0 fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Grant the built-in node user (uid 1000) sudo access
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node

# Switch to non-root user
USER node

# Install Claude Code via native installer (no Node.js dependency)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install Rust toolchain, wasm32 target, and wasm-pack
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable \
    && . "$HOME/.cargo/env" \
    && rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack

ENV PATH="/home/node/.local/bin:/home/node/.cargo/bin:${PATH}"

# Install Playwright Chromium browser binary (OS deps already installed above)
RUN npx playwright@1.58.2 install chromium

# Set up git config defaults (will be overridden by volume mount)

RUN git config --global init.defaultBranch main

WORKDIR /workspace

COPY --chown=node:node scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN echo 'alias cc="claude \${CLAUDE_CLI_FLAGS}"' >> ~/.bashrc

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bash"]

# ── gcloud stage: extends dev with Google Cloud CLI for deployment ───────────
FROM dev AS gcloud

USER root

RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
      | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update && apt-get install -y google-cloud-cli \
    && rm -rf /var/lib/apt/lists/*

USER node
