-- Schema for the simple memory service.
-- Idempotent: safe to run on an existing pgdata volume that already holds
-- memories rows (the old stack used the same table). pgvector backs the
-- 384-dim embeddings produced by Xenova/all-MiniLM-L6-v2.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_tag    TEXT        NOT NULL,
  session_id  TEXT,
  trace_id    TEXT,
  kind        TEXT        NOT NULL DEFAULT 'note',
  summary     TEXT        NOT NULL,
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedding   vector(384)
);

-- Ensure the embedding column exists even if the table predates pgvector.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_memories_repo_recency
  ON memories (repo_tag, created_at DESC);
