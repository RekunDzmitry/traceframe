-- TraceFrame: memory embeddings migration
-- Adds pgvector embedding support to the memories table for semantic search.
-- Loaded by postgres initdb after 01-init.sql.

-- Enable pgvector extension (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (384-dim matches Xenova/all-MiniLM-L6-v2).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Index for approximate nearest neighbor search.
-- ivfflat needs data before building; skip in migration, build via backfill.
-- CREATE INDEX IF NOT EXISTS idx_memories_embedding_ivfflat
--   ON memories USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 1);
