# traceframe

A small **memory service** for LLM agents: a pgvector-backed memory store with
semantic search, a co-located **prompt optimizer**, and a single admin panel.

## What's inside

| Module | Path | Description |
|--------|------|-------------|
| Memory service | `service/server.mjs` | HTTP API (port 4000), PostgreSQL + pgvector |
| Data layer | `service/db.mjs` | Memory CRUD + semantic search queries |
| Embedder | `service/embedder.mjs` | Local ONNX embeddings (Xenova/all-MiniLM-L6-v2, 384d) |
| Prompt optimizer | `service/optimizer/` | 4-layer token-saving pipeline (pure, no network) |
| Admin panel | `service/public/admin.html` | No-build UI: memory browser + optimizer playground |
| Wiki | `wiki/` | Obsidian-compatible LLM observability knowledge base |

---

## Quick start — optimizer (no server needed)

Exercise the optimizer pipeline locally without Docker or API keys:

```bash
node bin/test-optimizer.mjs
```

Shows all 4 layers — Content Router, Compressor, Context Selector, Session Guard — with token savings.

---

## Full stack — Docker

### Prerequisites

- Docker + Docker Compose

### 1. Create `.env` in the project root

```env
TRACEFRAME_API_KEY=your-secret-key
POSTGRES_USER=traceframe
POSTGRES_PASSWORD=traceframe
POSTGRES_DB=traceframe
```

### 2. Start

```bash
docker-compose up --build
```

Postgres runs on port `5434`, the service on `4000`. The embedding model
(~25 MB) downloads on first boot and is cached in the `hf-cache` volume.

### 3. Open the admin panel

```
http://localhost:4000/
```

Enter your `TRACEFRAME_API_KEY` in the top-right field (or skip it — localhost
requests are allowed without auth). Two tabs:

- **Memories** — browse by project, semantic search, edit/delete, add new memories.
- **Optimizer** — paste a prompt, pick a profile, see token savings.

---

## API

All `/api/*` routes require `Authorization: Bearer <TRACEFRAME_API_KEY>`
(localhost is exempt). `GET /healthz` and `GET /` are open.

### Memory

```bash
# create
curl -X POST http://localhost:4000/api/memories \
  -H "Authorization: Bearer $TRACEFRAME_API_KEY" -H "Content-Type: application/json" \
  -d '{"repo_tag":"github-myproject","summary":"Fixed the auth redirect loop by ..."}'

# list a project's memories
curl "http://localhost:4000/api/memories?repo=github-myproject&limit=20" \
  -H "Authorization: Bearer $TRACEFRAME_API_KEY"

# semantic search
curl -X POST http://localhost:4000/api/search \
  -H "Authorization: Bearer $TRACEFRAME_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"how did I fix the redirect loop?","max_results":5}'
```

Other routes: `GET /api/projects`, `GET /api/memories/:id`,
`PATCH /api/memories/:id` `{summary}`, `DELETE /api/memories/:id`.

Memories are embedded on write (fire-and-forget); search returns matches ranked
by cosine similarity (`score` = `1/(1+distance)`, 1.0 = perfect match).

### Optimizer

```bash
curl -X POST http://localhost:4000/api/optimizer/pipeline \
  -H "Authorization: Bearer $TRACEFRAME_API_KEY" -H "Content-Type: application/json" \
  -d '{"profile":"balanced","system":"...","messages":[...],"tools":[...]}'
```

Routes: `/api/optimizer/analyze`, `/api/optimizer/optimize`, `/api/optimizer/pipeline`.

Profiles:

| Profile | Techniques active |
|---------|-------------------|
| `balanced` | Filler trim, dedup, system compression |
| `max-save` | All of the above + tool description shrinking |
| `quality-first` | Filler trim only |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Service port |
| `TRACEFRAME_API_KEY` | — | Bearer auth key. If unset, token auth fails closed — only loopback requests are accepted |
| `ALLOW_LOCALHOST` | `1` | Allow unauthenticated loopback requests (dev). Set `0` behind a reverse proxy |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `POSTGRES_PORT` | `5432` | Postgres port (host-mapped to `5434`) |
| `POSTGRES_USER` | `traceframe` | Postgres user |
| `POSTGRES_PASSWORD` | `traceframe` | Postgres password |
| `POSTGRES_DB` | `traceframe` | Postgres database |
| `TRANSFORMERS_CACHE` | `/app/.cache/huggingface` | Embedding model cache dir |
