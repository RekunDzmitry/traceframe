// Data layer for the memory service: pg pool, schema bootstrap, memory CRUD,
// and pgvector semantic search. All embedding work delegates to embedder.mjs
// (local ONNX, no external API).

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { embedQuery, vectorLiteral } from "./embedder.mjs";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || "traceframe",
  password: process.env.POSTGRES_PASSWORD || "traceframe",
  database: process.env.POSTGRES_DB || "traceframe",
});

// Columns returned to the client, consistent across every read.
const COLS = `id, repo_tag, kind, summary, meta, created_at, session_id, trace_id`;

const rowToMemory = (r) => ({
  id: Number(r.id),
  repoTag: r.repo_tag,
  kind: r.kind,
  summary: r.summary,
  meta: r.meta,
  createdAt: r.created_at,
  sessionId: r.session_id,
  traceId: r.trace_id,
});

export async function ensureSchema() {
  const sql = await readFile(join(__dirname, "init.sql"), "utf8");
  await pool.query(sql);
}

export async function ping() {
  await pool.query("SELECT 1");
}

// ── Embedding (fire-and-forget after writes) ────────────────────────────────

// Compute + store the embedding for a memory. Non-fatal: logs and swallows
// errors so a write still succeeds if the model is cold or unavailable.
export async function embedMemory(id, text) {
  try {
    const vec = await embedQuery(text);
    await pool.query("UPDATE memories SET embedding = $1::vector WHERE id = $2", [
      vectorLiteral(vec),
      id,
    ]);
  } catch (e) {
    console.error(`embedMemory(${id}) failed:`, e.message);
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listProjects() {
  const { rows } = await pool.query(`
    SELECT repo_tag,
           COUNT(*)::int AS memory_count,
           MAX(created_at) AS latest_created_at
      FROM memories
     GROUP BY repo_tag
     ORDER BY latest_created_at DESC
  `);
  return rows.map((r) => ({
    repoTag: r.repo_tag,
    memoryCount: r.memory_count,
    latestCreatedAt: r.latest_created_at,
  }));
}

export async function listMemories({ repo, limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const { rows } = repo
    ? await pool.query(
        `SELECT ${COLS} FROM memories WHERE repo_tag = $1 ORDER BY created_at DESC LIMIT $2`,
        [repo, lim]
      )
    : await pool.query(
        `SELECT ${COLS} FROM memories ORDER BY created_at DESC LIMIT $1`,
        [lim]
      );
  return rows.map(rowToMemory);
}

export async function getMemory(id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM memories WHERE id = $1`, [id]);
  return rows[0] ? rowToMemory(rows[0]) : null;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function createMemory({ repoTag, summary, kind = "note", meta = {} }) {
  const { rows } = await pool.query(
    `INSERT INTO memories (repo_tag, kind, summary, meta)
     VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
    [repoTag, kind, summary, meta]
  );
  const mem = rowToMemory(rows[0]);
  setImmediate(() => embedMemory(mem.id, summary));
  return mem;
}

export async function updateMemory(id, summary) {
  const { rows } = await pool.query(
    `UPDATE memories SET summary = $1 WHERE id = $2 RETURNING ${COLS}`,
    [summary, id]
  );
  if (!rows[0]) return null;
  const mem = rowToMemory(rows[0]);
  setImmediate(() => embedMemory(mem.id, summary));
  return mem;
}

export async function deleteMemory(id) {
  const { rowCount } = await pool.query("DELETE FROM memories WHERE id = $1", [id]);
  return rowCount > 0;
}

// ── Semantic search ──────────────────────────────────────────────────────────

// Returns matches ordered by cosine distance. score = 1/(1+distance) so a
// perfect match → 1.0. Throws if the embedder is unavailable (caller decides
// how to surface it); rows without an embedding are skipped.
export async function searchMemories({ query, repoTag = null, maxResults = 5 }) {
  const lim = Math.min(Math.max(Number(maxResults) || 5, 1), 50);
  const vec = vectorLiteral(await embedQuery(query));
  const { rows } = await pool.query(
    `SELECT ${COLS}, (embedding <=> $1::vector) AS distance
       FROM memories
      WHERE embedding IS NOT NULL
        AND ($2::text IS NULL OR repo_tag = $2)
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vec, repoTag, lim]
  );
  return rows.map((r) => ({
    ...rowToMemory(r),
    score: Math.round((1 / (1 + Number(r.distance))) * 100) / 100,
  }));
}
