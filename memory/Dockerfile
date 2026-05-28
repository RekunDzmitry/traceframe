# ─── Build stage ───────────────────────────────────────────────────────────
FROM rust:1.88-bookworm AS builder

WORKDIR /app

# Cache dependencies by building with a dummy main.rs first.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release; \
    rm -rf src target/release/traceframe-memory target/release/deps/traceframe_memory*

# Copy real source and build.
COPY src/ ./src/
RUN cargo build --release && \
    cp target/release/traceframe-memory /

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libpq5 wget && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /traceframe-memory /usr/local/bin/traceframe-memory

ENV PORT=4001
EXPOSE 4001

# Run as non-root.
USER nobody

HEALTHCHECK --interval=10s --timeout=2s --retries=3 \
    CMD wget -qO- http://localhost:4001/healthz || exit 1

CMD ["traceframe-memory"]
