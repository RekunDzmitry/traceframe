// Remove near-duplicate messages from a ContextMessage array.
// Uses Jaccard similarity on word-level trigrams.

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function trigrams(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i < words.length - 2; i++) {
    out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * @typedef {{ role: string, content: string, source?: string }} ContextMessage
 */

/**
 * Deduplicate near-identical messages. Keeps the last occurrence.
 * @param {ContextMessage[]} messages
 * @param {number} threshold  Jaccard similarity above which a message is a duplicate (default 0.85)
 * @returns {{ kept: ContextMessage[], removed: ContextMessage[], savedChars: number }}
 */
export function dedupContext(messages, threshold = 0.85) {
  const kept = [];
  const removed = [];
  const keptGrams = [];

  for (const msg of messages) {
    const g = trigrams(msg.content);
    const isDup = keptGrams.some((kg) => jaccard(g, kg) >= threshold);
    if (isDup) {
      removed.push(msg);
    } else {
      kept.push(msg);
      keptGrams.push(g);
    }
  }

  const savedChars = removed.reduce((sum, m) => sum + m.content.length, 0);
  return { kept, removed, savedChars };
}
