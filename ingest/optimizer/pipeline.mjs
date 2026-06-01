// Full optimization pipeline — 4 layers in sequence.
//
//  Input prompt
//    ↓ Layer 1 — Content Router    (label each message with content type)
//    ↓ Layer 2 — Compressor        (apply type-aware + profile techniques)
//    ↓ Layer 3 — Context Selector  (Hot/Warm/Cold scoring, drop irrelevant)
//    ↓ Layer 4 — Session Guard     (Waste Factor, rotation recommendation)
//  Output: optimized prompt + full layered report

import { routeMessages, detectContentType } from "./content-router.mjs";
import { applyOptimizations } from "./index.mjs";
import { selectContext } from "./context-selector.mjs";
import { evaluateSession } from "./session-guard.mjs";

const charsToTokens = (n) => Math.round(n / 4);

/**
 * @typedef {{ role: string, content: string, source?: string }} Message
 * @typedef {{ turnIndex: number, tokens: number }} TurnStat
 */

/**
 * Run the full 4-layer optimization pipeline.
 *
 * @param {{
 *   system?: string,
 *   messages?: Message[],
 *   tools?: Array<{name:string,description?:string}>,
 *   profile?: string,              // balanced | max-save | quality-first
 *   query?: string,                // latest user message (for context scoring)
 *   keywords?: string[],           // project keywords for context boosting
 *   sessionTurns?: TurnStat[],     // token history for session guard
 *   handoffCtx?: object,           // task context for rotation handoff
 * }} input
 * @returns {{
 *   system: string,
 *   messages: Message[],
 *   tools: Array,
 *   report: {
 *     inputTokens: number,
 *     outputTokens: number,
 *     savedTokens: number,
 *     savedPct: number,
 *     layers: {
 *       router: object,
 *       compressor: object,
 *       contextSelector: object,
 *       sessionGuard: object,
 *     },
 *   },
 * }}
 */
export function runPipeline({
  system = "",
  messages = [],
  tools = [],
  profile = "balanced",
  query = "",
  keywords = [],
  sessionTurns = [],
  handoffCtx,
} = {}) {
  const inputChars =
    system.length +
    messages.reduce((s, m) => s + m.content.length, 0) +
    tools.reduce((s, t) => s + (t.description?.length ?? 0), 0);
  const inputTokens = charsToTokens(inputChars);

  // ── Layer 1: Content Router ─────────────────────────────────
  const routedMessages = routeMessages(messages);
  const systemType = detectContentType(system);
  const routerReport = {
    systemType,
    messageCounts: routedMessages.reduce((acc, m) => {
      acc[m.contentType] = (acc[m.contentType] ?? 0) + 1;
      return acc;
    }, {}),
  };

  // ── Layer 2: Compressor ─────────────────────────────────────
  // Pass routed messages (with contentType) through existing optimizer.
  // applyOptimizations works on content strings — contentType is preserved.
  const compressed = applyOptimizations(
    { system, messages: routedMessages, tools },
    profile
  );
  const compressorReport = compressed.report;
  let { system: cSystem, messages: cMessages, tools: cTools } = compressed;

  // ── Layer 3: Context Selector ───────────────────────────────
  const effectiveQuery = query || cMessages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
  const selection = selectContext(cMessages, { query: effectiveQuery, keywords });
  const selectorReport = {
    total: cMessages.length,
    hot: selection.hot.length,
    warm: selection.warm.length,
    cold: selection.cold.length,
    droppedTokens: charsToTokens(selection.droppedChars),
  };
  cMessages = selection.selected;

  // ── Layer 4: Session Guard ──────────────────────────────────
  const sessionReport = evaluateSession(sessionTurns, { handoffCtx });

  // ── Final report ────────────────────────────────────────────
  const outputChars =
    cSystem.length +
    cMessages.reduce((s, m) => s + m.content.length, 0) +
    cTools.reduce((s, t) => s + (t.description?.length ?? 0), 0);
  const outputTokens = charsToTokens(outputChars);
  const savedTokens = inputTokens - outputTokens;
  const savedPct = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;

  return {
    system: cSystem,
    messages: cMessages,
    tools: cTools,
    report: {
      inputTokens,
      outputTokens,
      savedTokens,
      savedPct,
      layers: {
        router: routerReport,
        compressor: {
          totalTokens: compressorReport.totalTokens,
          potentialSaving: compressorReport.potentialSaving,
          potentialSavingPct: compressorReport.potentialSavingPct,
          issues: compressorReport.issues,
        },
        contextSelector: selectorReport,
        sessionGuard: sessionReport,
      },
    },
  };
}
