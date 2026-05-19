// traceframe ingest — Postgres-backed event store.
//
//   POST /ingest/events           Authorization: Bearer <key>
//       body: { events: Event[] }  → inserts into postgres
//   GET  /healthz
//   GET  /traces                  → [{ traceId, eventCount, bytes, updatedAt }]
//   GET  /traces/:id              → { traceId, events: Event[] }
//   DELETE /traces/:id            → deletes trace + events
//
//   POST /optimizer/analyze       → token-waste report for a structured prompt
//   POST /optimizer/optimize      → apply compression techniques, return optimized prompt
//   POST /optimizer/experiment    → A/B run: original vs optimized via OpenCode provider
//   POST /optimizer/pipeline      → full 4-layer pipeline (router→compress→select→guard)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { indexRepo } from "./codegraph/indexer.mjs";
import { embedQuery, vectorLiteral } from "./codegraph/embedder.mjs";
import { analyzePrompt, applyOptimizations, runExperiment, runPipeline } from "./optimizer/index.mjs";

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(__dirname, "dashboard.html"), "utf8");

const PORT = Number(process.env.PORT || 4000);
const API_KEY = process.env.TRACEFRAME_API_KEY;

const OPENCODE_BASE = process.env.OPENCODE_GO_BASE_URL || "https://opencode.ai/zen/go/v1";
const OPENCODE_KEY = process.env.OPENCODE_GO_API_KEY || "";
const OPENCODE_MODEL = process.env.OPENCODE_GO_MODEL || "opencode-go/deepseek-v4-flash";

if (!API_KEY) {
  console.error("TRACEFRAME_API_KEY is required");
  process.exit(1);
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || "traceframe",
  password: process.env.POSTGRES_PASSWORD || "traceframe",
  database: process.env.POSTGRES_DB || "traceframe",
});

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req, limit = 4 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const authed = (req) => {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") && h.slice(7) === API_KEY;
};

// In dev mode, accept anonymous requests from localhost.
const isLocalhost = (req) => {
  const host = req.headers.host || "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
};

const authedOrLocal = (req) => authed(req) || isLocalhost(req);

const handlePostEvents = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, 400, { error: "invalid json", detail: String(e.message) });
  }
  if (!body || !Array.isArray(body.events)) {
    return json(res, 400, { error: "body.events must be an array" });
  }

  const receivedAt = new Date().toISOString();
  const byTrace = new Map();
  for (const [i, e] of body.events.entries()) {
    if (!e || typeof e !== "object") return json(res, 400, { error: `events[${i}] must be an object` });
    if (typeof e.type !== "string" || !e.type) return json(res, 400, { error: `events[${i}].type required` });
    const traceId = e.traceId || e.trace?.id;
    if (!traceId || !SAFE_ID.test(traceId)) {
      return json(res, 400, { error: `events[${i}].traceId must match ${SAFE_ID}` });
    }
    const arr = byTrace.get(traceId) || [];
    arr.push(e);
    byTrace.set(traceId, arr);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [traceId, events] of byTrace) {
      // Upsert trace row
      await client.query(
        `INSERT INTO traces (trace_id, inserted_at, updated_at, event_count, total_bytes)
         VALUES ($1, NOW(), NOW(), 0, 0)
         ON CONFLICT (trace_id) DO UPDATE SET updated_at = NOW()`,
        [traceId]
      );
      // Insert events
      const rows = events.map((e) => {
        const raw = JSON.stringify({ ...e, receivedAt });
        return [traceId, e.type, raw];
      });
      // Batch insert with unnest for efficiency
      const sql = `
        INSERT INTO events (trace_id, event_type, raw)
        SELECT * FROM unnest($1::text[], $2::text[], $3::jsonb[])
      `;
      const traceIds = rows.map((r) => r[0]);
      const types = rows.map((r) => r[1]);
      const raws = rows.map((r) => JSON.parse(r[2]));
      await client.query(sql, [traceIds, types, raws]);
      // Update counters
      await client.query(
        `UPDATE traces SET event_count = (SELECT count(*) FROM events WHERE trace_id = $1),
                          total_bytes  = (SELECT COALESCE(sum(octet_length(raw::text)), 0)::bigint FROM events WHERE trace_id = $1)
         WHERE trace_id = $1`,
        [traceId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("postgres write error", err);
    return json(res, 500, { error: "db write failed", detail: String(err.message) });
  } finally {
    client.release();
  }

  return json(res, 202, { accepted: body.events.length, traces: [...byTrace.keys()] });
};

const handleListTraces = async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT trace_id AS "traceId",
            event_count AS "eventCount",
            total_bytes AS "bytes",
            updated_at AT TIME ZONE 'UTC' AS "mtime"
     FROM traces ORDER BY updated_at DESC`
  );
  return json(res, 200, { traces: rows });
};

const handleDeleteTrace = async (_req, res, traceId) => {
  if (!SAFE_ID.test(traceId)) return json(res, 400, { error: "bad traceId" });
  const { rowCount } = await pool.query(`DELETE FROM traces WHERE trace_id = $1`, [traceId]);
  if (rowCount === 0) return json(res, 404, { error: "not found" });
  return json(res, 200, { deleted: traceId });
};

const handleGetTrace = async (_req, res, traceId) => {
  if (!SAFE_ID.test(traceId)) return json(res, 400, { error: "bad traceId" });

  const { rows } = await pool.query(
    `SELECT raw FROM events WHERE trace_id = $1 ORDER BY id ASC`,
    [traceId]
  );
  if (rows.length === 0) {
    // Check if trace exists at all
    const { rowCount } = await pool.query(`SELECT 1 FROM traces WHERE trace_id = $1`, [traceId]);
    if (rowCount === 0) return json(res, 404, { error: "not found" });
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.write('{"traceId":' + JSON.stringify(traceId) + ',"events":[');
  let first = true;
  for (const row of rows) {
    res.write((first ? "" : ",") + JSON.stringify(row.raw));
    first = false;
  }
  res.end("]}");
};

const PREVIEW_CHARS = 200;

// Strip heavy fields from an event for the summary payload.
// Drops nested `raw` (full message duplicate) and replaces `text` with a short preview.
const toSummary = (raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const { text, raw: nested, ...rest } = raw;
  const out = { ...rest };
  if (text != null) {
    const s = String(text);
    out.textPreview = s.slice(0, PREVIEW_CHARS);
    out.textLength = s.length;
  }
  return out;
};

const handleGetTraceSummary = async (req, res, traceId) => {
  if (!SAFE_ID.test(traceId)) return json(res, 400, { error: "bad traceId" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sinceStr = url.searchParams.get("since");
  const since = sinceStr ? Number(sinceStr) : 0;
  if (!Number.isFinite(since) || since < 0) return json(res, 400, { error: "bad since" });

  if (since === 0) {
    const { rowCount } = await pool.query(`SELECT 1 FROM traces WHERE trace_id = $1`, [traceId]);
    if (rowCount === 0) return json(res, 404, { error: "not found" });
  }

  const { rows } = await pool.query(
    `SELECT id, raw FROM events WHERE trace_id = $1 AND id > $2 ORDER BY id ASC`,
    [traceId, since]
  );
  const events = rows.map((r) => ({ id: Number(r.id), ...toSummary(r.raw) }));
  const cursor = rows.length ? Number(rows[rows.length - 1].id) : since;
  return json(res, 200, { traceId, events, cursor });
};

const handleGetEvent = async (_req, res, traceId, uuid) => {
  if (!SAFE_ID.test(traceId)) return json(res, 400, { error: "bad traceId" });
  if (!SAFE_ID.test(uuid)) return json(res, 400, { error: "bad uuid" });
  const { rows } = await pool.query(
    `SELECT raw FROM events WHERE trace_id = $1 AND raw->>'uuid' = $2 LIMIT 1`,
    [traceId, uuid]
  );
  if (!rows.length) return json(res, 404, { error: "not found" });
  return json(res, 200, { traceId, uuid, event: rows[0].raw });
};

const ensureSchema = async () => {
  try {
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_events_trace_uuid ON events (trace_id, ((raw->>'uuid')))`
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        repo_tag      TEXT        NOT NULL,
        session_id    TEXT,
        trace_id      TEXT        REFERENCES traces(trace_id) ON DELETE SET NULL,
        kind          TEXT        NOT NULL DEFAULT 'session_summary',
        summary       TEXT        NOT NULL,
        meta          JSONB       NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_repo_recency ON memories (repo_tag, created_at DESC)`
    );
    // Code graph subsystem
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codegraph_repos (
        repo_tag       TEXT PRIMARY KEY,
        root_path      TEXT NOT NULL,
        commit_sha     TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        status_error   TEXT,
        file_count     INT  NOT NULL DEFAULT 0,
        symbol_count   INT  NOT NULL DEFAULT 0,
        lang_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
        indexed_at     TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codegraph_files (
        id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        repo_tag   TEXT NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
        path       TEXT NOT NULL,
        language   TEXT NOT NULL,
        size_bytes INT,
        sha256     TEXT,
        UNIQUE (repo_tag, path)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_files_repo ON codegraph_files(repo_tag)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codegraph_symbols (
        id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        repo_tag       TEXT   NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
        file_id        BIGINT NOT NULL REFERENCES codegraph_files(id)       ON DELETE CASCADE,
        name           TEXT   NOT NULL,
        qualified_name TEXT,
        kind           TEXT   NOT NULL,
        start_line     INT    NOT NULL,
        end_line       INT    NOT NULL,
        signature      TEXT,
        docstring      TEXT
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_symbols_file ON codegraph_symbols(file_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_symbols_name ON codegraph_symbols(repo_tag, name)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codegraph_imports (
        id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        repo_tag        TEXT   NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
        from_file_id    BIGINT NOT NULL REFERENCES codegraph_files(id)       ON DELETE CASCADE,
        to_file_id      BIGINT          REFERENCES codegraph_files(id)       ON DELETE CASCADE,
        external_module TEXT,
        CHECK (to_file_id IS NOT NULL OR external_module IS NOT NULL)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_imports_from ON codegraph_imports(from_file_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_imports_to   ON codegraph_imports(to_file_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codegraph_calls (
        id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        repo_tag       TEXT   NOT NULL REFERENCES codegraph_repos(repo_tag) ON DELETE CASCADE,
        from_symbol_id BIGINT NOT NULL REFERENCES codegraph_symbols(id)     ON DELETE CASCADE,
        to_symbol_id   BIGINT          REFERENCES codegraph_symbols(id)     ON DELETE CASCADE,
        external_name  TEXT,
        call_site_line INT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_calls_from ON codegraph_calls(from_symbol_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codegraph_calls_to   ON codegraph_calls(to_symbol_id)`);

    // pgvector for semantic symbol search (requires pgvector/pgvector image).
    // CREATE EXTENSION is idempotent; ALTER … ADD COLUMN IF NOT EXISTS handles
    // upgrades from earlier installs that lacked the column.
    try {
      await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      await pool.query(`ALTER TABLE codegraph_symbols ADD COLUMN IF NOT EXISTS embedding vector(384)`);
      // ivfflat is fine for 1M+ rows; for our typical scale a brute-force scan
      // is fast enough, so skip the ANN index for now (it requires picking a
      // good `lists` parameter post-data).
    } catch (e) {
      console.warn("pgvector setup skipped:", e.message);
    }
  } catch (e) {
    console.warn("ensureSchema failed:", e.message);
  }
};

// ─────────────────────────── memory: distillation ───────────────────────────

const DISTILL_PROMPT = `You distill a Claude Code coding session into a brief memory note that the NEXT session in this repo will read cold, with no other state.

OUTPUT FORMAT — produce EXACTLY this skeleton, no preamble, no other sections:

## Goal
<one sentence — what the session was trying to accomplish>

## Decisions
- <one-line decision with one-line rationale>
- ...

## Files touched
- \`path/to/file.ext\` — <one-line what changed>
- ...

## Open threads
- <unfinished thing or follow-up>
- ...

## Gotchas
- <surprise, error, pitfall>
- ...

RULES
- 250 words MAX. Hard cap.
- Third-person, declarative facts. "Added X" not "I added X" not "We added X".
- File paths in inline code only (\`like/this.mjs\`).
- If a section has nothing, write a single \`—\` on its own line beneath the header.
- Stop after Gotchas. No notes, comments, appendices.

FORBIDDEN in output (these mean the summary failed):
- Line numbers, e.g. \`320 await client.query(...)\`.
- Tool-use ids (\`toolu_...\`).
- Literal \`tool_result\` or \`tool_use\` strings.
- File contents, transcript fragments, multi-line code blocks, code fences.
- The words "the user", "we", "I", "let me", "you".
- First-person commentary or thinking-aloud ("Wait, let me…", "I'll check…").

The transcript may contain noisy tool output. Ignore it. Extract only the *outcomes*: what was decided, what changed, what's left.`;

const TRANSCRIPT_CHAR_LIMIT = 30_000;
const TRANSCRIPT_ROW_LIMIT = 500;
const TOOL_RESULT_PREFIX_RE = /^\[tool_result\s+\S+\]\s*/;
const COMMAND_TAG_RE = /<\/?(local-command-caveat|command-name|command-message|command-args|local-command-stdout)[^>]*>/g;
const NUMERIC_LINE_RE = /^\s*\d{1,5}\s/;
const NOISE_KINDS = new Set(["custom-title", "file-history-snapshot", "attachment", "system"]);

const cleanTranscriptText = (text, role) => {
  let t = text;
  if (role === "user") {
    t = t.replace(TOOL_RESULT_PREFIX_RE, "[tool_result] ").replace(COMMAND_TAG_RE, "").trim();
    if (!t) return "";
    if (t.length > 400) {
      const lines = t.split("\n");
      const numericLines = lines.filter((l) => NUMERIC_LINE_RE.test(l)).length;
      if (numericLines >= 3 || t.length > 800) {
        const head = t.slice(0, 200).replace(/\s+/g, " ");
        t = `${head} … [+${t.length - 200} chars omitted]`;
      }
    }
  } else if (role === "assistant") {
    if (t.length > 2000) t = t.slice(0, 2000) + " … [truncated]";
  }
  return t.trim();
};

const assembleTranscript = (rows) => {
  const lines = [];
  for (const { raw } of rows) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.type !== "transcript.line") continue;
    const role = raw.role || raw.kind || "?";
    if (NOISE_KINDS.has(role)) continue;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) continue;
    const cleaned = cleanTranscriptText(text, role);
    if (!cleaned) continue;
    lines.push(`${role}: ${cleaned}`);
  }
  let joined = lines.join("\n\n");
  if (joined.length > TRANSCRIPT_CHAR_LIMIT) {
    joined = joined.slice(joined.length - TRANSCRIPT_CHAR_LIMIT);
  }
  return { transcript: joined, lineCount: lines.length };
};

const SUMMARY_DUMP_PATTERNS = [
  /\btoolu_[A-Za-z0-9]{8,}/,
  /\[tool_result\b/i,
  /^[ \t]*\d{1,5}[ \t]+\S/m,
];
const looksLikeDump = (text) => SUMMARY_DUMP_PATTERNS.some((rx) => rx.test(text));

const callOpenCode = async (transcript) => {
  if (!OPENCODE_KEY) throw new Error("OPENCODE_GO_API_KEY not set");
  const res = await fetch(`${OPENCODE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENCODE_KEY}`,
    },
    body: JSON.stringify({
      model: OPENCODE_MODEL,
      messages: [
        { role: "system", content: DISTILL_PROMPT },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`opencode ${res.status}: ${detail.slice(0, 200)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("opencode returned empty completion");
  }
  return { summary: content.trim(), usage: body.usage || null };
};

const produceSummary = async (traceId) => {
  const { rows } = await pool.query(
    `SELECT raw FROM events WHERE trace_id = $1 ORDER BY id ASC LIMIT $2`,
    [traceId, TRANSCRIPT_ROW_LIMIT]
  );
  if (!rows.length) throw new Error("no events for trace");
  const { transcript, lineCount } = assembleTranscript(rows);
  if (!transcript) throw new Error("empty transcript");
  const { summary, usage } = await callOpenCode(transcript);
  const meta = {
    line_count: lineCount,
    char_count: transcript.length,
    model: OPENCODE_MODEL,
    usage,
  };
  if (looksLikeDump(summary)) {
    meta.quality_warning = "dump_pattern_detected";
  }
  return { summary, meta };
};

// Parse a distilled memory summary into structured entities.
// The distill prompt produces a fixed skeleton with five `## ` sections.
// Empty sections contain a single `—`.
const SECTION_HEADERS = ["Goal", "Decisions", "Files touched", "Open threads", "Gotchas"];
const BACKTICK_RE = /`([^`\n]+)`/g;

// Match `## Goal`, `### Goal`, `**Goal**`, `**Goal:**`, or inline `**Goal** —`.
// The distill prompt asks for `##` headers on their own line, but the model
// occasionally produces bold variants or even inline `**Goal** — content`.
const HEADER_RE = /(?:^|\n)[ \t]*(?:#{2,4}[ \t]+|\*\*[ \t]*)(Goal|Decisions|Files touched|Open threads|Gotchas)(?:[ \t]*\*\*)?[ \t]*[:\-—]?[ \t]*/gi;

const splitSections = (summary) => {
  const sections = {};
  const matches = [];
  let m;
  HEADER_RE.lastIndex = 0;
  while ((m = HEADER_RE.exec(summary)) !== null) {
    matches.push({ name: m[1], end: HEADER_RE.lastIndex, start: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const next = matches[i + 1];
    const body = summary.slice(matches[i].end, next ? next.start : undefined).trim();
    const canonical = SECTION_HEADERS.find((h) => h.toLowerCase() === matches[i].name.toLowerCase());
    if (canonical) sections[canonical] = body;
  }
  return sections;
};

const isEmptySection = (body) => !body || body === "—" || body === "-";

const parseBullets = (body) => {
  if (isEmptySection(body)) return [];
  const out = [];
  for (const raw of body.split("\n")) {
    const m = /^\s*-\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    // Strip surrounding backticks if the bullet is just `code`.
    const text = m[1].replace(/\s+/g, " ").trim();
    if (text && text !== "—") out.push(text);
  }
  return out;
};

const parseFiles = (body) => {
  if (isEmptySection(body)) return [];
  const seen = new Set();
  const out = [];
  let m;
  BACKTICK_RE.lastIndex = 0;
  while ((m = BACKTICK_RE.exec(body))) {
    let p = m[1].trim();
    // Tokens with whitespace aren't single paths (e.g. `PATCH /memory/:id`).
    if (/\s/.test(p)) continue;
    if (p.startsWith("./")) p = p.slice(2);
    const hasExt = /\.[a-zA-Z0-9]{1,8}$/.test(p);
    // API/route paths usually start with `/` and lack a file extension.
    if (p.startsWith("/") && !hasExt) continue;
    // Need either a slash or a file extension to look like a path.
    if (!p || (!p.includes("/") && !hasExt)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
};

const parseGoal = (body) => {
  if (isEmptySection(body)) return "";
  // Take the first non-empty line.
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t && t !== "—") return t;
  }
  return "";
};

const parseSummary = (summary) => {
  const sections = splitSections(summary || "");
  return {
    goal: parseGoal(sections["Goal"] || ""),
    files: parseFiles(sections["Files touched"] || ""),
    decisions: parseBullets(sections["Decisions"] || ""),
    threads: parseBullets(sections["Open threads"] || ""),
    gotchas: parseBullets(sections["Gotchas"] || ""),
  };
};

const distillSession = async (traceId, repoTag, sessionId) => {
  try {
    const { summary, meta } = await produceSummary(traceId);
    if (meta.quality_warning) {
      console.warn(`distill ${sessionId}: summary appears to be a transcript dump`);
    }
    await pool.query(
      `INSERT INTO memories (repo_tag, session_id, trace_id, summary, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [repoTag, sessionId, traceId, summary, meta]
    );
    console.log(`distill ${sessionId}: stored ${summary.length} chars for ${repoTag}`);
  } catch (e) {
    console.error(`distill ${sessionId} failed:`, e.message);
  }
};

const handleGetMemoryRecent = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const repo = url.searchParams.get("repo");
  const defaultLimit = repo ? 3 : 20;
  const maxLimit = repo ? 10 : 100;
  const limitRaw = Number(url.searchParams.get("limit") || defaultLimit);
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : defaultLimit));
  const { rows } = repo
    ? await pool.query(
        `SELECT id, repo_tag, kind, summary, created_at, session_id, trace_id, meta
           FROM memories
          WHERE repo_tag = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [repo, limit]
      )
    : await pool.query(
        `SELECT id, repo_tag, kind, summary, created_at, session_id, trace_id, meta
           FROM memories
          ORDER BY created_at DESC
          LIMIT $1`,
        [limit]
      );
  return json(res, 200, {
    memories: rows.map((r) => ({
      id: Number(r.id),
      repoTag: r.repo_tag,
      kind: r.kind,
      summary: r.summary,
      createdAt: r.created_at,
      sessionId: r.session_id,
      traceId: r.trace_id,
      meta: r.meta,
    })),
  });
};

const handleGetMemoryProjects = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const { rows } = await pool.query(
    `SELECT repo_tag,
            COUNT(*)::int                                     AS memory_count,
            MAX(created_at)                                   AS latest_created_at,
            (SELECT summary FROM memories m2
              WHERE m2.repo_tag = m.repo_tag
              ORDER BY created_at DESC LIMIT 1)               AS latest_summary
       FROM memories m
      GROUP BY repo_tag
      ORDER BY latest_created_at DESC`
  );
  return json(res, 200, {
    projects: rows.map((r) => ({
      repoTag: r.repo_tag,
      memoryCount: r.memory_count,
      latestCreatedAt: r.latest_created_at,
      latestSummary: r.latest_summary,
    })),
  });
};

const truncateLabel = (s, n) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const handleGetMemoryGraph = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const repo = url.searchParams.get("repo");
  const limitRaw = Number(url.searchParams.get("limit") || 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

  const { rows } = repo
    ? await pool.query(
        `SELECT id, repo_tag, summary, created_at, session_id, trace_id
           FROM memories
          WHERE repo_tag = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [repo, limit]
      )
    : await pool.query(
        `SELECT id, repo_tag, summary, created_at, session_id, trace_id
           FROM memories
          ORDER BY created_at DESC
          LIMIT $1`,
        [limit]
      );

  const nodes = [];
  const edges = [];
  const repoCounts = new Map();
  const fileNodes = new Map();   // path → { id, count }
  const memCount = rows.length;

  for (const r of rows) {
    const memId = `mem:${r.id}`;
    const repoId = `repo:${r.repo_tag}`;
    const parsed = parseSummary(r.summary);

    repoCounts.set(r.repo_tag, (repoCounts.get(r.repo_tag) || 0) + 1);

    const memLabel = parsed.goal ? truncateLabel(parsed.goal, 60) : `memory #${r.id}`;
    nodes.push({
      id: memId,
      kind: "memory",
      label: memLabel,
      repoTag: r.repo_tag,
      memoryId: Number(r.id),
      goal: parsed.goal,
      createdAt: r.created_at,
      traceId: r.trace_id,
      sessionId: r.session_id,
    });
    edges.push({ source: memId, target: repoId, kind: "member" });

    for (const path of parsed.files) {
      const fileId = `file:${path}`;
      const existing = fileNodes.get(path);
      if (existing) existing.count += 1;
      else fileNodes.set(path, { id: fileId, count: 1, label: path });
      edges.push({ source: memId, target: fileId, kind: "touched" });
    }

    parsed.decisions.forEach((text, i) => {
      const id = `decision:${r.id}:${i}`;
      nodes.push({ id, kind: "decision", label: truncateLabel(text, 80), text, memoryId: Number(r.id) });
      edges.push({ source: memId, target: id, kind: "decided" });
    });
    parsed.threads.forEach((text, i) => {
      const id = `thread:${r.id}:${i}`;
      nodes.push({ id, kind: "thread", label: truncateLabel(text, 80), text, memoryId: Number(r.id) });
      edges.push({ source: memId, target: id, kind: "thread" });
    });
    parsed.gotchas.forEach((text, i) => {
      const id = `gotcha:${r.id}:${i}`;
      nodes.push({ id, kind: "gotcha", label: truncateLabel(text, 80), text, memoryId: Number(r.id) });
      edges.push({ source: memId, target: id, kind: "gotcha" });
    });
  }

  // Repo hubs
  for (const [repoTag, count] of repoCounts) {
    nodes.push({
      id: `repo:${repoTag}`,
      kind: "repo",
      label: repoTag,
      memoryCount: count,
    });
  }

  // File hubs
  for (const { id, count, label } of fileNodes.values()) {
    nodes.push({ id, kind: "file", label, count });
  }

  return json(res, 200, {
    nodes,
    edges,
    stats: {
      memoryCount: memCount,
      repoCount: repoCounts.size,
      fileCount: fileNodes.size,
    },
  });
};

const handleGetMemoryById = async (req, res, idStr) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "bad id" });
  const { rows } = await pool.query(
    `SELECT id, repo_tag, kind, summary, created_at, session_id, trace_id, meta
       FROM memories
      WHERE id = $1`,
    [id]
  );
  if (!rows.length) return json(res, 404, { error: "not_found" });
  const r = rows[0];
  return json(res, 200, {
    memory: {
      id: Number(r.id),
      repoTag: r.repo_tag,
      kind: r.kind,
      summary: r.summary,
      createdAt: r.created_at,
      sessionId: r.session_id,
      traceId: r.trace_id,
      meta: r.meta,
    },
  });
};

const handleDeleteMemory = async (req, res, idStr) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "bad id" });
  const { rowCount } = await pool.query(`DELETE FROM memories WHERE id = $1`, [id]);
  if (rowCount === 0) return json(res, 404, { error: "not_found" });
  return json(res, 200, { deleted: id });
};

const handlePatchMemory = async (req, res, idStr) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "bad id" });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, 400, { error: "invalid json", detail: String(e.message) });
  }
  if (typeof body?.summary !== "string" || !body.summary.trim()) {
    return json(res, 400, { error: "summary required" });
  }
  const { rows, rowCount } = await pool.query(
    `UPDATE memories SET summary = $1 WHERE id = $2
     RETURNING id, repo_tag, kind, summary, created_at, session_id, trace_id, meta`,
    [body.summary, id]
  );
  if (!rowCount) return json(res, 404, { error: "not_found" });
  const r = rows[0];
  return json(res, 200, {
    memory: {
      id: Number(r.id),
      repoTag: r.repo_tag,
      kind: r.kind,
      summary: r.summary,
      createdAt: r.created_at,
      sessionId: r.session_id,
      traceId: r.trace_id,
      meta: r.meta,
    },
  });
};

const handlePostMemoryRedistill = async (req, res, idStr) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "bad id" });
  const { rows: memRows } = await pool.query(
    `SELECT id, repo_tag, session_id, trace_id, kind FROM memories WHERE id = $1`,
    [id]
  );
  if (!memRows.length) return json(res, 404, { error: "not_found" });
  const m = memRows[0];
  if (!m.trace_id) return json(res, 422, { error: "memory has no trace_id" });
  let summary, meta;
  try {
    ({ summary, meta } = await produceSummary(m.trace_id));
  } catch (e) {
    return json(res, 502, { error: "distill_failed", detail: String(e.message) });
  }
  const { rows: updRows } = await pool.query(
    `UPDATE memories SET summary = $1, meta = $2, created_at = NOW() WHERE id = $3
     RETURNING id, repo_tag, kind, summary, created_at, session_id, trace_id, meta`,
    [summary, meta, id]
  );
  const r = updRows[0];
  return json(res, 200, {
    memory: {
      id: Number(r.id),
      repoTag: r.repo_tag,
      kind: r.kind,
      summary: r.summary,
      createdAt: r.created_at,
      sessionId: r.session_id,
      traceId: r.trace_id,
      meta: r.meta,
    },
  });
};

const handlePostMemoryDistill = async (req, res, sessionId) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  if (!SAFE_ID.test(sessionId)) return json(res, 400, { error: "bad sessionId" });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, 400, { error: "invalid json", detail: String(e.message) });
  }
  const repoTag = typeof body?.repo_tag === "string" ? body.repo_tag.trim() : "";
  const traceId = typeof body?.trace_id === "string" ? body.trace_id.trim() : "";
  if (!repoTag) return json(res, 400, { error: "repo_tag required" });
  if (!SAFE_ID.test(traceId)) return json(res, 400, { error: "bad trace_id" });

  // Fire-and-forget; respond immediately.
  setImmediate(() => {
    distillSession(traceId, repoTag, sessionId).catch((e) =>
      console.error("distill background error:", e)
    );
  });
  return json(res, 202, { status: "queued", sessionId });
};

// ─────────────────────────── codegraph ───────────────────────────────

const repoTagRow = (r) => ({
  repoTag: r.repo_tag,
  rootPath: r.root_path,
  commitSha: r.commit_sha,
  status: r.status,
  statusError: r.status_error,
  fileCount: r.file_count,
  symbolCount: r.symbol_count,
  langBreakdown: r.lang_breakdown || {},
  indexedAt: r.indexed_at,
  createdAt: r.created_at,
});

const handlePostCodegraphIndex = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (e) { return json(res, 400, { error: "invalid json", detail: String(e.message) }); }
  const repoTag = typeof body?.repoTag === "string" ? body.repoTag.trim() : "";
  const rootPath = typeof body?.path === "string" ? body.path.trim() : "";
  if (!repoTag) return json(res, 400, { error: "repoTag required" });
  if (!rootPath) return json(res, 400, { error: "path required" });

  await pool.query(
    `INSERT INTO codegraph_repos (repo_tag, root_path, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (repo_tag) DO UPDATE
       SET root_path = EXCLUDED.root_path,
           status = 'pending',
           status_error = NULL`,
    [repoTag, rootPath]
  );

  setImmediate(() => {
    indexRepo(pool, repoTag, rootPath).catch((e) =>
      console.error(`codegraph index ${repoTag} background error:`, e)
    );
  });

  return json(res, 202, { status: "queued", repoTag });
};

const handleGetCodegraphRepos = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const { rows } = await pool.query(
    `SELECT repo_tag, root_path, commit_sha, status, status_error, file_count,
            symbol_count, lang_breakdown, indexed_at, created_at
       FROM codegraph_repos
      ORDER BY COALESCE(indexed_at, created_at) DESC`
  );
  return json(res, 200, { repos: rows.map(repoTagRow) });
};

const handleGetCodegraphRepo = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tag = url.searchParams.get("tag");
  if (!tag) return json(res, 400, { error: "tag required" });
  const { rows } = await pool.query(
    `SELECT repo_tag, root_path, commit_sha, status, status_error, file_count,
            symbol_count, lang_breakdown, indexed_at, created_at
       FROM codegraph_repos WHERE repo_tag = $1`,
    [tag]
  );
  if (!rows.length) return json(res, 404, { error: "not_found" });
  return json(res, 200, { repo: repoTagRow(rows[0]) });
};

const handleDeleteCodegraphRepo = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tag = url.searchParams.get("tag");
  if (!tag) return json(res, 400, { error: "tag required" });
  const { rowCount } = await pool.query(`DELETE FROM codegraph_repos WHERE repo_tag = $1`, [tag]);
  if (!rowCount) return json(res, 404, { error: "not_found" });
  return json(res, 200, { deleted: tag });
};

const handlePostCodegraphReindex = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tag = url.searchParams.get("tag");
  if (!tag) return json(res, 400, { error: "tag required" });
  const { rows } = await pool.query(
    `SELECT root_path FROM codegraph_repos WHERE repo_tag = $1`,
    [tag]
  );
  if (!rows.length) return json(res, 404, { error: "not_found" });
  const rootPath = rows[0].root_path;
  await pool.query(
    `UPDATE codegraph_repos SET status='pending', status_error=NULL WHERE repo_tag = $1`,
    [tag]
  );
  setImmediate(() => {
    indexRepo(pool, tag, rootPath).catch((e) =>
      console.error(`codegraph reindex ${tag} background error:`, e)
    );
  });
  return json(res, 202, { status: "queued", repoTag: tag });
};

const handleGetCodegraphFiles = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tag = url.searchParams.get("tag");
  if (!tag) return json(res, 400, { error: "tag required" });
  const { rows } = await pool.query(
    `SELECT f.id, f.path, f.language, f.size_bytes,
            (SELECT COUNT(*) FROM codegraph_symbols s WHERE s.file_id = f.id)::int AS symbol_count
       FROM codegraph_files f
      WHERE f.repo_tag = $1
      ORDER BY f.path ASC`,
    [tag]
  );
  return json(res, 200, {
    files: rows.map((r) => ({
      id: Number(r.id),
      path: r.path,
      language: r.language,
      sizeBytes: r.size_bytes,
      symbolCount: r.symbol_count,
    })),
  });
};

const handleGetCodegraphSymbols = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const fileId = Number(url.searchParams.get("fileId"));
  if (!Number.isInteger(fileId) || fileId <= 0) return json(res, 400, { error: "fileId required" });
  const { rows } = await pool.query(
    `SELECT id, name, qualified_name, kind, start_line, end_line, signature, docstring
       FROM codegraph_symbols WHERE file_id = $1 ORDER BY start_line ASC`,
    [fileId]
  );
  return json(res, 200, {
    symbols: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      qualifiedName: r.qualified_name,
      kind: r.kind,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      docstring: r.docstring,
    })),
  });
};

const handleGetCodegraphSymbol = async (req, res, idStr) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "bad id" });

  const { rows } = await pool.query(
    `SELECT s.id, s.repo_tag, s.name, s.qualified_name, s.kind, s.start_line, s.end_line,
            s.signature, s.docstring, s.file_id, f.path AS file_path, f.language
       FROM codegraph_symbols s
       JOIN codegraph_files   f ON f.id = s.file_id
      WHERE s.id = $1`,
    [id]
  );
  if (!rows.length) return json(res, 404, { error: "not_found" });
  const s = rows[0];

  const callersQ = await pool.query(
    `SELECT c.call_site_line, src.id AS sym_id, src.name, src.qualified_name, src.kind,
            f.id AS file_id, f.path AS file_path
       FROM codegraph_calls c
       JOIN codegraph_symbols src ON src.id = c.from_symbol_id
       JOIN codegraph_files f      ON f.id = src.file_id
      WHERE c.to_symbol_id = $1
      ORDER BY f.path, c.call_site_line
      LIMIT 200`,
    [id]
  );
  const calleesQ = await pool.query(
    `SELECT c.call_site_line, c.external_name,
            tgt.id AS sym_id, tgt.name, tgt.qualified_name, tgt.kind,
            tf.id AS file_id, tf.path AS file_path
       FROM codegraph_calls c
       LEFT JOIN codegraph_symbols tgt ON tgt.id = c.to_symbol_id
       LEFT JOIN codegraph_files   tf  ON tf.id = tgt.file_id
      WHERE c.from_symbol_id = $1
      ORDER BY c.call_site_line
      LIMIT 200`,
    [id]
  );

  return json(res, 200, {
    symbol: {
      id: Number(s.id),
      repoTag: s.repo_tag,
      name: s.name,
      qualifiedName: s.qualified_name,
      kind: s.kind,
      startLine: s.start_line,
      endLine: s.end_line,
      signature: s.signature,
      docstring: s.docstring,
      file: { id: Number(s.file_id), path: s.file_path, language: s.language },
    },
    callers: callersQ.rows.map((r) => ({
      line: r.call_site_line,
      symbolId: Number(r.sym_id),
      name: r.name,
      qualifiedName: r.qualified_name,
      kind: r.kind,
      fileId: Number(r.file_id),
      filePath: r.file_path,
    })),
    callees: calleesQ.rows.map((r) => ({
      line: r.call_site_line,
      symbolId: r.sym_id ? Number(r.sym_id) : null,
      name: r.name || r.external_name,
      qualifiedName: r.qualified_name,
      kind: r.kind || null,
      fileId: r.file_id ? Number(r.file_id) : null,
      filePath: r.file_path || null,
      external: !r.sym_id,
    })),
  });
};

const handleGetCodegraphSearch = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tag = url.searchParams.get("tag");
  const q = url.searchParams.get("q");
  const mode = url.searchParams.get("mode") || "name";
  if (!tag) return json(res, 400, { error: "tag required" });
  if (!q || q.length < 2) return json(res, 400, { error: "q must be at least 2 chars" });

  if (mode === "semantic") {
    let vec;
    try { vec = await embedQuery(q); }
    catch (e) { return json(res, 503, { error: "embedder unavailable", detail: String(e.message) }); }
    const literal = vectorLiteral(vec);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.qualified_name, s.kind, s.start_line,
              f.id AS file_id, f.path AS file_path, f.language,
              (s.embedding <=> $2::vector) AS distance
         FROM codegraph_symbols s
         JOIN codegraph_files   f ON f.id = s.file_id
        WHERE s.repo_tag = $1 AND s.embedding IS NOT NULL
        ORDER BY s.embedding <=> $2::vector
        LIMIT 30`,
      [tag, literal]
    );
    return json(res, 200, {
      mode: "semantic",
      results: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        qualifiedName: r.qualified_name,
        kind: r.kind,
        startLine: r.start_line,
        fileId: Number(r.file_id),
        filePath: r.file_path,
        language: r.language,
        distance: Number(r.distance),
      })),
    });
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.qualified_name, s.kind, s.start_line,
            f.id AS file_id, f.path AS file_path, f.language
       FROM codegraph_symbols s
       JOIN codegraph_files   f ON f.id = s.file_id
      WHERE s.repo_tag = $1 AND s.name ILIKE $2
      ORDER BY s.name ASC
      LIMIT 50`,
    [tag, q + "%"]
  );
  return json(res, 200, {
    mode: "name",
    results: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      qualifiedName: r.qualified_name,
      kind: r.kind,
      startLine: r.start_line,
      fileId: Number(r.file_id),
      filePath: r.file_path,
      language: r.language,
    })),
  });
};

// File-level graph: nodes = files (with symbol counts), edges = imports
// (file→file from codegraph_imports) and aggregated cross-file calls
// (file→file with a count, derived from codegraph_calls). External imports
// and unresolved calls are dropped — they have no target node to connect to.
const handleGetCodegraphRepoEdges = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tag = url.searchParams.get("tag");
  if (!tag) return json(res, 400, { error: "tag required" });

  const filesQ = await pool.query(
    `SELECT f.id, f.path, f.language,
            (SELECT COUNT(*) FROM codegraph_symbols s WHERE s.file_id = f.id)::int AS symbol_count
       FROM codegraph_files f
      WHERE f.repo_tag = $1
      ORDER BY f.path ASC`,
    [tag]
  );
  const importsQ = await pool.query(
    `SELECT from_file_id, to_file_id
       FROM codegraph_imports
      WHERE repo_tag = $1 AND to_file_id IS NOT NULL`,
    [tag]
  );
  const callsQ = await pool.query(
    `SELECT src.file_id AS from_file_id, tgt.file_id AS to_file_id, COUNT(*)::int AS n
       FROM codegraph_calls c
       JOIN codegraph_symbols src ON src.id = c.from_symbol_id
       JOIN codegraph_symbols tgt ON tgt.id = c.to_symbol_id
      WHERE c.repo_tag = $1
        AND src.file_id <> tgt.file_id
      GROUP BY src.file_id, tgt.file_id`,
    [tag]
  );

  return json(res, 200, {
    nodes: filesQ.rows.map((r) => ({
      id: Number(r.id),
      path: r.path,
      language: r.language,
      symbolCount: r.symbol_count,
    })),
    edges: [
      ...importsQ.rows.map((r) => ({
        kind: "import",
        source: Number(r.from_file_id),
        target: Number(r.to_file_id),
        weight: 1,
      })),
      ...callsQ.rows.map((r) => ({
        kind: "call",
        source: Number(r.from_file_id),
        target: Number(r.to_file_id),
        weight: Number(r.n),
      })),
    ],
  });
};

// Reachability via codegraph_calls. Returns up to MAX_DEPTH transitive
// callers (impact set) and callees (dependency set) for a symbol.
const handleGetCodegraphImpact = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = Number(url.searchParams.get("symbolId"));
  if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "symbolId required" });
  const maxDepth = Math.min(8, Number(url.searchParams.get("depth") || 4));

  // Callers = walk edges backward (anyone who calls us, transitively).
  // Callees = walk edges forward.
  const callersQ = await pool.query(
    `WITH RECURSIVE up(symbol_id, depth) AS (
       SELECT $1::bigint, 0
       UNION
       SELECT c.from_symbol_id, up.depth + 1
         FROM codegraph_calls c
         JOIN up ON c.to_symbol_id = up.symbol_id
        WHERE up.depth < $2
     )
     SELECT u.symbol_id, MIN(u.depth)::int AS depth,
            s.name, s.qualified_name, s.kind,
            f.id AS file_id, f.path AS file_path
       FROM up u
       JOIN codegraph_symbols s ON s.id = u.symbol_id
       JOIN codegraph_files   f ON f.id = s.file_id
      WHERE u.symbol_id <> $1::bigint
      GROUP BY u.symbol_id, s.name, s.qualified_name, s.kind, f.id, f.path
      ORDER BY depth ASC, s.name ASC
      LIMIT 200`,
    [id, maxDepth]
  );
  const calleesQ = await pool.query(
    `WITH RECURSIVE down(symbol_id, depth) AS (
       SELECT $1::bigint, 0
       UNION
       SELECT c.to_symbol_id, down.depth + 1
         FROM codegraph_calls c
         JOIN down ON c.from_symbol_id = down.symbol_id
        WHERE down.depth < $2 AND c.to_symbol_id IS NOT NULL
     )
     SELECT d.symbol_id, MIN(d.depth)::int AS depth,
            s.name, s.qualified_name, s.kind,
            f.id AS file_id, f.path AS file_path
       FROM down d
       JOIN codegraph_symbols s ON s.id = d.symbol_id
       JOIN codegraph_files   f ON f.id = s.file_id
      WHERE d.symbol_id <> $1::bigint
      GROUP BY d.symbol_id, s.name, s.qualified_name, s.kind, f.id, f.path
      ORDER BY depth ASC, s.name ASC
      LIMIT 200`,
    [id, maxDepth]
  );

  const map = (r) => ({
    symbolId: Number(r.symbol_id),
    depth: r.depth,
    name: r.name,
    qualifiedName: r.qualified_name,
    kind: r.kind,
    fileId: Number(r.file_id),
    filePath: r.file_path,
  });
  return json(res, 200, {
    symbolId: id,
    depth: maxDepth,
    callers: callersQ.rows.map(map),
    callees: calleesQ.rows.map(map),
  });
};

// Memories whose meta.files JSONB array contains this file's repo-relative path.
const handleGetCodegraphFileMemories = async (req, res) => {
  if (!authedOrLocal(req)) return json(res, 401, { error: "unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const fileId = Number(url.searchParams.get("fileId"));
  if (!Number.isInteger(fileId) || fileId <= 0) return json(res, 400, { error: "fileId required" });

  const fileQ = await pool.query(
    `SELECT f.id, f.path, f.repo_tag FROM codegraph_files f WHERE f.id = $1`,
    [fileId]
  );
  if (!fileQ.rows.length) return json(res, 404, { error: "file_not_found" });
  const f = fileQ.rows[0];

  // meta.files is written by distillSession as an array of repo-relative paths
  // (string[]). Match either exact path or basename to catch summaries that
  // recorded only the filename.
  const basename = f.path.split("/").pop();
  const { rows } = await pool.query(
    `SELECT id, repo_tag, session_id, kind, summary, created_at, meta
       FROM memories
      WHERE repo_tag = $1
        AND (
          meta->'files' @> $2::jsonb
          OR meta->'files' @> $3::jsonb
        )
      ORDER BY created_at DESC
      LIMIT 50`,
    [f.repo_tag, JSON.stringify([f.path]), JSON.stringify([basename])]
  );

  return json(res, 200, {
    file: { id: Number(f.id), path: f.path, repoTag: f.repo_tag },
    memories: rows.map((r) => ({
      id: Number(r.id),
      repoTag: r.repo_tag,
      sessionId: r.session_id,
      kind: r.kind,
      summary: r.summary,
      createdAt: r.created_at,
      meta: r.meta,
    })),
  });
};

// ─── Optimizer handlers ───────────────────────────────────────────────────────

const handleOptimizerAnalyze = async (req, res) => {
  const body = JSON.parse(await readBody(req));
  const { system, messages, tools } = body;
  const report = analyzePrompt({ system, messages, tools });
  return json(res, 200, report);
};

const handleOptimizerOptimize = async (req, res) => {
  const body = JSON.parse(await readBody(req));
  const { system, messages, tools, profile } = body;
  const result = applyOptimizations({ system, messages, tools }, profile);
  return json(res, 200, result);
};

const handleOptimizerExperiment = async (req, res) => {
  const body = JSON.parse(await readBody(req));
  const { system, messages, tools, profile, dryRun } = body;
  const result = await runExperiment({ system, messages, tools, profile, dryRun });
  return json(res, 200, result);
};

const handleOptimizerPipeline = async (req, res) => {
  const body = JSON.parse(await readBody(req));
  const { system, messages, tools, profile, query, keywords, sessionTurns, handoffCtx } = body;
  const result = runPipeline({ system, messages, tools, profile, query, keywords, sessionTurns, handoffCtx });
  return json(res, 200, result);
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if ((path === "/" || path === "/index.html") && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(DASHBOARD_HTML);
    }
    if (path === "/healthz" && req.method === "GET") {
      try {
        await pool.query("SELECT 1");
        return json(res, 200, { ok: true, db: "connected" });
      } catch {
        return json(res, 503, { ok: false, db: "disconnected" });
      }
    }
    if (path === "/ingest/events" && req.method === "POST") return handlePostEvents(req, res);
    if (path === "/optimizer/analyze" && req.method === "POST") return handleOptimizerAnalyze(req, res);
    if (path === "/optimizer/optimize" && req.method === "POST") return handleOptimizerOptimize(req, res);
    if (path === "/optimizer/experiment" && req.method === "POST") return handleOptimizerExperiment(req, res);
    if (path === "/optimizer/pipeline" && req.method === "POST") return handleOptimizerPipeline(req, res);
    if (path === "/traces" && req.method === "GET") return handleListTraces(req, res);
    if (path === "/memory/recent" && req.method === "GET") return handleGetMemoryRecent(req, res);
    if (path === "/memory/projects" && req.method === "GET") return handleGetMemoryProjects(req, res);
    if (path === "/memory/graph" && req.method === "GET") return handleGetMemoryGraph(req, res);

    if (path === "/codegraph/index" && req.method === "POST") return handlePostCodegraphIndex(req, res);
    if (path === "/codegraph/repos" && req.method === "GET") return handleGetCodegraphRepos(req, res);
    if (path === "/codegraph/repo" && req.method === "GET") return handleGetCodegraphRepo(req, res);
    if (path === "/codegraph/repo" && req.method === "DELETE") return handleDeleteCodegraphRepo(req, res);
    if (path === "/codegraph/repo/reindex" && req.method === "POST") return handlePostCodegraphReindex(req, res);
    if (path === "/codegraph/files" && req.method === "GET") return handleGetCodegraphFiles(req, res);
    if (path === "/codegraph/symbols" && req.method === "GET") return handleGetCodegraphSymbols(req, res);
    if (path === "/codegraph/search" && req.method === "GET") return handleGetCodegraphSearch(req, res);
    if (path === "/codegraph/repo/edges" && req.method === "GET") return handleGetCodegraphRepoEdges(req, res);
    if (path === "/codegraph/impact" && req.method === "GET") return handleGetCodegraphImpact(req, res);
    if (path === "/codegraph/file/memories" && req.method === "GET") return handleGetCodegraphFileMemories(req, res);

    const cgs = path.match(/^\/codegraph\/symbol\/(\d+)$/);
    if (cgs && req.method === "GET") return handleGetCodegraphSymbol(req, res, cgs[1]);

    const md = path.match(/^\/memory\/distill\/([^/]+)$/);
    if (md && req.method === "POST")
      return handlePostMemoryDistill(req, res, decodeURIComponent(md[1]));

    const mre = path.match(/^\/memory\/(\d+)\/redistill$/);
    if (mre && req.method === "POST")
      return handlePostMemoryRedistill(req, res, mre[1]);

    const mid = path.match(/^\/memory\/(\d+)$/);
    if (mid && req.method === "GET")
      return handleGetMemoryById(req, res, mid[1]);
    if (mid && req.method === "DELETE")
      return handleDeleteMemory(req, res, mid[1]);
    if (mid && req.method === "PATCH")
      return handlePatchMemory(req, res, mid[1]);

    const ms = path.match(/^\/traces\/([^/]+)\/summary$/);
    if (ms && req.method === "GET") return handleGetTraceSummary(req, res, decodeURIComponent(ms[1]));

    const me = path.match(/^\/traces\/([^/]+)\/events\/([^/]+)$/);
    if (me && req.method === "GET")
      return handleGetEvent(req, res, decodeURIComponent(me[1]), decodeURIComponent(me[2]));

    const m = path.match(/^\/traces\/([^/]+)$/);
    if (m && req.method === "GET") return handleGetTrace(req, res, decodeURIComponent(m[1]));
    if (m && req.method === "DELETE") return handleDeleteTrace(req, res, decodeURIComponent(m[1]));

    return json(res, 404, { error: "not found", path });
  } catch (err) {
    console.error("server error", err);
    return json(res, 500, { error: "internal", detail: String(err.message) });
  }
});

server.listen(PORT, async () => {
  console.log(`traceframe ingest listening on :${PORT}`);
  await ensureSchema();
});
