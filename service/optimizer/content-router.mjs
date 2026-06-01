// Layer 1: Content Router — detect content type per message/string.
// Routes content to the appropriate compressor in the pipeline.
// Inspired by headroom's Content Router approach.

/** @typedef {'code' | 'json' | 'shell' | 'markdown' | 'text'} ContentType */

const CODE_SIGNALS = [
  /\b(function|const|let|var|class|import|export|return|async|await)\b/,
  /\b(def |if __name__|import |from .+ import)\b/,   // python
  /\b(fn |pub |impl |use |mod )\b/,                   // rust
  /^\s*(\/\/|#|\/\*|\*)/m,                            // comments
  /[{};]\s*$/m,                                       // c-style line endings
];

const SHELL_SIGNALS = [
  /^\$\s+/m,
  /^(npm|yarn|pnpm|bun|cargo|go|python|pip|git|docker|kubectl)\s/im,
  /^(error|warning|info|debug):/im,
  /^\s+at .+ \(.*:\d+:\d+\)/m,   // stack trace
  /^[\w.-]+@[\w.-]+:/m,           // npm package@version
  /^On branch /m,                 // git status
  /^PASS|FAIL\s/m,                // test runner
];

const JSON_SIGNALS = [
  /^\s*[{[]/,
  /"\w+"\s*:/,
];

const MARKDOWN_SIGNALS = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+/m,
  /\[.+\]\(.+\)/,
  /^>{1,3}\s/m,
];

/**
 * Detect the content type of a text string.
 * @param {string} text
 * @returns {ContentType}
 */
export function detectContentType(text) {
  if (!text || text.length < 3) return "text";

  const trimmed = text.trim();

  // JSON: try parse first for short strings, otherwise pattern match
  if (JSON_SIGNALS.every((rx) => rx.test(trimmed))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
    }
  }

  const codeScore = CODE_SIGNALS.filter((rx) => rx.test(text)).length;
  const shellScore = SHELL_SIGNALS.filter((rx) => rx.test(text)).length;
  const markdownScore = MARKDOWN_SIGNALS.filter((rx) => rx.test(text)).length;

  const max = Math.max(codeScore, shellScore, markdownScore);
  if (max === 0) return "text";
  if (shellScore === max && shellScore >= 1) return "shell";
  if (codeScore === max && codeScore >= 2) return "code";
  if (markdownScore === max && markdownScore >= 1) return "markdown";
  return "text";
}

/**
 * Label each message in a context array with its content type.
 * @param {Array<{role:string, content:string}>} messages
 * @returns {Array<{role:string, content:string, contentType:ContentType}>}
 */
export function routeMessages(messages) {
  return messages.map((m) => ({
    ...m,
    contentType: detectContentType(m.content),
  }));
}
