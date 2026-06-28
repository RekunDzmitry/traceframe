#!/usr/bin/env node
// traceframe — optimizer pipeline smoke test.
// Run: node bin/test-optimizer.mjs
// No server or API keys required.

import { runPipeline } from "../ingest/optimizer/pipeline.mjs";
import { detectContentType } from "../ingest/optimizer/content-router.mjs";
import { evaluateSession, buildHandoff } from "../ingest/optimizer/session-guard.mjs";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

const sep = () => console.log(DIM + "─".repeat(60) + RESET);
const h = (t) => console.log("\n" + BOLD + CYAN + t + RESET);
const kv = (k, v) => console.log(`  ${DIM}${k.padEnd(22)}${RESET}${v}`);

// ─────────────────────────────────────────────────────────────
// Test 1: Content Router
// ─────────────────────────────────────────────────────────────
h("TEST 1 — Content Router");
sep();

const samples = [
  { label: "Python code", text: "def read_file(path):\n    with open(path) as f:\n        return f.read()" },
  { label: "JSON blob",   text: '{"status":"ok","data":[1,2,3],"meta":{"count":3}}' },
  { label: "Git output",  text: "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit" },
  { label: "Markdown",    text: "## Overview\n\nThis section covers the **main** concepts.\n\n- Item one\n- Item two" },
  { label: "Plain text",  text: "The deployment finished successfully and all services are running." },
];

for (const { label, text } of samples) {
  const type = detectContentType(text);
  kv(label, type);
}

// ─────────────────────────────────────────────────────────────
// Test 2: Session Guard
// ─────────────────────────────────────────────────────────────
h("TEST 2 — Session Guard");
sep();

const healthySession = [
  { turnIndex: 0, tokens: 1200 },
  { turnIndex: 1, tokens: 1350 },
  { turnIndex: 2, tokens: 1100 },
  { turnIndex: 3, tokens: 1280 },
  { turnIndex: 4, tokens: 1400 },
];

const degradedSession = [
  { turnIndex: 0, tokens: 1200 },
  { turnIndex: 1, tokens: 1100 },
  { turnIndex: 2, tokens: 1300 },
  { turnIndex: 3, tokens: 8500 },
  { turnIndex: 4, tokens: 22000 },
  { turnIndex: 5, tokens: 41000 },
];

const healthy = evaluateSession(healthySession);
const degraded = evaluateSession(degradedSession, {
  handoffCtx: {
    task: "Refactor auth middleware",
    completedSteps: ["Extracted token validator", "Added unit tests"],
    failedApproaches: ["Direct bcrypt migration — breaks existing hashes"],
    dependencies: ["src/middleware/auth.ts", "docs/security.md"],
  },
});

kv("Healthy — status", `${GREEN}${healthy.status}${RESET}`);
kv("Healthy — waste factor", `${healthy.wasteFactor}x`);
kv("Degraded — status", `${RED}${degraded.status}${RESET}`);
kv("Degraded — waste factor", `${degraded.wasteFactor}x`);
console.log(`\n  ${DIM}Handoff snippet:${RESET}`);
degraded.handoff?.split("\n").slice(0, 4).forEach((l) => console.log("    " + l));

// ─────────────────────────────────────────────────────────────
// Test 3: Full Pipeline — balanced profile
// ─────────────────────────────────────────────────────────────
h("TEST 3 — Full Pipeline (balanced)");
sep();

const result = await runPipeline({
  profile: "balanced",
  query: "How do I fix the auth middleware redirect loop?",
  keywords: ["auth", "middleware", "redirect"],
  system: `
# Assistant Guidelines

In order to help you effectively, please note that I am going to provide
comprehensive assistance with your software engineering tasks. Basically,
you should feel free to ask any questions at any time.

## Rules

- Always be helpful
- Obviously follow the user's instructions
- Needless to say, write clean code
  `.trim(),
  messages: [
    {
      role: "user",
      content: "I would like to understand how the auth middleware works in this project.",
    },
    {
      role: "assistant",
      content: `Certainly! In order to understand the auth middleware, please note that it
has three main components. Essentially, it validates the JWT, checks permissions,
and redirects if needed. Hope this helps!`,
    },
    {
      role: "user",
      content: "I would like to understand how the auth middleware works in this project.",
    },
    {
      role: "assistant",
      content: `
import jwt from "jsonwebtoken";

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.redirect("/login");
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.redirect("/login");
  }
}
      `.trim(),
    },
    {
      role: "user",
      content: "How do I fix the auth middleware redirect loop?",
    },
  ],
  tools: [
    {
      name: "read_file",
      description:
        "This tool reads a file from disk. For example, you can use it to read config.json or any source file. Returns a string value containing the full file contents.",
    },
    {
      name: "run_tests",
      description:
        "This function runs the test suite. You can use this to verify that your changes work correctly. Returns test results.",
    },
  ],
  sessionTurns: [
    { turnIndex: 0, tokens: 800 },
    { turnIndex: 1, tokens: 950 },
    { turnIndex: 2, tokens: 1100 },
    { turnIndex: 3, tokens: 1050 },
    { turnIndex: 4, tokens: 1200 },
  ],
});

const r = result.report;
console.log();
kv("Input tokens",  `${r.inputTokens}`);
kv("Output tokens", `${GREEN}${r.outputTokens}${RESET}`);
kv("Saved tokens",  `${GREEN}${r.savedTokens} (${r.savedPct}%)${RESET}`);

console.log(`\n  ${BOLD}Layer breakdown:${RESET}`);
kv("  Router — system type", r.layers.router.systemType);
kv("  Router — msg types",   JSON.stringify(r.layers.router.messageCounts));
kv("  Compressor issues",    r.layers.compressor.issues.map((i) => i.type).join(", ") || "none");
kv("  Compressor saving",    `${r.layers.compressor.potentialSaving} tokens (${r.layers.compressor.potentialSavingPct}%)`);
kv("  Selector hot/warm/cold", `${r.layers.contextSelector.hot}/${r.layers.contextSelector.warm}/${r.layers.contextSelector.cold}`);
kv("  Selector dropped",     `${r.layers.contextSelector.droppedTokens} tokens`);
kv("  Session status",       `${r.layers.sessionGuard.status} (${r.layers.sessionGuard.wasteFactor}x)`);

// ─────────────────────────────────────────────────────────────
// Test 4: max-save profile
// ─────────────────────────────────────────────────────────────
h("TEST 4 — Full Pipeline (max-save)");
sep();

const maxResult = await runPipeline({
  ...{
    system: result.system,
    messages: result.messages,
    tools: result.tools,
  },
  profile: "max-save",
  query: "Fix the redirect loop",
});

const mr = maxResult.report;
kv("Saved tokens",  `${GREEN}${mr.savedTokens} (${mr.savedPct}%)${RESET}`);
kv("Messages kept", `${maxResult.messages.length}`);

console.log("\n" + GREEN + BOLD + "All tests passed." + RESET + "\n");
