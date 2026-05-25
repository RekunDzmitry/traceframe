# traceframe

LLM agent observability stack — event ingestion, memory distillation, code graph indexing, and prompt optimization.

## What's inside

| Module | Path | Description |
|--------|------|-------------|
| Ingest server | `ingest/server.mjs` | HTTP API (port 4000), PostgreSQL backend |
| Prompt optimizer | `ingest/optimizer/` | 4-layer token-saving pipeline |
| Code graph | `ingest/codegraph/` | AST indexer for JS/TS/Python repos |
| Memory distillation | `ingest/` | Event → memory summarization via LLM |
| CLI hooks | `bin/traceframe` | Claude Code session hooks (start/stop/tail) |
| Wiki | `wiki/` | Obsidian-compatible LLM observability knowledge base |
| Frontend | `app.jsx`, `memory-graph.jsx` | React dashboards (no build step — Vite/CDN) |

---

## Quick start — optimizer (no server needed)

Test the prompt optimizer pipeline locally without Docker or API keys:

```bash
node bin/test-optimizer.mjs
```

Output shows all 4 pipeline layers: Content Router, Compressor, Context Selector, Session Guard — with token savings breakdown.

---

## Full stack — Docker

### Prerequisites

- Docker + Docker Compose
- OpenCode API key (for LLM calls)

### 1. Create `.env` in the project root

```env
TRACEFRAME_API_KEY=your-secret-key
OPENCODE_GO_API_KEY=your-opencode-key
OPENCODE_GO_BASE_URL=https://opencode.ai/zen/go/v1
OPENCODE_GO_MODEL=deepseek-v4-flash
```

### 2. Start

```bash
docker-compose up --build
```

Postgres runs on port `5434`, ingest server on port `4000`.

### 3. Verify

```bash
curl http://localhost:4000/healthz
```

---

## Optimizer API

The prompt optimizer runs as part of the ingest server. All endpoints require `X-API-Key` header.

### Analyze a prompt

```bash
curl -X POST http://localhost:4000/optimizer/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "system": "Please note that you should be helpful",
    "messages": [{"role": "user", "content": "How do I fix the redirect loop?"}],
    "tools": []
  }'
```

### Optimize (apply techniques)

```bash
curl -X POST http://localhost:4000/optimizer/optimize \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "system": "...",
    "messages": [...],
    "tools": [...],
    "profile": "balanced"
  }'
```

### Full 4-layer pipeline

```bash
curl -X POST http://localhost:4000/optimizer/pipeline \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "profile": "balanced",
    "query": "Fix the auth redirect loop",
    "keywords": ["auth", "middleware"],
    "system": "...",
    "messages": [...],
    "tools": [...],
    "sessionTurns": [
      {"turnIndex": 0, "tokens": 1200},
      {"turnIndex": 1, "tokens": 1350}
    ]
  }'
```

### Profiles

| Profile | Techniques active |
|---------|-------------------|
| `balanced` | Filler trim, dedup, system compression |
| `max-save` | All of the above + tool description shrinking |
| `quality-first` | Filler trim only |

---

## Optimizer pipeline — how it works

```
Input prompt
  ↓ Layer 1 — Content Router     label each message: code/json/shell/markdown/text
  ↓ Layer 2 — Compressor         type-aware filler removal, dedup, system compression
  ↓ Layer 3 — Context Selector   Hot/Warm/Cold scoring, drop irrelevant messages
  ↓ Layer 4 — Session Guard      Waste Factor monitoring, rotation recommendation
Output: optimized prompt + layered report
```

**Session Guard** tracks token growth across turns. Waste Factor = `avg(last 3 turns) ÷ avg(first 3 turns)`. Warns at 3×, recommends rotation with a handoff template at 10×.

---

## Code graph

Index a local repo:

```bash
curl -X POST http://localhost:4000/codegraph/index \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"repoPath": "/absolute/path/to/repo"}'
```

Query symbols:

```bash
curl "http://localhost:4000/codegraph/search?q=authMiddleware&repoPath=/path/to/repo" \
  -H "X-API-Key: your-secret-key"
```

---

## Claude Code hooks

Install session hooks into Claude Code:

```bash
bin/traceframe session-start
bin/traceframe session-stop
bin/traceframe tail          # stream recent events
bin/traceframe memory-fetch  # retrieve distilled memories
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Ingest server port |
| `TRACEFRAME_API_KEY` | — | Auth key for all API requests |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `POSTGRES_PORT` | `5434` | Postgres port |
| `POSTGRES_USER` | `traceframe` | Postgres user |
| `POSTGRES_PASSWORD` | `traceframe` | Postgres password |
| `POSTGRES_DB` | `traceframe` | Postgres database |
| `OPENCODE_GO_API_KEY` | — | OpenCode API key (for LLM calls) |
| `OPENCODE_GO_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenCode base URL |
| `OPENCODE_GO_MODEL` | `deepseek-v4-flash` | Model to use |
