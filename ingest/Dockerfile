FROM node:22-bookworm-slim

# libpq for pg native bindings; git for tree-sitter grammar fallbacks;
# build tools for native modules (tree-sitter, onnxruntime-node fallbacks).
# Switched from alpine because onnxruntime-node ships no prebuilt for
# linux/arm64 musl, which broke @huggingface/transformers semantic search.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates libpq5 git python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional=false

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
