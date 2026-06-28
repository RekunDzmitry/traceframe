// Optimizer rules config — which techniques are active per profile.

export const PROFILES = {
  balanced: {
    // Layer 2 — synchronous
    trimFiller: true,        // Caveman+ filler removal
    dedupContext: true,      // exact message dedup
    compressSystem: true,    // whitespace + comment strip in system prompt
    shrinkToolDescs: false,  // off — tool descriptions affect capability
    rtk: true,               // repetition killer — fast, safe
    // Layer 2 — async (requires env vars or model inference)
    llmlingua: false,        // sentence-level pruning (heuristic)
    selectiveContext: false, // self-information scoring (heuristic)
    morph: false,            // Morph SaaS API (requires MORPH_API_KEY)
  },
  "max-save": {
    trimFiller: true,
    dedupContext: true,
    compressSystem: true,
    shrinkToolDescs: true,
    rtk: true,
    llmlingua: true,
    selectiveContext: true,
    morph: false,            // still off — needs explicit opt-in via env
  },
  "quality-first": {
    trimFiller: true,
    dedupContext: false,
    compressSystem: false,
    shrinkToolDescs: false,
    rtk: false,
    llmlingua: false,
    selectiveContext: false,
    morph: false,
  },
};

export const DEFAULT_PROFILE = "balanced";

/**
 * Resolve active techniques for a given profile name.
 * Falls back to DEFAULT_PROFILE if unknown.
 */
export function resolveRules(profile) {
  return PROFILES[profile] ?? PROFILES[DEFAULT_PROFILE];
}
