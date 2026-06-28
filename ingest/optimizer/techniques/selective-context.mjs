// Selective Context — self-information scoring.
//
// Based on: "Selective Context" (Li et al., 2023, arxiv 2304.01597).
// Original uses a small LM to compute -log P(token | context) per token.
//
// This JS approximation: within-document word frequency acts as a proxy for
// the LM's unigram probability. Words that appear rarely in the current text
// carry high "self-information" (I = -log freq/total). Sentences with high
// average self-information are kept; low-scoring ones (mostly common words)
// are dropped.
//
// Integration point: Layer 2 (Compressor), complements LLMLingua.

const WORD_RE = /\b[a-zA-Z]{3,}\b/g;
const PARA_SEP = /\n{2,}|\n(?=\s*[-*#>])/;

function buildSelfInfo(text) {
  const words = (text.match(WORD_RE) || []).map((w) => w.toLowerCase());
  const total = words.length || 1;
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  // Self-information: higher for rare words, lower for common ones.
  // log base 2, then normalize by max to [0, 1].
  const si = new Map();
  for (const [w, c] of freq) si.set(w, Math.log2(total / c));
  return si;
}

function sentenceSelfInfo(sentence, si) {
  const words = (sentence.match(WORD_RE) || []).map((w) => w.toLowerCase());
  if (!words.length) return 0;
  return words.reduce((sum, w) => sum + (si.get(w) ?? Math.log2(100)), 0) / words.length;
}

/**
 * Keep high self-information content; drop predictable filler.
 *
 * @param {string} text
 * @param {{ ratio?: number }} options
 *   ratio — fraction of content to KEEP (default 0.65)
 * @returns {{ text: string, savedChars: number }}
 */
export function selectiveContext(text, { ratio = 0.65 } = {}) {
  if (!text || text.length < 100) return { text, savedChars: 0 };

  // Work at paragraph level to avoid cutting mid-thought.
  const paras = text.split(PARA_SEP).filter((p) => p.trim().length > 10);
  if (paras.length <= 2) return { text, savedChars: 0 };

  const si = buildSelfInfo(text);
  const scored = paras.map((p) => ({ p, score: sentenceSelfInfo(p, si) }));

  const keepCount = Math.max(1, Math.round(paras.length * ratio));
  const threshold = [...scored].sort((a, b) => b.score - a.score)[keepCount - 1]?.score ?? 0;

  const kept = scored.filter((x) => x.score >= threshold).map((x) => x.p);
  const result = kept.join("\n\n").trim();
  return { text: result, savedChars: Math.max(0, text.length - result.length) };
}
