// traceframe — canonical data model types
// Source of truth: docs/superpowers/specs/2026-04-21-traceframe-data-model-design.md
// Resolved 2026-04-21.

// ───────────────────────── Primitives ─────────────────────────

export type ISOTimestamp = string; // RFC 3339, UTC, e.g. "2026-04-20T14:22:17Z"
export type ISODate = string;      // "2026-04-20"
export type Millis = number;       // integer milliseconds
export type USD = number;

// ───────────────────────── §1 Trace graph ─────────────────────

export type TraceId = string;      // "trc_" + hex
export type NodeId = string;       // trace-local, "n1", "n4a"
export type ModelId = string;      // canonical model id
export type ToolName = string;     // open set: search_fs, read_file, edit_file, run_tests, …
export type FilePath = string;     // repo-relative POSIX

export type TraceStatus = "running" | "done" | "failed";
export type NodeKind = "plan" | "tool" | "llm" | "experiment";
export type NodeStatus = "ok" | "error" | "running" | "skipped";
export type Provider = "anthropic" | "openai" | "google" | "meta" | (string & {});
export type BranchKind = "alt-model" | "experiment";
export type Role = "system" | "user" | "tool_result" | "assistant";

export interface Trace {
  id: TraceId;
  title: string;
  repo: string;
  branch: string;
  startedAt: ISOTimestamp;
  duration: Millis;
  totalTokens: number;
  totalCost: USD;
  status: TraceStatus;
}

export interface DecisionOption {
  label: string;
  chosen: boolean;        // exactly one option per decision is chosen
  reason: string;
}

export interface Decision {
  goal: string;
  options: DecisionOption[];  // length ≥ 1
  why: string;
}

export interface BlobRef {
  uri: string;            // e.g. "s3://traceframe/trc_9f2a/n3/read_file.txt"
  bytes: number;
  contentType: string;
}

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
  result: string;         // return summary (may be truncated)
  resultRef?: BlobRef;    // pointer to full result in blob storage
  latency?: Millis;
  status?: NodeStatus;
}

export interface Node {
  id: NodeId;
  traceId: TraceId;
  parent: NodeId | null;  // null only for the root; exactly one root per trace
  kind: NodeKind;
  label: string;
  summary: string;

  // Execution
  model: ModelId;
  provider: Provider;
  tools: ToolName[];
  files: FilePath[];

  // Telemetry
  inputTokens: number;
  outputTokens: number;
  cost: USD;
  latency: Millis;
  ttft: Millis;
  status: NodeStatus;
  timestamp: ISOTimestamp;

  // LLM payload
  input: string;
  output: string;
  toolCalls: ToolCall[];  // if kind === "tool", length ≥ 1

  // Reasoning surface
  decision: Decision;

  // Branch metadata (present only for alt branches). Sibling semantics:
  // when a user branches from node N, newNode.parent = N.parent (not N).
  isBranch?: boolean;
  branchLabel?: string;
  branchKind?: BranchKind;

  // UI hints (ui-only)
  highlighted?: boolean;
}

// Computed at read time — never stored.
export interface NodeDerived {
  children: NodeId[];
  siblings: NodeId[];
  ancestorChain: NodeId[];  // root → this
  depth: number;
}

// ───────────────────────── §2 Branch experiment ───────────────

// Persisted shape — lives in BranchExperimentSpec.context and goes to the provider.
export interface ContextMessage {
  role: Role;
  content: string;
  source: NodeId | "system";
}

// UI superset — never serialized. The panel strips these before submit.
// Disabled messages are filtered out; collapsed is session-local.
export interface ContextMessageUI extends ContextMessage {
  enabled: boolean;
  collapsed: boolean;
}

export interface BranchExperimentSpec {
  sourceNodeId: NodeId;   // new node's parent = sourceNode.parent (sibling)
  traceId: TraceId;

  // Model config
  model: ModelId;
  provider: Provider;
  temperature: number;    // [0, 2] typical
  topP: number;           // (0, 1]
  maxOutputTokens?: number;

  // Prompt
  userMessage: string;

  // Context — built from sourceNode's ancestor chain, then user-edited
  context: ContextMessage[];

  // Informational live estimates; recompute server-side
  estInputTokens?: number;
  estOutputTokens?: number;
  estCost?: USD;
}

export interface ModelEntry {
  id: ModelId;
  provider: Provider;
  inputCostPerMTok: USD;   // $ per million input tokens
  outputCostPerMTok: USD;
  contextWindow?: number;
  capabilities?: string[]; // "tool-use", "vision", …
}

// §2.4 Provider adapters — canonical model stays provider-agnostic; each
// provider has a thin adapter at the HTTP boundary.
export type NodePartial = Partial<Pick<
  Node,
  | "output"
  | "inputTokens"
  | "outputTokens"
  | "cost"
  | "latency"
  | "ttft"
  | "status"
  | "toolCalls"
>>;

export type ProviderRequest = Record<string, unknown>; // provider-specific

export interface ProviderAdapter {
  provider: Provider;
  toRequest(spec: BranchExperimentSpec, catalog: ModelEntry): ProviderRequest;
  fromResponse(raw: unknown): NodePartial;
}

export interface SavedExperiment {
  id: string;             // "exp_cheap_sweep"
  name: string;
  createdAt: ISOTimestamp;
  specs: BranchExperimentSpec[];
  notes?: string;
}

// ───────────────────────── §3 Wiki ────────────────────────────

export type WikiSlug = string;

export interface WikiPage {
  slug: WikiSlug;         // unique map key; used by [[wikilinks]]
  title: string;
  tags: string[];
  updated: ISODate;
  body: string;           // markdown with [[wikilinks]]
  links: WikiSlug[];      // outgoing — denormalized from body for fast backlinks
}

export interface WikiDerived {
  backlinks: WikiSlug[];
  localGraph: {
    nodes: WikiSlug[];
    edges: [WikiSlug, WikiSlug][];
  };
}

// ───────────────────────── §4 Code graph ──────────────────────

export type SymbolId = string;
export type SymbolKind = "module" | "fn" | "const" | "class" | "type" | (string & {});
export type EdgeKind =
  | "calls"
  | "uses"
  | "reads"
  | "extends"
  | "imports"
  | "redirect-loop"
  | (string & {});
export type EdgeTag = "bug" | "proposed";

export interface TraceTouch {
  traceId: TraceId;
  nodeId: NodeId;
  role: "main-fix" | "proposed-refactor" | "read" | "edit" | (string & {});
}

export interface CodeSymbol {
  id: SymbolId;
  kind: SymbolKind;
  label: string;
  parent?: SymbolId;      // enclosing module

  // Production additions
  file?: FilePath;
  signature?: string;
  line?: number;

  // Telemetry (ui hints)
  hot?: boolean;
  warn?: boolean;

  // Trace × code join
  touchedBy?: TraceTouch[];

  // Identity across renames — cached chain, oldest → newest
  previousIds?: SymbolId[];

  // Layout hints (ui-only)
  x?: number;
  y?: number;
}

export interface CodeEdge {
  from: SymbolId;
  to: SymbolId;
  kind: EdgeKind;
  tag?: EdgeTag;
}

// Append-only log — one row per rename event
export interface SymbolRename {
  from: SymbolId;
  to: SymbolId;
  at: ISOTimestamp;
  commit?: string;
  reason?: "rename" | "move" | "split" | "merge" | (string & {});
}

export interface CodeSymbolDerived {
  callers: SymbolId[];    // e.from | e.to === this.id && e.kind === "calls"
  callees: SymbolId[];    // e.to   | e.from === this.id && e.kind === "calls"
}
