// validate.mjs — check data.js against the invariants declared in the spec.
// Run: node validate.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Shim `window` and load data.js into it.
globalThis.window = {};
const dataSource = readFileSync(join(here, "data.js"), "utf8");
new Function("window", dataSource)(globalThis.window);

const { TRACES, NODES } = globalThis.window;

// ───────────────────────── helpers ─────────────────────────

const issues = [];
const note = (code, where, msg) => issues.push({ code, where, msg });

const VALID_TRACE_STATUS = new Set(["running", "done", "failed"]);
const VALID_NODE_KIND = new Set(["plan", "tool", "llm", "experiment"]);
const VALID_NODE_STATUS = new Set(["ok", "error", "running", "skipped"]);
const VALID_BRANCH_KIND = new Set(["alt-model", "experiment"]);

// ───────────────────────── Trace checks ────────────────────

for (const t of TRACES) {
  const at = `Trace(${t.id})`;
  if (!VALID_TRACE_STATUS.has(t.status)) note("E_TRACE_STATUS", at, `status "${t.status}" not in enum`);
  if (typeof t.duration !== "number" || t.duration < 0) note("E_TRACE_DURATION", at, `duration invalid`);
  if (typeof t.totalTokens !== "number" || t.totalTokens < 0) note("E_TRACE_TOKENS", at, `totalTokens invalid`);
  if (typeof t.totalCost !== "number" || t.totalCost < 0) note("E_TRACE_COST", at, `totalCost invalid`);
  for (const k of ["id", "title", "repo", "branch", "startedAt"]) {
    if (typeof t[k] !== "string" || !t[k]) note("E_TRACE_STRING", at, `${k} missing or non-string`);
  }
}

// ───────────────────────── Node checks ─────────────────────

const byId = new Map(NODES.map((n) => [n.id, n]));
const roots = NODES.filter((n) => n.parent === null);

if (roots.length !== 1) {
  note("E_ROOT_COUNT", "NODES", `expected exactly 1 root, found ${roots.length}`);
}

for (const n of NODES) {
  const at = `Node(${n.id})`;

  // Required scalar fields
  for (const k of ["id", "label", "model", "provider", "input", "output", "summary", "timestamp"]) {
    if (typeof n[k] !== "string") note("E_NODE_STRING", at, `${k} missing or non-string`);
  }
  for (const k of ["inputTokens", "outputTokens", "cost", "latency", "ttft"]) {
    if (typeof n[k] !== "number") note("E_NODE_NUMBER", at, `${k} missing or non-number`);
  }

  // Enums
  if (!VALID_NODE_KIND.has(n.kind)) note("E_NODE_KIND", at, `kind "${n.kind}" not in enum`);
  if (!VALID_NODE_STATUS.has(n.status)) note("E_NODE_STATUS", at, `status "${n.status}" not in enum`);

  // parent must reference existing node or be null
  if (n.parent !== null && !byId.has(n.parent)) {
    note("E_PARENT_REF", at, `parent "${n.parent}" does not exist`);
  }

  // kind === "tool" ⇒ toolCalls.length ≥ 1
  if (n.kind === "tool" && (!Array.isArray(n.toolCalls) || n.toolCalls.length === 0)) {
    note("E_TOOL_NO_CALLS", at, `kind=tool but no toolCalls`);
  }

  // isBranch ⇒ parent !== null
  if (n.isBranch === true && n.parent === null) {
    note("E_BRANCH_ROOT", at, `isBranch=true but parent=null (can't branch off nothing)`);
  }

  // branchKind, if present, must be valid
  if (n.branchKind !== undefined && !VALID_BRANCH_KIND.has(n.branchKind)) {
    note("E_BRANCH_KIND", at, `branchKind "${n.branchKind}" not in enum`);
  }

  // Decision invariants
  const d = n.decision;
  if (!d || typeof d !== "object") {
    note("E_DECISION_MISSING", at, `decision missing`);
  } else {
    if (typeof d.goal !== "string" || !d.goal) note("E_DECISION_GOAL", at, `decision.goal missing`);
    if (typeof d.why !== "string" || !d.why) note("E_DECISION_WHY", at, `decision.why missing`);
    if (!Array.isArray(d.options) || d.options.length < 1) {
      note("E_DECISION_OPTIONS", at, `decision.options must have length ≥ 1`);
    } else {
      const chosenCount = d.options.filter((o) => o.chosen === true).length;
      if (chosenCount !== 1) {
        note("E_DECISION_CHOSEN", at, `exactly 1 option must be chosen, got ${chosenCount}`);
      }
      for (const [i, o] of d.options.entries()) {
        if (typeof o.label !== "string" || !o.label) note("E_OPTION_LABEL", `${at}.options[${i}]`, `label missing`);
        if (typeof o.reason !== "string" || !o.reason) note("E_OPTION_REASON", `${at}.options[${i}]`, `reason missing`);
        if (typeof o.chosen !== "boolean") note("E_OPTION_CHOSEN", `${at}.options[${i}]`, `chosen must be boolean`);
      }
    }
  }

  // ToolCall shape
  for (const [i, tc] of (n.toolCalls || []).entries()) {
    const tat = `${at}.toolCalls[${i}]`;
    if (typeof tc.name !== "string" || !tc.name) note("E_TC_NAME", tat, `name missing`);
    if (typeof tc.result !== "string") note("E_TC_RESULT", tat, `result missing`);
    if (tc.args == null || typeof tc.args !== "object") note("E_TC_ARGS", tat, `args must be an object`);
  }
}

// ───────────────────────── Cross-entity notes ───────────────
// The spec declares Node.traceId as a production addition — absent in the mock.
// Flag that explicitly so it's visible in the report (info, not an error).
const missingTraceId = NODES.some((n) => n.traceId === undefined);
if (missingTraceId) {
  note(
    "I_NODE_TRACEID",
    "NODES[*]",
    "traceId is absent in mock data (spec §1.2: 'not in prototype's mock; add for storage') — expected drift"
  );
}

// Trace totals can't be verified without traceId join; flag as info.
note(
  "I_TOTALS",
  "TRACES[*]",
  "totalTokens/totalCost cannot be verified: mock nodes lack traceId to join on"
);

// ───────────────────────── Report ──────────────────────────

const errors = issues.filter((i) => i.code.startsWith("E_"));
const infos = issues.filter((i) => i.code.startsWith("I_"));

const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);

console.log(`\ntraceframe — data.js validation`);
console.log("─".repeat(60));
console.log(`Traces: ${TRACES.length}   Nodes: ${NODES.length}`);
console.log(`Errors: ${errors.length}   Info: ${infos.length}`);
console.log("─".repeat(60));

if (errors.length) {
  console.log("\nERRORS");
  for (const e of errors) {
    console.log(`  [${pad(e.code, 18)}] ${pad(e.where, 22)} ${e.msg}`);
  }
}
if (infos.length) {
  console.log("\nINFO (expected drift / known gaps)");
  for (const i of infos) {
    console.log(`  [${pad(i.code, 18)}] ${pad(i.where, 22)} ${i.msg}`);
  }
}

if (errors.length === 0) {
  console.log("\n✓ data.js conforms to the spec's invariants.\n");
  process.exit(0);
} else {
  console.log(`\n✗ ${errors.length} invariant violation(s).\n`);
  process.exit(1);
}
