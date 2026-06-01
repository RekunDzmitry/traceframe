// Optimizer rules config — which techniques are active per profile.
// Designed as the foundation for Task 13 (Rules Engine) and Task 14 (Profiles).

export const PROFILES = {
  balanced: {
    trimFiller: true,
    dedupContext: true,
    compressSystem: true,
    shrinkToolDescs: false,  // off by default — tools affect agent capability
  },
  "max-save": {
    trimFiller: true,
    dedupContext: true,
    compressSystem: true,
    shrinkToolDescs: true,
  },
  "quality-first": {
    trimFiller: true,
    dedupContext: false,
    compressSystem: false,
    shrinkToolDescs: false,
  },
};

export const DEFAULT_PROFILE = "balanced";

/**
 * Resolve active techniques for a given profile name.
 * Falls back to DEFAULT_PROFILE if unknown.
 * @param {string} [profile]
 * @returns {{ trimFiller: boolean, dedupContext: boolean, compressSystem: boolean, shrinkToolDescs: boolean }}
 */
export function resolveRules(profile) {
  return PROFILES[profile] ?? PROFILES[DEFAULT_PROFILE];
}
