// traceframe memory service — a small HTTP API over a pgvector-backed memory
// store, plus the prompt optimizer (pure, no network) and a static admin panel.
//
// Routes:
//   GET    /healthz
//   GET    /                      → admin panel
//   GET    /api/projects
//   GET    /api/memories?repo=&limit=
//   GET    /api/memories/:id
//   POST   /api/memories          { repo_tag, summary, kind?, meta? }
//   PATCH  /api/memories/:id       { summary }
//   DELETE /api/memories/:id
//   POST   /api/search            { query, repo_tag?, max_results? }
//   POST   /api/optimizer/analyze   { system, messages, tools }
//   POST   /api/optimizer/optimize  { ..., profile }
//   POST   /api/optimizer/pipeline  { ..., profile, query, keywords, sessionTurns }

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureSchema,
  ping,
  listProjects,
  listMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  searchMemories,
} from "./db.mjs";
import { analyzePrompt, applyOptimizations, runPipeline } from "./optimizer/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const API_KEY = process.env.TRACEFRAME_API_KEY || "";
// Loopback bypass for local dev. Disable with ALLOW_LOCALHOST=0 when running
// behind a reverse proxy, where every peer appears as 127.0.0.1.
const ALLOW_LOCALHOST = process.env.ALLOW_LOCALHOST !== "0";
const ADMIN_HTML = readFileSync(join(__dirname, "public", "admin.html"), "utf8");

if (!API_KEY) {
  console.warn(
    "⚠ TRACEFRAME_API_KEY is not set — token auth is disabled; only loopback requests will be accepted" +
      (ALLOW_LOCALHOST ? "." : " and ALLOW_LOCALHOST=0, so /api/* is fully locked down.")
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req, limit = 8 * 1024 * 1024) =>
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

const readJson = async (req) => {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
};

// Constant-time Bearer token check. Fails closed: never matches when no key is
// configured.
const tokenValid = (req) => {
  if (!API_KEY) return false;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = Buffer.from(h.slice(7));
  const key = Buffer.from(API_KEY);
  return tok.length === key.length && timingSafeEqual(tok, key);
};

// Valid token, or (unless disabled) a genuine loopback peer for local dev.
// remoteAddress is the real TCP peer, not a spoofable header.
const authedOrLocal = (req) => {
  if (tokenValid(req)) return true;
  if (!ALLOW_LOCALHOST) return false;
  const ra = req.socket.remoteAddress || "";
  return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
};

// ── router ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,PATCH,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const { method } = req;

  try {
    // health + panel (no auth)
    if (path === "/healthz" && method === "GET") {
      let db = "connected";
      try {
        await ping();
      } catch {
        db = "down";
      }
      return json(res, 200, { ok: db === "connected", service: "traceframe-memory", db });
    }
    if ((path === "/" || path === "/index.html") && method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(ADMIN_HTML);
    }

    // everything below requires auth
    if (path.startsWith("/api/") && !authedOrLocal(req)) {
      return json(res, 401, { error: "unauthorized" });
    }

    // ── memory routes ──
    if (path === "/api/projects" && method === "GET") {
      return json(res, 200, { projects: await listProjects() });
    }
    if (path === "/api/memories" && method === "GET") {
      const memories = await listMemories({
        repo: url.searchParams.get("repo") || undefined,
        limit: url.searchParams.get("limit") || undefined,
      });
      return json(res, 200, { memories });
    }
    if (path === "/api/memories" && method === "POST") {
      const body = await readJson(req);
      if (!body.repo_tag || !body.summary) {
        return json(res, 400, { error: "repo_tag and summary are required" });
      }
      const mem = await createMemory({
        repoTag: body.repo_tag,
        summary: body.summary,
        kind: body.kind,
        meta: body.meta || {},
      });
      return json(res, 201, { memory: mem });
    }
    if (path === "/api/search" && method === "POST") {
      const body = await readJson(req);
      if (!body.query) return json(res, 400, { error: "query is required" });
      try {
        const results = await searchMemories({
          query: body.query,
          repoTag: body.repo_tag || null,
          maxResults: body.max_results,
        });
        return json(res, 200, { query: body.query, results, mode: "live" });
      } catch (e) {
        return json(res, 503, { error: "search unavailable", detail: e.message, mode: "stub" });
      }
    }

    // /api/memories/:id  (GET, PATCH, DELETE)
    const idMatch = path.match(/^\/api\/memories\/(\d+)$/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (method === "GET") {
        const mem = await getMemory(id);
        return mem ? json(res, 200, { memory: mem }) : json(res, 404, { error: "not found" });
      }
      if (method === "PATCH") {
        const body = await readJson(req);
        if (typeof body.summary !== "string") {
          return json(res, 400, { error: "summary is required" });
        }
        const mem = await updateMemory(id, body.summary);
        return mem ? json(res, 200, { memory: mem }) : json(res, 404, { error: "not found" });
      }
      if (method === "DELETE") {
        const ok = await deleteMemory(id);
        return ok ? json(res, 200, { deleted: id }) : json(res, 404, { error: "not found" });
      }
    }

    // ── optimizer routes (pure) ──
    if (path === "/api/optimizer/analyze" && method === "POST") {
      const { system, messages, tools } = await readJson(req);
      return json(res, 200, analyzePrompt({ system, messages, tools }));
    }
    if (path === "/api/optimizer/optimize" && method === "POST") {
      const { system, messages, tools, profile } = await readJson(req);
      return json(res, 200, applyOptimizations({ system, messages, tools }, profile));
    }
    if (path === "/api/optimizer/pipeline" && method === "POST") {
      const body = await readJson(req);
      return json(res, 200, runPipeline(body));
    }

    return json(res, 404, { error: "not found", path });
  } catch (e) {
    console.error(`${method} ${path} →`, e);
    return json(res, 500, { error: "internal", detail: e.message });
  }
});

server.listen(PORT, async () => {
  console.log(`traceframe-memory listening on :${PORT}`);
  try {
    await ensureSchema();
    console.log("schema ready");
  } catch (e) {
    console.error("schema bootstrap failed (continuing):", e.message);
  }
});
