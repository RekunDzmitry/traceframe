// LLMLingua-style sentence-level compression.
//
// Real LLMLingua (microsoft/LLMLingua) uses a small LM to compute token-level
// perplexity and prunes low-perplexity (predictable) tokens. This JS
// implementation approximates the same signal with three heuristics:
//
//   1. Uniqueness — sentences with rare words relative to the corpus carry
//      more information (rarer = higher perplexity).
//   2. Density  — technical content (code, numbers, identifiers) is usually
//      less guessable than natural-language filler.
//   3. Position — first and last sentences in a block are boundary markers;
//      middle sentences that look like repetitions are cheaper to drop.
//
// Integration point: Layer 2 (Compressor) in the optimizer pipeline.

const SENTENCE_SEP = /(?<=[.!?])\s+(?=[A-Z"'‘“])|(?<=\n)/;
const CODE_RE = /[`\{\}()\[\]<>\/\\]|0x[0-9a-f]+|\b\d{2,}\b/i;
const WORD_RE = /\b[a-zA-Z]{3,}\b/g;

function wordFrequency(sentences) {
  const freq = new Map();
  for (const s of sentences) {
    for (const w of (s.match(WORD_RE) || [])) {
      const lw = w.toLowerCase();
      freq.set(lw, (freq.get(lw) || 0) + 1);
    }
  }
  return freq;
}

function sentenceScore(s, idx, total, freq) {
  const words = (s.match(WORD_RE) || []).map((w) => w.toLowerCase());
  if (!words.length) return 0;

  // Uniqueness: average inverse frequency of content words
  const avgInvFreq = words.reduce((sum, w) => sum + 1 / (freq.get(w) || 1), 0) / words.length;

  // Density: presence of code-like tokens boosts score
  const densityBonus = CODE_RE.test(s) ? 0.4 : 0;

  // Position: first 20% and last 20% of sentences get a boost
  const edgeFraction = total > 4 ? 0.2 : 0;
  const positionBonus =
    (idx / total < edgeFraction || idx / total > 1 - edgeFraction) ? 0.3 : 0;

  // Very short sentences that aren't code get a small penalty
  const brevityPenalty = s.length < 20 && !CODE_RE.test(s) ? -0.2 : 0;

  return avgInvFreq + densityBonus + positionBonus + brevityPenalty;
}

/**
 * Compress text by dropping low-importance sentences.
 *
 * @param {string} text
 * @param {{ ratio?: number, minSentenceLen?: number }} options
 *   ratio — target fraction of sentences to KEEP (default 0.6)
 * @returns {{ text: string, savedChars: number, kept: number, total: number }}
 */
export function llmLinguaCompress(text, { ratio = 0.6, minSentenceLen = 8 } = {}) {
  if (!text || text.length < 120) return { text, savedChars: 0, kept: 0, total: 0 };

  const raw = text.split(SENTENCE_SEP).filter((s) => s.trim().length >= minSentenceLen);
  if (raw.length <= 3) return { text, savedChars: 0, kept: raw.length, total: raw.length };

  const freq = wordFrequency(raw);
  const scored = raw.map((s, i) => ({ s, score: sentenceScore(s, i, raw.length, freq), i }));

  const keepCount = Math.max(1, Math.round(raw.length * ratio));

  // Select by score but preserve original order
  const topIndices = new Set(
    [...scored].sort((a, b) => b.score - a.score).slice(0, keepCount).map((x) => x.i)
  );

  const kept = raw.filter((_, i) => topIndices.has(i));
  const result = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return {
    text: result,
    savedChars: Math.max(0, text.length - result.length),
    kept: kept.length,
    total: raw.length,
  };
}
