-- TraceFrame schema
-- One row per ingested event (JSONL line).

CREATE TABLE IF NOT EXISTS traces (
  trace_id     TEXT PRIMARY KEY,
  inserted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_count  INT         NOT NULL DEFAULT 0,
  total_bytes  BIGINT      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trace_id     TEXT        NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,          -- e.type
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw          JSONB       NOT NULL           -- full event payload
);

CREATE INDEX IF NOT EXISTS idx_events_trace_id   ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_received   ON events(received_at);
CREATE INDEX IF NOT EXISTS idx_events_trace_uuid ON events(trace_id, ((raw->>'uuid')));

-- Distilled session summaries injected into Claude Code's SessionStart hook.
CREATE TABLE IF NOT EXISTS memories (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_tag      TEXT        NOT NULL,
  session_id    TEXT,
  trace_id      TEXT        REFERENCES traces(trace_id) ON DELETE SET NULL,
  kind          TEXT        NOT NULL DEFAULT 'session_summary',
  summary       TEXT        NOT NULL,
  meta          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memories_repo_recency ON memories(repo_tag, created_at DESC);

-- ─── Code graph ───────────────────────────────────────────────────────────
-- Per-repo structural index of source code (files, symbols, imports, calls).
-- Inspired by GitNexus, reimplemented over Postgres.

CREATE TABLE IF NOT EXISTS codegraph_repos (
  repo_tag       TEXT PRIMARY KEY,
  root_path      TEXT NOT NULL,
  commit_sha     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending | indexing | ready | failed
  status_error   TEXT,
  file_count     INT  NOT NULL DEFAULT 0,
  symbol_count   INT  NOT NULL DEFAULT 0,
  lang_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  indexed_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS codegraph_files (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_tag   TEXT NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  language   TEXT NOT NULL,
  size_bytes INT,
  sha256     TEXT,
  UNIQUE (repo_tag, path)
);
CREATE INDEX IF NOT EXISTS idx_codegraph_files_repo ON codegraph_files(repo_tag);

CREATE TABLE IF NOT EXISTS codegraph_symbols (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_tag       TEXT   NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
  file_id        BIGINT NOT NULL REFERENCES codegraph_files(id)       ON DELETE CASCADE,
  name           TEXT   NOT NULL,
  qualified_name TEXT,
  kind           TEXT   NOT NULL,            -- function | method | class | variable | interface | type
  start_line     INT    NOT NULL,
  end_line       INT    NOT NULL,
  signature      TEXT,
  docstring      TEXT
);
CREATE INDEX IF NOT EXISTS idx_codegraph_symbols_file ON codegraph_symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_codegraph_symbols_name ON codegraph_symbols(repo_tag, name);

CREATE TABLE IF NOT EXISTS codegraph_imports (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_tag        TEXT   NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
  from_file_id    BIGINT NOT NULL REFERENCES codegraph_files(id)       ON DELETE CASCADE,
  to_file_id      BIGINT          REFERENCES codegraph_files(id)       ON DELETE CASCADE,
  external_module TEXT,
  CHECK (to_file_id IS NOT NULL OR external_module IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_codegraph_imports_from ON codegraph_imports(from_file_id);
CREATE INDEX IF NOT EXISTS idx_codegraph_imports_to   ON codegraph_imports(to_file_id);

CREATE TABLE IF NOT EXISTS codegraph_calls (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_tag       TEXT   NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
  from_symbol_id BIGINT NOT NULL REFERENCES codegraph_symbols(id)     ON DELETE CASCADE,
  to_symbol_id   BIGINT          REFERENCES codegraph_symbols(id)     ON DELETE CASCADE,
  external_name  TEXT,
  call_site_line INT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codegraph_calls_from ON codegraph_calls(from_symbol_id);
CREATE INDEX IF NOT EXISTS idx_codegraph_calls_to   ON codegraph_calls(to_symbol_id);

-- ─── Proxy optimization telemetry ────────────────────────────────────────────
-- One row per /v1/messages request that passed through the optimizer proxy.

CREATE TABLE IF NOT EXISTS proxy_stats (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trace_id        TEXT        REFERENCES traces(trace_id) ON DELETE SET NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  profile         TEXT        NOT NULL DEFAULT 'balanced',
  model           TEXT,
  input_tokens    INT         NOT NULL DEFAULT 0,
  output_tokens   INT         NOT NULL DEFAULT 0,
  saved_tokens    INT         NOT NULL DEFAULT 0,
  saved_pct       INT         NOT NULL DEFAULT 0,
  meta            JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_proxy_stats_trace ON proxy_stats(trace_id);
CREATE INDEX IF NOT EXISTS idx_proxy_stats_at    ON proxy_stats(requested_at DESC);
