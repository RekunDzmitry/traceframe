// Compress a system prompt: strip markdown decoration, merge short lines,
// remove redundant whitespace. Preserves all semantic content.

/**
 * @param {string} text
 * @returns {{ text: string, savedChars: number }}
 */
export function compressSystem(text) {
  let out = text;

  // Remove horizontal rules
  out = out.replace(/^[-*_]{3,}\s*$/gm, "");

  // Collapse markdown bold/italic around plain words (keep the word)
  out = out.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1");
  out = out.replace(/_{1,2}([^_\n]+)_{1,2}/g, "$1");

  // Strip leading # heading markers — keep the heading text
  out = out.replace(/^#{1,6}\s+/gm, "");

  // Collapse bullet list indentation — one level is enough
  out = out.replace(/^[ \t]{4,}([-*+])/gm, "  $1");

  // Remove trailing spaces on each line
  out = out.replace(/[ \t]+$/gm, "");

  // Collapse 3+ blank lines to one blank line
  out = out.replace(/\n{3,}/g, "\n\n");

  // Merge consecutive short non-bullet lines (< 60 chars) into one paragraph
  const lines = out.split("\n");
  const merged = [];
  let buf = "";
  for (const line of lines) {
    const isBullet = /^\s*[-*+\d]/.test(line);
    const isBlank = line.trim() === "";
    if (!isBullet && !isBlank && line.trim().length < 60 && buf) {
      buf += " " + line.trim();
    } else {
      if (buf) merged.push(buf);
      buf = isBlank ? "" : line;
      if (isBlank) merged.push("");
    }
  }
  if (buf) merged.push(buf);
  out = merged.join("\n").trim();

  return { text: out, savedChars: text.length - out.length };
}
