// A/B experiment runner: compare original vs optimized prompt via OpenCode API.
// Uses the same callOpenCode pattern as server.mjs (OPENCODE_BASE/KEY/MODEL).

import { applyOptimizations } from "./index.mjs";

const OPENCODE_BASE = process.env.OPENCODE_GO_BASE_URL || "https://opencode.ai/zen/go/v1";
const OPENCODE_KEY = process.env.OPENCODE_GO_API_KEY || "";
const OPENCODE_MODEL = process.env.OPENCODE_GO_MODEL || "opencode-go/deepseek-v4-flash";

const charsToTokens = (n) => Math.round(n / 4);

/**
 * Call OpenCode chat completions with a structured message list.
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} [model]
 * @returns {Promise<{ content: string, usage: object|null }>}
 */
async function callProvider(messages, model = OPENCODE_MODEL) {
  if (!OPENCODE_KEY) throw new Error("OPENCODE_GO_API_KEY not set");
  const res = await fetch(`${OPENCODE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENCODE_KEY}`,
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`provider ${res.status}: ${detail.slice(0, 200)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content ?? "";
  return { content: content.trim(), usage: body.usage || null };
}

/**
 * @typedef {{ role: string, content: string, source?: string }} ContextMessage
 * @typedef {{ name: string, description?: string }} ToolDef
 */

/**
 * Run A/B experiment: original prompt vs optimized variant.
 *
 * @param {{
 *   system?: string,
 *   messages?: ContextMessage[],
 *   tools?: ToolDef[],
 *   profile?: string,
 *   dryRun?: boolean,   // if true, skip provider calls — return specs + delta only
 * }} opts
 * @returns {Promise<{
 *   original:  { prompt: object, result?: string, usage?: object },
 *   optimized: { prompt: object, result?: string, usage?: object },
 *   delta: { inputTokens: number, inputPct: number },
 * }>}
 */
export async function runExperiment({ system = "", messages = [], tools = [], profile, dryRun = false }) {
  const originalPrompt = { system, messages, tools };

  const { system: optSystem, messages: optMessages, tools: optTools } =
    applyOptimizations(originalPrompt, profile);
  const optimizedPrompt = { system: optSystem, messages: optMessages, tools: optTools };

  const origChars =
    system.length +
    messages.reduce((s, m) => s + m.content.length, 0) +
    tools.reduce((s, t) => s + (t.description?.length ?? 0), 0);

  const optChars =
    optSystem.length +
    optMessages.reduce((s, m) => s + m.content.length, 0) +
    optTools.reduce((s, t) => s + (t.description?.length ?? 0), 0);

  const origTokens = charsToTokens(origChars);
  const optTokens = charsToTokens(optChars);
  const delta = {
    inputTokens: origTokens - optTokens,
    inputPct: origTokens > 0 ? Math.round(((origTokens - optTokens) / origTokens) * 100) : 0,
  };

  if (dryRun) {
    return {
      original: { prompt: originalPrompt },
      optimized: { prompt: optimizedPrompt },
      delta,
    };
  }

  // Build flat message arrays for the provider (system → first user message style)
  const toProviderMessages = (sys, msgs) => {
    const out = [];
    if (sys) out.push({ role: "system", content: sys });
    for (const m of msgs) out.push({ role: m.role, content: m.content });
    return out;
  };

  const [origResult, optResult] = await Promise.all([
    callProvider(toProviderMessages(system, messages)),
    callProvider(toProviderMessages(optSystem, optMessages)),
  ]);

  return {
    original: { prompt: originalPrompt, result: origResult.content, usage: origResult.usage },
    optimized: { prompt: optimizedPrompt, result: optResult.content, usage: optResult.usage },
    delta,
  };
}
