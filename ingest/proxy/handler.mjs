// Variant A — thin proxy.
// Intercepts POST /v1/messages, runs the optimizer pipeline,
// forwards the optimized payload to Anthropic, returns the LLM response.
//
// Auth model: BYOK — caller passes their Anthropic key via
// x-anthropic-api-key header. The key is forwarded and never stored.

import { runPipeline } from "../optimizer/pipeline.mjs";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TRACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Handle POST /v1/messages — optimize then proxy to Anthropic.
 *
 * @param {object} req   Node.js IncomingMessage
 * @param {object} res   Node.js ServerResponse
 * @param {string} body  Raw request body (already read by caller)
 * @param {object} [pool] pg.Pool — if provided, optimization stats are persisted
 */
export async function handleProxy(req, res, body, pool) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid JSON body" }));
  }

  const apiKey =
    req.headers["x-anthropic-api-key"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!apiKey) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing x-anthropic-api-key header" }));
  }

  const { system = "", messages = [], tools = [], ...rest } = payload;
  const profile = req.headers["x-traceframe-profile"] || "balanced";

  // ── Optimize ────────────────────────────────────────────────
  const optimized = await runPipeline({
    system,
    messages,
    tools,
    profile,
    query: messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "",
  });

  const { savedTokens, savedPct, inputTokens, outputTokens } = optimized.report;

  // ── Forward to Anthropic ────────────────────────────────────
  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        ...rest,
        system: optimized.system || undefined,
        messages: optimized.messages,
        tools: optimized.tools.length ? optimized.tools : undefined,
      }),
    });
  } catch (err) {
    console.error("Proxy upstream error:", err.message);
    res.writeHead(502, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "Upstream request failed" }));
  }

  const responseBody = await anthropicRes.text();

  // ── Persist optimization stats ──────────────────────────────
  if (pool) {
    let responseJson;
    try { responseJson = JSON.parse(responseBody); } catch {}
    const traceIdRaw = req.headers["x-traceframe-trace-id"] || null;
    const traceId = traceIdRaw && TRACE_ID_RE.test(traceIdRaw) ? traceIdRaw : null;
    pool.query(
      `INSERT INTO proxy_stats
         (trace_id, profile, model, input_tokens, output_tokens, saved_tokens, saved_pct, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        traceId,
        profile,
        responseJson?.model || payload.model || null,
        inputTokens,
        outputTokens,
        savedTokens,
        savedPct,
        JSON.stringify({ layers: optimized.report.layers, anthropicUsage: responseJson?.usage || null }),
      ]
    ).catch((e) => console.error("proxy_stats insert:", e.message));
  }

  // ── Reply with LLM response + traceframe report headers ────
  res.writeHead(anthropicRes.status, {
    "content-type": "application/json",
    "x-traceframe-saved-tokens": String(savedTokens),
    "x-traceframe-saved-pct": String(savedPct),
    "x-traceframe-input-tokens": String(inputTokens),
    "x-traceframe-output-tokens": String(outputTokens),
  });
  return res.end(responseBody);
}
