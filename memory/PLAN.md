# Memory Service — Implementation Plan

## Architecture

```
POST /memory/context ──► semantic search over memories (pgvector)
POST /memory/ingest  ──► stub: validates fields, returns success
GET  /healthz        ──► liveness + DB ping
```

- **Port:** 4001
- **Auth:** Bearer token (`TRACEFRAME_API_KEY`) on all non-healthz endpoints
- **Framework:** axum 0.7 + tokio
- **Database:** PostgreSQL + pgvector via sqlx
- **Embeddings:** delegated to ingest service (`POST /ingest/embed`)
- **Rate limiting:** global, via tower_governor (429 with Retry-After)

## Project Structure

```
memory/
├── Cargo.toml
├── Cargo.lock
├── Dockerfile
├── PLAN.md              ← this file
└── src/
    ├── main.rs           server bootstrap, router, app state
    ├── config.rs         env parsing with defaults
    ├── auth.rs           Bearer token middleware
    ├── error.rs          unified error → HTTP response mapping
    ├── db.rs             sqlx pool init
    ├── embed.rs          Embedder trait + RemoteEmbedder
    ├── ratelimit.rs      tower_governor configuration
    ├── models.rs         request/response serde structs
    └── routes/
        ├── mod.rs
        ├── health.rs     GET /healthz (DB ping)
        ├── context.rs    POST /memory/context (pgvector search)
        └── ingest.rs     POST /memory/ingest (multipart, stub)
```

## API Contract

### POST /memory/context

```
Authorization: Bearer <TRACEFRAME_API_KEY>
Content-Type: application/json

{ "query": "...", "repo_tag": "...", "max_results": 5 }

→ 200 (live)  { "query": "...", "results": [...], "took_ms": 45, "mode": "live" }
→ 200 (stub)  { "query": "...", "results": [...], "took_ms": 1,  "mode": "stub" }
→ 401         { "error": "unauthorized", "message": "..." }
```

Stub mode is returned when the embedder or database is unavailable.

### POST /memory/ingest

```
Authorization: Bearer <TRACEFRAME_API_KEY>
Content-Type: multipart/form-data

  repo_tag:    string
  source_type: "zip" | "github_url"
  source:      file | url string

→ 200 { "status": "ok", "repo_tag": "...", "source_type": "...",
         "files_processed": 0, "message": "stub: ..." }
```

### GET /healthz

```
→ 200 { "status": "ok", "service": "traceframe-memory", "version": "0.1.0",
         "db_ok": true }
```

## Implementation Status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Done | Database-backed context retrieval via pgvector |
| Phase 2 | Not started | GitHub URL ingestion |
| Phase 3 | Not started | Zip file ingestion |
| Phase 4 | ✅ Done | Rate limiting via tower_governor |
| Phase 5 | Not started | Observability (structured logging, metrics) |

### Phase 1 Details — Database-Backed Context Retrieval

**Schema:** Added `embedding vector(384)` column to `memories` table via
`02-memory-embeddings.sql` migration (mounted into postgres initdb).

**Embedding pipeline:**
- **Query embedding:** Memory service calls `POST /ingest/embed` on the ingest
  service, which wraps the existing local ONNX pipeline (`Xenova/all-MiniLM-L6-v2`,
  384-dim). The `remote_embedder` module in Rust handles the HTTP call with
  3s connect timeout and 10s request timeout.
- **Write embedding:** The ingest service embeds new memories on insert
  (`distillSession` → `embedMemory` async), and on update (patch, redistill).
- **Backfill:** `POST /ingest/admin/backfill-memories` embeds all rows with
  `embedding IS NULL` in batches of 32.

**Search query:**
```sql
SELECT m.*, (m.embedding <=> $1::vector) AS distance
  FROM memories m
 WHERE m.embedding IS NOT NULL
   AND ($2::text IS NULL OR m.repo_tag = $2)
 ORDER BY m.embedding <=> $1::vector
 LIMIT $3
```

Score conversion: `score = 1.0 / (1.0 + distance)` (cosine distance 0 → score 1.0).

**Graceful degradation:** Falls back to stub mode when:
- `INGEST_SERVICE_URL` is not configured → embedder is `None`
- Embedder returns an error → stub response with `mode: "stub"`
- Database pool is `None` → stub response

### Phase 4 Details — Rate Limiting

**Implementation:** `tower_governor` 0.4 with `GovernorConfigBuilder`.
Global token bucket (all requests share one limiter).

**Configuration:**
- `RATE_LIMIT_RPS=100` — requests per second (default: 100)
- `RATE_LIMIT_BURST=200` — burst size (default: 200)
- Set `RATE_LIMIT_RPS=0` to disable

**Response on limit:** 429 Too Many Requests with `x-ratelimit-*` and
`Retry-After` headers (provided by tower_governor).

## Ingest Service Changes

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/ingest/embed` | POST | Bearer | Embed a single text → 384-dim vector |
| `/ingest/admin/backfill-memories` | POST | Bearer | Embed all un-embedded memories |

**Write-side embedding:** `distillSession`, `handlePatchMemory`, and
`handlePostMemoryRedistill` all trigger async `embedMemory()` calls after
insert/update, ensuring new content is immediately searchable.

## Future Phases

### Phase 2 — GitHub URL ingestion
- Clone/fetch a GitHub repo (shallow clone via `git2` or `reqwest` to tarball API)
- Walk files, filter by extension, chunk large files
- Store chunks in a new `memory_chunks` table with embeddings
- Update `codegraph_repos` status and increment counters

### Phase 3 — Zip file ingestion
- Accept multipart zip uploads (100 MB limit)
- Stream-unzip, walk files, same chunk+embed pipeline as Phase 2
- Deduplicate by file SHA256

### Phase 5 — Observability
- Structured JSON logging via `tracing-subscriber`
- Request ID header propagation (`x-request-id`)
- Prometheus metrics endpoint (`/metrics`) — request counts, latency histograms, error rates
- Per-IP or per-API-key rate limiting (key extractor customization)
