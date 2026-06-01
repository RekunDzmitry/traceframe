FROM node:22-bookworm-slim

# libpq for pg; curl for the healthcheck; build tools for onnxruntime-node
# (no prebuilt for linux/arm64 musl, which is why this is bookworm not alpine).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates libpq5 python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional=false

COPY server.mjs db.mjs embedder.mjs init.sql ./
COPY optimizer ./optimizer
COPY public ./public

# Cache for transformers.js model downloads (Xenova/all-MiniLM-L6-v2).
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface
RUN mkdir -p ${HF_HOME} && chown -R node:node ${HF_HOME}

ENV PORT=4000
EXPOSE 4000

USER node
CMD ["node", "server.mjs"]
