FROM rust:1.75-slim AS builder

# Set working directory
WORKDIR /app

# Copy Cargo manifest and source code
COPY Cargo.toml Cargo.lock .
COPY src ./src

# Install any needed system dependencies for building
RUN apt-get update && \
    apt-get install -y --no-install-recommends libssl-dev pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Build the binary in release mode
RUN cargo build --release && \
    strip target/release/preflight-cli

# ---- Runtime image ----
FROM debian:bookworm-slim

# Copy the compiled binary from the builder stage
COPY --from=builder /app/target/release/preflight-cli /usr/local/bin/preflight-cli

# Ensure the binary is executable
RUN chmod +x /usr/local/bin/preflight-cli

# Set the entrypoint
ENTRYPOINT ["preflight-cli"]
