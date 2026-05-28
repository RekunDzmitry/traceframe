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

-- ─── A/B branch experiments ───────────────────────────────────────────────
-- Each row is one variant submission persisted as a Node-shaped result.
CREATE TABLE IF NOT EXISTS branch_nodes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id        TEXT        NOT NULL,
  trace_id       TEXT        NOT NULL,
  source_node_id TEXT        NOT NULL,
  parent_node_id TEXT        NOT NULL,
  branch_kind    TEXT        NOT NULL DEFAULT 'experiment',
  branch_label   TEXT,
  model          TEXT        NOT NULL,
  provider       TEXT        NOT NULL DEFAULT 'opencode-go',
  spec           JSONB       NOT NULL,
  result         JSONB       NOT NULL,
  status         TEXT        NOT NULL,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trace_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_branch_nodes_trace  ON branch_nodes(trace_id);
CREATE INDEX IF NOT EXISTS idx_branch_nodes_parent ON branch_nodes(trace_id, parent_node_id);
-- v2: agent sub-tree columns. The root row groups all step rows that share
-- root_branch_node_id; status='running' is valid until pi exits.
ALTER TABLE branch_nodes ADD COLUMN IF NOT EXISTS root_branch_node_id TEXT;
ALTER TABLE branch_nodes ADD COLUMN IF NOT EXISTS step_index INT NOT NULL DEFAULT 0;
ALTER TABLE branch_nodes ADD COLUMN IF NOT EXISTS step_kind TEXT NOT NULL DEFAULT 'assistant';
CREATE INDEX IF NOT EXISTS idx_branch_nodes_root ON branch_nodes(trace_id, root_branch_node_id);

-- Saved experiment templates (a SavedExperiment is N specs).
CREATE TABLE IF NOT EXISTS branch_experiments (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  notes       TEXT,
  specs       JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_branch_experiments_recent ON branch_experiments(created_at DESC);
