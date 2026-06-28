// Morph — SaaS prompt compression API adapter.
//
// Morph (morph.so) provides a hosted endpoint that compresses prompts while
// preserving semantic meaning, without requiring a local model.
//
// Configure via environment variables:
//   MORPH_API_URL  — full endpoint URL (e.g. https://api.morph.so/v1/compress)
//   MORPH_API_KEY  — Bearer token
//   MORPH_MODEL    — optional model parameter (default: "default")
//
// If either env var is missing, morphCompress() is a no-op and returns the
// original text, so the pipeline degrades gracefully.
//
// Integration point: async Layer 2 step in pipeline.mjs when profile requires it.

const MORPH_URL = process.env.MORPH_API_URL;
const MORPH_KEY = process.env.MORPH_API_KEY;
const MORPH_MODEL = process.env.MORPH_MODEL || "default";
const MORPH_TIMEOUT_MS = 5000;

/**
 * Compress text via the Morph API. No-op if env vars are not configured.
 *
 * @param {string} text
 * @param {{ model?: string, ratio?: number }} options
 * @returns {Promise<{ text: string, savedChars: number, via: string }>}
 */
export async function morphCompress(text, { model = MORPH_MODEL, ratio } = {}) {
  if (!MORPH_URL || !MORPH_KEY || !text) {
    return { text, savedChars: 0, via: "skip" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MORPH_TIMEOUT_MS);

  try {
    const body = { text, model };
    if (ratio != null) body.target_ratio = ratio;

    const res = await fetch(MORPH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MORPH_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      console.warn(`morph: API returned ${res.status}, falling back`);
      return { text, savedChars: 0, via: "fallback" };
    }

    const data = await res.json();
    const compressed = data.compressed_prompt || data.text || text;
    return {
      text: compressed,
      savedChars: Math.max(0, text.length - compressed.length),
      via: "morph",
    };
  } catch (e) {
    if (e.name !== "AbortError") console.warn(`morph: ${e.message}, falling back`);
    return { text, savedChars: 0, via: "fallback" };
  } finally {
    clearTimeout(timer);
  }
}

export const morphAvailable = () => Boolean(MORPH_URL && MORPH_KEY);
