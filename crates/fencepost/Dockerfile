FROM rust:1.83-slim-bookworm

# System deps for git operations (fencepost reads .git)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache deps layer — copy manifests first
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && echo "" > src/lib.rs \
    && cargo build --release 2>/dev/null || true \
    && rm -rf src

# Copy source and build
COPY . .
RUN cargo build --release && cargo test --release --no-run

# Install to PATH
RUN cargo install --path .

CMD ["fencepost", "--help"]
