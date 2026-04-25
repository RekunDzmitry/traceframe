// traceframe ingest — Postgres-backed event store.
//
//   POST /ingest/events   Authorization: Bearer <key>
//       body: { events: Event[] }  → inserts into postgres
//   GET  /healthz
//   GET  /traces                 → [{ traceId, eventCount, bytes, updatedAt }]
//   GET  /traces/:id             → { traceId, events: Event[] }
//   DELETE /traces/:id           → deletes trace + events

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(__dirname, "dashboard.html"), "utf8");

const PORT = Number(process.env.PORT || 4000);
const API_KEY = process.env.TRACEFRAME_API_KEY;

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
  } catch (e) {
    console.warn("ensureSchema failed:", e.message);
  }
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
    if (path === "/traces" && req.method === "GET") return handleListTraces(req, res);

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
