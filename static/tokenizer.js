/*
 * tokenizer.js — auto-detecting client-side tokenizer for the context view.
 *
 * Picks the right tokenizer for the active model family, lazy-loads it
 * from a CDN, caches the loaded instance. Falls back to a `text.length / 4`
 * heuristic when neither tokenizer is available (offline / blocked CDN).
 *
 * Providers:
 *   - Claude (claude-opus-4-7, claude-sonnet-4, ...) → @anthropic-ai/tokenizer
 *     (1.4MB; Anthropic's own Claude tokenizer — matches the API exactly)
 *   - OpenAI / Codex (gpt-4, o1, codex, ...) → gpt-tokenizer/encoding/cl100k_base
 *     (1.2MB raw, ~500KB gzipped; the de-facto BPE for GPT-3.5/4)
 *
 * No build step. The dynamic `import()` calls hit jsDelivr at runtime; the
 * results are cached in module-scope closures. Failed loads fall through to
 * the heuristic, so the UI still renders a token count when the CDN is
 * unreachable.
 */

(function () {
  "use strict";

  // ---------- Family detection ---------------------------------------------

  /**
   * Map a model id to a tokenizer family. Matches what the API expects:
   *   anthropic, openai, codex, o1/o-series → openai family (cl100k/o200k).
   *   Anything containing 'claude' → anthropic family.
   *   Default → openai (cl100k) since it has the best cross-model fallback.
   */
  function familyFor(model) {
    if (typeof model !== "string" || model.length === 0) return "openai";
    const m = model.toLowerCase();
    if (m.includes("claude")) return "anthropic";
    if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4") ||
        m.includes("codex") || m.includes("davinci") || m.includes("babbage") ||
        m.includes("text-embedding")) {
      return "openai";
    }
    // Pi has no model hint by default; fall back to openai's cl100k.
    return "openai";
  }

  // ---------- Tokenizer loaders (lazy + cached) -----------------------------

  const ANTHROPIC_CDN = "https://cdn.jsdelivr.net/npm/@anthropic-ai/tokenizer@0.0.4/dist/cjs/index.js";
  const OPENAI_CDN = "https://cdn.jsdelivr.net/npm/gpt-tokenizer@2.9.0/+esm";

  /** Loaded Anthropic tokenizer, or null. */
  let anthropicPromise = null;
  /** Loaded OpenAI tokenizer, or null. */
  let openaiPromise = null;

  function loadAnthropic() {
    if (!anthropicPromise) {
      anthropicPromise = import(/* @vite-ignore */ ANTHROPIC_CDN)
        .then((mod) => {
          // @anthropic-ai/tokenizer exports a CJS module shape that ESM
          // import() can interop with. The function is on .default or .countTokens.
          const fn = (mod && (mod.countTokens || (mod.default && mod.default.countTokens))) || null;
          if (typeof fn !== "function") {
            throw new Error("anthropic tokenizer: no countTokens export");
          }
          return { count: (s) => fn(s) };
        })
        .catch((err) => {
          // Reset so a later attempt can retry; otherwise we'd cache the failure.
          anthropicPromise = null;
          throw err;
        });
    }
    return anthropicPromise;
  }

  function loadOpenAI() {
    if (!openaiPromise) {
      openaiPromise = import(/* @vite-ignore */ OPENAI_CDN)
        .then((mod) => {
          // gpt-tokenizer/encoding/cl100k_base exports { encode, decode, ... }.
          const enc = (mod && (mod.encode || (mod.default && mod.default.encode))) || null;
          if (typeof enc !== "function") {
            throw new Error("openai tokenizer: no encode export");
          }
          // Wrap so the API matches Anthropic's (count(text) -> number).
          return {
            count: (s) => {
              // Generator output: count tokens lazily without materializing the array.
              let n = 0;
              for (const _ of enc(s)) n++;
              return n;
            },
          };
        })
        .catch((err) => {
          openaiPromise = null;
          throw err;
        });
    }
    return openaiPromise;
  }

  // ---------- Public API ----------------------------------------------------

  /**
   * Count tokens for a single string under the given model. Lazy-loads the
   * matching tokenizer from CDN, caches it, falls back to `text.length / 4`
   * if the CDN is unreachable.
   */
  async function countTokens(text, model) {
    const s = typeof text === "string" ? text : String(text || "");
    if (s.length === 0) return 0;
    const family = familyFor(model);
    try {
      const t = family === "anthropic" ? await loadAnthropic() : await loadOpenAI();
      const n = t.count(s);
      return typeof n === "number" && n >= 0 ? n : 0;
    } catch (_err) {
      // CDN failed or shape unexpected — fall back to a rough heuristic so
      // the UI still has a number. ~4 chars / token is the OpenAI rule of
      // thumb and is close enough for English.
      return Math.max(1, Math.ceil(s.length / 4));
    }
  }

  /**
   * Count tokens across an array of strings and sum. Convenience for the
   * aggregator which usually has many pieces to measure.
   */
  async function countAll(pieces, model) {
    if (!Array.isArray(pieces) || pieces.length === 0) return 0;
    let total = 0;
    for (const p of pieces) total += await countTokens(p, model);
    return total;
  }

  /**
   * Cheap heuristic used in synchronous code paths where we can't await the
   * CDN (e.g. ordering blocks before the tokenizer has loaded). Returns a
   * rough but stable estimate from character length.
   */
  function estimate(text) {
    if (typeof text !== "string" || text.length === 0) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  window.Traceframe = window.Traceframe || {};
  window.Traceframe.tokenizer = {
    familyFor,
    countTokens,
    countAll,
    estimate,
  };
})();
