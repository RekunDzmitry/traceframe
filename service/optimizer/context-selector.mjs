// Layer 3: Context Selector — Hot/Warm/Cold scoring for message history.
// Inspired by claude-cognitive's attention-based injection model.
//
// HOT  (score > 0.7) → keep full content
// WARM (score 0.3–0.7) → keep but truncate to first N chars
// COLD (score < 0.3) → drop from context

const WARM_TRUNCATE_CHARS = 400;
const DECAY_PER_TURN = 0.85;      // score × 0.85 per turn without mention
const CO_ACTIVATION_BOOST = 0.25; // boost when a related keyword fires

/**
 * @typedef {{ role: string, content: string, source?: string, contentType?: string }} Message
 * @typedef {'hot' | 'warm' | 'cold'} Tier
 * @typedef {Message & { score: number, tier: Tier, truncated?: boolean }} ScoredMessage
 */

/**
 * Tokenise text into lowercase word set for overlap calculation.
 * @param {string} text
 * @returns {Set<string>}
 */
function wordSet(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

/**
 * Keyword overlap score (Jaccard on words > 3 chars).
 * @param {Set<string>} queryWords
 * @param {string} text
 * @returns {number} 0–1
 */
function overlapScore(queryWords, text) {
  if (queryWords.size === 0) return 0;
  const msgWords = wordSet(text);
  const intersection = [...queryWords].filter((w) => msgWords.has(w)).length;
  return intersection / queryWords.size;
}

/**
 * Score and tier every message relative to the latest user query.
 *
 * @param {Message[]} messages
 * @param {{
 *   query?: string,         // latest user message text (for keyword overlap)
 *   keywords?: string[],    // extra keywords to boost (from project config)
 * }} [opts]
 * @returns {{
 *   scored: ScoredMessage[],
 *   hot: Message[],
 *   warm: Message[],
 *   cold: Message[],
 *   selected: Message[],    // hot + warm (truncated), ready to send
 *   droppedChars: number,
 * }}
 */
export function selectContext(messages, { query = "", keywords = [] } = {}) {
  if (!messages.length) {
    return { scored: [], hot: [], warm: [], cold: [], selected: [], droppedChars: 0 };
  }

  const queryWords = wordSet(query);
  const kwWords = new Set(keywords.map((k) => k.toLowerCase()));
  const total = messages.length;

  const scored = messages.map((msg, idx) => {
    const turnsAgo = total - 1 - idx;

    // Recency: most recent message = 1.0, decays by DECAY_PER_TURN
    const recency = Math.pow(DECAY_PER_TURN, turnsAgo);

    // Keyword overlap with current query
    const overlap = overlapScore(queryWords, msg.content);

    // Keyword activation from project keywords
    const kwActivation = [...kwWords].some((kw) =>
      msg.content.toLowerCase().includes(kw)
    )
      ? CO_ACTIVATION_BOOST
      : 0;

    // System messages always hot
    const roleBoost = msg.role === "system" ? 1.0 : 0;

    // Combine: recency is most important, then overlap
    const raw = roleBoost > 0
      ? 1.0
      : Math.min(1, recency * 0.5 + overlap * 0.35 + kwActivation + 0.05);

    const tier = raw > 0.7 ? "hot" : raw > 0.3 ? "warm" : "cold";
    return { ...msg, score: Math.round(raw * 100) / 100, tier };
  });

  const hot = scored.filter((m) => m.tier === "hot");
  const warm = scored.filter((m) => m.tier === "warm");
  const cold = scored.filter((m) => m.tier === "cold");

  const droppedChars = cold.reduce((s, m) => s + m.content.length, 0);

  // Warm messages: keep but truncate
  const warmTruncated = warm.map((m) => {
    if (m.content.length <= WARM_TRUNCATE_CHARS) return m;
    return {
      ...m,
      content: m.content.slice(0, WARM_TRUNCATE_CHARS) + " …[truncated]",
      truncated: true,
    };
  });

  const selected = [...hot, ...warmTruncated].sort((a, b) => {
    const ai = messages.indexOf(messages.find((x) => x === a) ?? messages[0]);
    const bi = messages.indexOf(messages.find((x) => x === b) ?? messages[0]);
    return ai - bi;
  });

  return { scored, hot, warm, cold, selected, droppedChars };
}
