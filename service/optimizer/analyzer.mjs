// Analyze a prompt string and produce a token-waste report.
// Token estimate: ~4 chars per token (Claude/GPT ballpark).

import { trimFiller } from "./techniques/trim-filler.mjs";
import { dedupContext } from "./techniques/dedup-context.mjs";
import { shrinkToolDescs } from "./techniques/shrink-tool-desc.mjs";
import { compressSystem } from "./techniques/compress-system.mjs";

const charsToTokens = (chars) => Math.round(chars / 4);

/**
 * @typedef {{ role: string, content: string, source?: string }} ContextMessage
 * @typedef {{ name: string, description?: string }} ToolDef
 */

/**
 * Analyze a structured prompt for token waste.
 *
 * @param {{
 *   system?: string,
 *   messages?: ContextMessage[],
 *   tools?: ToolDef[],
 * }} prompt
 * @returns {{
 *   totalTokens: number,
 *   breakdown: { system: number, history: number, tools: number },
 *   issues: Array<{ type: string, tokens: number, description: string }>,
 *   potentialSaving: number,
 *   potentialSavingPct: number,
 * }}
 */
export function analyzePrompt({ system = "", messages = [], tools = [] }) {
  const issues = [];

  // ── breakdown ──────────────────────────────────────────────
  const systemChars = system.length;
  const historyChars = messages.reduce((s, m) => s + m.content.length, 0);
  const toolsChars = tools.reduce(
    (s, t) => s + (t.description?.length ?? 0) + (t.name?.length ?? 0),
    0
  );

  const totalChars = systemChars + historyChars + toolsChars;
  const totalTokens = charsToTokens(totalChars);

  const breakdown = {
    system: charsToTokens(systemChars),
    history: charsToTokens(historyChars),
    tools: charsToTokens(toolsChars),
  };

  let savedChars = 0;

  // ── issue: filler in system prompt ─────────────────────────
  if (system) {
    const { savedChars: sc } = trimFiller(system);
    if (sc > 0) {
      issues.push({
        type: "filler",
        tokens: charsToTokens(sc),
        description: "System prompt contains verbose filler phrases",
      });
      savedChars += sc;
    }
  }

  // ── issue: filler in user/assistant messages ────────────────
  const fillerInHistory = messages.reduce((sum, m) => {
    const { savedChars: sc } = trimFiller(m.content);
    return sum + sc;
  }, 0);
  if (fillerInHistory > 0) {
    issues.push({
      type: "filler",
      tokens: charsToTokens(fillerInHistory),
      description: "Message history contains verbose filler phrases",
    });
    savedChars += fillerInHistory;
  }

  // ── issue: duplicate messages ───────────────────────────────
  if (messages.length > 1) {
    const { removed } = dedupContext(messages);
    const dupChars = removed.reduce((s, m) => s + m.content.length, 0);
    if (dupChars > 0) {
      issues.push({
        type: "duplicate",
        tokens: charsToTokens(dupChars),
        description: `${removed.length} near-duplicate message(s) in history`,
      });
      savedChars += dupChars;
    }
  }

  // ── issue: verbose system prompt ───────────────────────────
  if (system) {
    const { savedChars: sc } = compressSystem(system);
    if (sc > 20) {
      issues.push({
        type: "verbose_system",
        tokens: charsToTokens(sc),
        description: "System prompt has compressible markdown/whitespace",
      });
      savedChars += sc;
    }
  }

  // ── issue: verbose tool descriptions ──────────────────────
  if (tools.length > 0) {
    const { savedChars: sc } = shrinkToolDescs(tools);
    if (sc > 0) {
      issues.push({
        type: "verbose_tools",
        tokens: charsToTokens(sc),
        description: "Tool descriptions contain boilerplate/examples",
      });
      savedChars += sc;
    }
  }

  const potentialSaving = charsToTokens(savedChars);
  const potentialSavingPct =
    totalTokens > 0 ? Math.round((potentialSaving / totalTokens) * 100) : 0;

  return { totalTokens, breakdown, issues, potentialSaving, potentialSavingPct };
}
