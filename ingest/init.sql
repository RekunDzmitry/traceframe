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
