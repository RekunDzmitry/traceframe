// RTK — Repetition Token Killer.
//
// Inspired by RTK (Rust Token Killer) which compresses repetitive terminal
// output by detecting n-gram patterns. Applied to LLM prompts: repeated blocks
// of text (tool output repeated verbatim, duplicated file listings, etc.) are
// replaced with a compact reference on second+ occurrence.
//
// Algorithm:
//   1. Split text into "chunks" — paragraphs or lines longer than minRepeatLen.
//   2. Hash each chunk. On first occurrence store it; on repeat, replace with
//      a short [RTK:REPEAT:<prefix>] tag so the model still understands context.
//   3. Return modified text + savings.
//
// Integration point: Layer 2 (Compressor), runs before other techniques to
// eliminate exact duplicates before filler removal.

const MIN_REPEAT_LEN = 60;
const PREFIX_LEN = 40;
const CHUNK_SEP = /\n{2,}|\n(?=\[|```|\d+\.\s)/;

function hashStr(s) {
  // djb2 — fast, good enough for collision-resistance at our scale
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Remove repeated content blocks from text.
 *
 * @param {string} text
 * @param {{ minRepeatLen?: number, maxReplacements?: number }} options
 * @returns {{ text: string, savedChars: number, replacements: number }}
 */
export function rtkCompress(text, { minRepeatLen = MIN_REPEAT_LEN, maxReplacements = 20 } = {}) {
  if (!text || text.length < minRepeatLen * 2) {
    return { text, savedChars: 0, replacements: 0 };
  }

  const chunks = text.split(CHUNK_SEP);
  const seen = new Map(); // hash → first occurrence prefix
  let replacements = 0;
  let savedChars = 0;

  const result = chunks.map((chunk) => {
    const trimmed = chunk.trim();
    if (trimmed.length < minRepeatLen) return chunk;

    const h = hashStr(trimmed);
    if (seen.has(h) && replacements < maxReplacements) {
      const prefix = seen.get(h).slice(0, PREFIX_LEN).replace(/\s+/g, " ").trim();
      const tag = `[RTK:REPEAT:"${prefix}…"]`;
      savedChars += Math.max(0, chunk.length - tag.length);
      replacements++;
      return tag;
    }

    seen.set(h, trimmed);
    return chunk;
  });

  return {
    text: result.join("\n\n"),
    savedChars,
    replacements,
  };
}
