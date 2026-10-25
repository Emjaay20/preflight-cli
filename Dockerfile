FROM rust:1.75-slim AS builder

WORKDIR /app

COPY Cargo.toml ./
COPY src ./src

RUN cargo generate-lockfile && cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/preflight /usr/local/bin/preflight
RUN ln -s preflight /usr/local/bin/preflight-cli

ENTRYPOINT ["preflight"]
