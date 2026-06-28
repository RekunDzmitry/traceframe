// Public API for the traceframe prompt optimizer module.

import { trimFiller } from "./techniques/trim-filler.mjs";
import { dedupContext } from "./techniques/dedup-context.mjs";
import { shrinkToolDescs } from "./techniques/shrink-tool-desc.mjs";
import { compressSystem } from "./techniques/compress-system.mjs";
import { rtkCompress } from "./techniques/rtk.mjs";
import { llmLinguaCompress } from "./techniques/llmlingua.mjs";
import { selectiveContext } from "./techniques/selective-context.mjs";
import { morphCompress, morphAvailable } from "./techniques/morph.mjs";
import { analyzePrompt } from "./analyzer.mjs";
import { resolveRules } from "./rules.mjs";

export { analyzePrompt } from "./analyzer.mjs";
export { runExperiment } from "./runner.mjs";
export { resolveRules, PROFILES, DEFAULT_PROFILE } from "./rules.mjs";
export { runPipeline } from "./pipeline.mjs";
export { detectContentType, routeMessages } from "./content-router.mjs";
export { selectContext } from "./context-selector.mjs";
export { evaluateSession, buildHandoff } from "./session-guard.mjs";
export { rtkCompress } from "./techniques/rtk.mjs";
export { llmLinguaCompress } from "./techniques/llmlingua.mjs";
export { selectiveContext } from "./techniques/selective-context.mjs";
export { morphCompress, morphAvailable } from "./techniques/morph.mjs";

/**
 * Apply all active optimization techniques to a structured prompt.
 * Returns a Promise — Morph is async; all other techniques are sync.
 *
 * @param {{
 *   system?: string,
 *   messages?: Array<{role:string,content:string,source?:string}>,
 *   tools?: Array<{name:string,description?:string}>,
 * }} prompt
 * @param {string} [profile]  One of: balanced | max-save | quality-first
 * @returns {Promise<{ system: string, messages: Array, tools: Array, report: object }>}
 */
export async function applyOptimizations(prompt, profile) {
  const rules = resolveRules(profile);
  let { system = "", messages = [], tools = [] } = prompt;

  // ── Synchronous layer ────────────────────────────────────────
  if (rules.rtk && system) {
    ({ text: system } = rtkCompress(system));
  }
  if (rules.rtk && messages.length > 1) {
    messages = messages.map((m) => ({ ...m, content: rtkCompress(m.content).text }));
  }
  if (rules.compressSystem && system) {
    ({ text: system } = compressSystem(system));
  }
  if (rules.trimFiller) {
    if (system) ({ text: system } = trimFiller(system));
    messages = messages.map((m) => ({
      ...m,
      content: trimFiller(m.content).text,
    }));
  }
  if (rules.dedupContext && messages.length > 1) {
    ({ kept: messages } = dedupContext(messages));
  }
  if (rules.shrinkToolDescs && tools.length > 0) {
    ({ tools } = shrinkToolDescs(tools));
  }
  if (rules.llmlingua) {
    if (system) ({ text: system } = llmLinguaCompress(system));
    messages = messages.map((m) => ({
      ...m,
      content: llmLinguaCompress(m.content).text,
    }));
  }
  if (rules.selectiveContext) {
    if (system) ({ text: system } = selectiveContext(system));
    messages = messages.map((m) => ({
      ...m,
      content: selectiveContext(m.content).text,
    }));
  }

  // ── Async layer (Morph SaaS) ─────────────────────────────────
  if (rules.morph && morphAvailable()) {
    if (system) ({ text: system } = await morphCompress(system));
    messages = await Promise.all(
      messages.map(async (m) => ({
        ...m,
        content: (await morphCompress(m.content)).text,
      }))
    );
  }

  const report = analyzePrompt({ system, messages, tools });
  return { system, messages, tools, report };
}
