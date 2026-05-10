// Public API for the traceframe prompt optimizer module.

import { trimFiller } from "./techniques/trim-filler.mjs";
import { dedupContext } from "./techniques/dedup-context.mjs";
import { shrinkToolDescs } from "./techniques/shrink-tool-desc.mjs";
import { compressSystem } from "./techniques/compress-system.mjs";
import { analyzePrompt } from "./analyzer.mjs";
import { resolveRules } from "./rules.mjs";

export { analyzePrompt } from "./analyzer.mjs";
export { runExperiment } from "./runner.mjs";
export { resolveRules, PROFILES, DEFAULT_PROFILE } from "./rules.mjs";

/**
 * Apply all active optimization techniques to a structured prompt.
 *
 * @param {{
 *   system?: string,
 *   messages?: Array<{role:string,content:string,source?:string}>,
 *   tools?: Array<{name:string,description?:string}>,
 * }} prompt
 * @param {string} [profile]  One of: balanced | max-save | quality-first
 * @returns {{ system: string, messages: Array, tools: Array, report: object }}
 */
export function applyOptimizations(prompt, profile) {
  const rules = resolveRules(profile);
  let { system = "", messages = [], tools = [] } = prompt;

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

  const report = analyzePrompt({ system, messages, tools });
  return { system, messages, tools, report };
}
