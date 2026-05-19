// Layer 4: Session Guard — Waste Factor monitoring + rotation recommendation.
// Inspired by clauditor's seven-hook architecture.
//
// Waste Factor = avg tokens/turn (last N turns) ÷ baseline (first B turns)
// Thresholds: warn at 3x, rotate at 10x

const BASELINE_TURNS = 3;   // turns used to establish baseline (healthy early turns only)
const RECENT_TURNS = 3;     // turns used to calculate current avg
const WARN_THRESHOLD = 3;
const ROTATE_THRESHOLD = 10;

/**
 * @typedef {{ turnIndex: number, tokens: number }} TurnStat
 * @typedef {'ok' | 'warn' | 'rotate'} SessionStatus
 */

/**
 * Calculate average tokens over a slice of turns.
 * @param {TurnStat[]} turns
 * @returns {number}
 */
function avg(turns) {
  if (!turns.length) return 0;
  return turns.reduce((s, t) => s + t.tokens, 0) / turns.length;
}

/**
 * Build a handoff template for session rotation.
 * @param {{ task?: string, completedSteps?: string[], failedApproaches?: string[], dependencies?: string[] }} ctx
 * @returns {string}
 */
export function buildHandoff({ task = "", completedSteps = [], failedApproaches = [], dependencies = [] } = {}) {
  const lines = ["## Session Handoff", ""];
  if (task) lines.push(`**Task:** ${task}`, "");
  if (completedSteps.length) {
    lines.push("**Completed:**");
    completedSteps.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (failedApproaches.length) {
    lines.push("**Failed approaches (do not retry):**");
    failedApproaches.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (dependencies.length) {
    lines.push("**Dependencies / context to reload:**");
    dependencies.forEach((s) => lines.push(`- ${s}`));
  }
  return lines.join("\n").trim();
}

/**
 * Evaluate session health and return a recommendation.
 *
 * @param {TurnStat[]} turns  — ordered oldest → newest
 * @param {{
 *   warnThreshold?: number,
 *   rotateThreshold?: number,
 *   handoffCtx?: object,
 * }} [opts]
 * @returns {{
 *   status: SessionStatus,
 *   wasteFactor: number,
 *   baselineAvg: number,
 *   recentAvg: number,
 *   totalTurns: number,
 *   totalTokens: number,
 *   message: string,
 *   handoff?: string,
 * }}
 */
export function evaluateSession(turns, { warnThreshold = WARN_THRESHOLD, rotateThreshold = ROTATE_THRESHOLD, handoffCtx } = {}) {
  if (!turns || turns.length < 2) {
    return {
      status: "ok",
      wasteFactor: 1,
      baselineAvg: 0,
      recentAvg: 0,
      totalTurns: turns?.length ?? 0,
      totalTokens: turns?.reduce((s, t) => s + t.tokens, 0) ?? 0,
      message: "Not enough turns to evaluate.",
    };
  }

  const baseline = avg(turns.slice(0, BASELINE_TURNS));
  const recent = avg(turns.slice(-RECENT_TURNS));
  const wasteFactor = baseline > 0 ? Math.round((recent / baseline) * 10) / 10 : 1;
  const totalTokens = turns.reduce((s, t) => s + t.tokens, 0);

  let status = "ok";
  let message = `Session healthy. Waste factor: ${wasteFactor}x`;

  if (wasteFactor >= rotateThreshold) {
    status = "rotate";
    message = `⚠ Rotate session. Waste factor ${wasteFactor}x exceeds ${rotateThreshold}x threshold. Start a new session with the handoff below.`;
  } else if (wasteFactor >= warnThreshold) {
    status = "warn";
    message = `Session degrading. Waste factor ${wasteFactor}x. Consider rotating soon.`;
  }

  const result = {
    status,
    wasteFactor,
    baselineAvg: Math.round(baseline),
    recentAvg: Math.round(recent),
    totalTurns: turns.length,
    totalTokens,
    message,
  };

  if (status === "rotate" && handoffCtx) {
    result.handoff = buildHandoff(handoffCtx);
  }

  return result;
}
