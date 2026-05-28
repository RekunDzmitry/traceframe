FROM node:22-bookworm-slim

# libpq for pg native bindings; git for tree-sitter grammar fallbacks;
# build tools for native modules (tree-sitter, onnxruntime-node fallbacks).
# Switched from alpine because onnxruntime-node ships no prebuilt for
# linux/arm64 musl, which broke @huggingface/transformers semantic search.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates libpq5 git python3 make g++ \
       ripgrep curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install a recent fd (>= 10) — Debian's fd-find 8.6 is too old for pi (it
# passes --no-require-git, which only exists in fd 8.7+). Pull the static
# binary from the upstream release for the right architecture.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64)  fd_arch="x86_64-unknown-linux-musl" ;; \
      arm64)  fd_arch="aarch64-unknown-linux-musl" ;; \
      *) echo "unsupported arch: $arch"; exit 1 ;; \
    esac; \
    fd_ver="v10.2.0"; \
    fd_pkg="fd-${fd_ver}-${fd_arch}"; \
    curl -fsSL "https://github.com/sharkdp/fd/releases/download/${fd_ver}/${fd_pkg}.tar.gz" \
      | tar -xzC /tmp; \
    install -m 0755 "/tmp/${fd_pkg}/fd" /usr/local/bin/fd; \
    rm -rf "/tmp/${fd_pkg}"; \
    fd --version

WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional=false

# pi-coding-agent CLI: spawned per branch variant by /branch/run to produce a
# live agent sub-tree (assistant + tool_use + tool_result steps). Reads
# OPENCODE_API_KEY from env (already wired through docker-compose).
RUN npm install -g @mariozechner/pi-coding-agent && pi --version

COPY server.mjs ./
COPY dashboard.html ./
COPY init.sql ./
COPY codegraph ./codegraph

# Cache directory for transformers.js model downloads (Xenova/all-MiniLM-L6-v2).
ENV HF_HOME=/app/.cache/huggingface
RUN mkdir -p ${HF_HOME} && chown -R node:node ${HF_HOME}

ENV PORT=4000
EXPOSE 4000

USER node
CMD ["node", "server.mjs"]
