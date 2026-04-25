# traceframe — data model

**Date:** 2026-04-21
**Status:** Draft — extracted from the HTML prototype (`observability.html` / `data.js` / `wiki.jsx`).
**Purpose:** Formalize the entities the prototype already renders so a real backend / schema / API can be built against them without re-deriving shape from mock JS.

## Conventions

- Type definitions are TypeScript-flavored. Treat them as the canonical contract; a concrete implementation may translate to a SQL schema, Protobuf, Pydantic, Zod, etc.
- `ISOTimestamp` = RFC 3339 string, always UTC. The prototype stores `"14:22:08"` / `"2026-04-20 14:22:08"` as display strings — the real model stores full UTC timestamps and lets the UI format.
- `Millis` = integer milliseconds. `USD` = number (cents of a dollar precision is fine; no `bigint`).
- Fields marked `// ui` are presentation-only (precomputed positions, sort hints, badges); a real producer may omit them and let the client compute.
- Fields marked `// derived` are computed from other fields at read time (backlinks, siblings, ancestor chain). Do not store.

---

## 1. Trace graph

The core entity: a `Trace` is a rooted DAG of `Node`s representing an agent run, plus alternate branches explored either by the agent (different model) or by a human (experiment from the inline branch panel).

### 1.1 `Trace`

```ts
interface Trace {
  id: TraceId;              // e.g. "trc_9f2a" — opaque, stable
  title: string;             // human summary ("Fix: login redirect loop on SSO")
  repo: string;              // "acme/web"
  branch: string;            // git branch this run targeted
  startedAt: ISOTimestamp;
  duration: Millis;          // wall-clock run time; for `running` traces, freeze at last event
  totalTokens: number;       // sum over all nodes, including branches
  totalCost: USD;
  status: TraceStatus;
}

type TraceId = string;       // "trc_" + 4+ hex chars
type TraceStatus = "running" | "done" | "failed";
```

Invariants:
- `totalTokens` / `totalCost` MUST equal sum of the corresponding node fields (keep denormalized for cheap list rendering; recompute on write).
- `duration` for `status: "running"` is monotone — UI may display a live ticker on top.

### 1.2 `Node`

Every LLM step, tool call, plan step, or branch experiment is a `Node`. Nodes form a tree via `parent`. Multiple nodes may share a `parent` — those are sibling branches (visible in the tree side-by-side).

```ts
interface Node {
  id: NodeId;                // trace-local, e.g. "n1", "n4a" — unique within a Trace
  traceId: TraceId;          // MUST match owning trace (not in prototype's mock; add for storage)
  parent: NodeId | null;     // null only for the root node of the main line
  kind: NodeKind;
  label: string;             // short tag shown on the node chip ("analyze callback")
  summary: string;           // one-line description for the detail header

  // Execution
  model: ModelId;            // "claude-sonnet-4.5", "gpt-5", …
  provider: Provider;        // redundant with `model` but cached for filters
  tools: ToolName[];         // tools invoked from this node (empty for pure-LLM nodes)
  files: FilePath[];         // files touched by this node (read/edit/etc.)

  // Telemetry
  inputTokens: number;
  outputTokens: number;
  cost: USD;                 // billed cost for this node only
  latency: Millis;           // end-to-end
  ttft: Millis;              // time-to-first-token
  status: NodeStatus;
  timestamp: ISOTimestamp;   // when the node started

  // LLM payload
  input: string;             // full rendered input (system + user + tool_results, pre-formatted)
  output: string;            // assistant response text
  toolCalls: ToolCall[];     // tool calls made within this node

  // Decision (the explicit reasoning surface — the prototype's flagship feature)
  decision: Decision;

  // Branch metadata (present only for alt branches)
  isBranch?: boolean;                  // true if this node sits off the main line
  branchLabel?: string;                // "another model", "new approach"
  branchKind?: BranchKind;             // see §1.5

  // UI hints
  highlighted?: boolean;     // ui — pulse the node in the tree (used for the "aha" bug node)
}

type NodeId = string;
type NodeKind = "plan" | "tool" | "llm" | "experiment";
type NodeStatus = "ok" | "error" | "running" | "skipped";
type Provider = "anthropic" | "openai" | "google" | "meta" | string; // open set
type ModelId = string;       // canonical model id; pricing looked up in ModelCatalog (§2.2)
type ToolName = string;      // "search_fs", "read_file", "edit_file", "run_tests", …
type FilePath = string;      // repo-relative POSIX path
```

`NodeKind` interpretation:
- `plan` — LLM step producing a plan, no tool calls (e.g., n1).
- `tool` — node whose primary action was a tool invocation (n2, n3, n5, n6). `toolCalls.length > 0`.
- `llm` — reasoning step, may also call tools (n4). The distinction from `tool` is authorial: `kind` reflects the *intent* of the step, not just presence of tool calls.
- `experiment` — human-initiated branch from the inline panel. Always has `isBranch: true`.

Invariants:
- `parent` must reference an existing `Node.id` in the same trace, or be null.
- Exactly one node per trace has `parent: null` (the root). This is enforced by the storage layer.
- If `kind === "tool"`, then `toolCalls.length >= 1`.
- `isBranch === true` ⇒ `parent !== null` (can't branch off nothing).

Derived at read time:
```ts
// derived — compute in the UI / API response, don't store
interface NodeDerived {
  children: NodeId[];          // all nodes whose `parent === this.id`
  siblings: NodeId[];          // nodes sharing this.parent, excluding this
  ancestorChain: NodeId[];     // root → this (used by the branch panel to build context)
  depth: number;               // distance from root
}
```

### 1.3 `Decision`

The centerpiece of the prototype. Every node has one. It answers *what did the LLM choose and why* in a structured way so a human can audit reasoning without reading the full transcript.

```ts
interface Decision {
  goal: string;                  // what this node was trying to accomplish
  options: DecisionOption[];     // considered alternatives
  why: string;                   // tie-breaking rationale between the chosen option and the runners-up
}

interface DecisionOption {
  label: string;                 // short restatement
  chosen: boolean;               // exactly one option per decision has chosen: true
  reason: string;                // why this option was picked / rejected
}
```

Invariants:
- `options.length >= 1`.
- Exactly one `option.chosen === true`.

UI note: the detail panel renders three tabs — **Structured** (goal → options → chosen → why), **Annotated** (`input` + `output` with red/green highlights on bug signal vs. decision), **Diff** (diff of `input` vs parent's `output`). All three read from the same `Decision` + `input`/`output` fields; no extra storage.

### 1.4 `ToolCall`

```ts
interface ToolCall {
  name: ToolName;                // matches one of Node.tools
  args: Record<string, unknown>; // stringified in the UI but stored as JSON
  result: string;                // the tool's return summary (may be truncated — store raw separately if large)
  resultRef?: BlobRef;           // optional pointer to full result in blob storage
  latency?: Millis;
  status?: NodeStatus;           // defaults to node's status
}

interface BlobRef {
  uri: string;                   // e.g. "s3://traceframe/trc_9f2a/n3/read_file.txt"
  bytes: number;
  contentType: string;           // "text/plain", "application/json", …
}
```

### 1.5 Branching model

Two kinds of alt branches exist, both represented as extra `Node`s with shared `parent`:

```ts
type BranchKind =
  | "alt-model"     // agent-internal: same prompt, different model (e.g., n4a ran gpt-5 alongside n4)
  | "experiment";   // human-initiated from the branch panel (e.g., n4b)
```

- `alt-model` branches are created by the agent's runtime (or a retry harness) and have `kind: "llm" | "tool" | "plan"`.
- `experiment` branches are created by the user and always have `kind: "experiment"`.
- Both set `isBranch: true` and populate `branchLabel`.
- A branch's children can grow into a full subtree of its own — there's no structural difference between a main-line subtree and a branch subtree.

**Sibling semantics (resolved).** When a user branches from node `N`, the new node is created as a **sibling** of `N`, not a child: `newNode.parent = N.parent`. Rationale: "branching from n4" means "try a different n4", not "try something after n4". This matches the prototype (`n4b.parent === n3`, the same parent as `n4`).

---

## 2. Branch experiment

The inline panel on a selected node lets the user re-run the step with a different model / prompt / context. When submitted, it produces a new `Node` (usually with `branchKind: "experiment"`) rooted at the current node's `parent`.

### 2.1 `BranchExperimentSpec` (the runtime payload)

```ts
interface BranchExperimentSpec {
  sourceNodeId: NodeId;          // the node the user branched from — new node's parent = sourceNode.parent (sibling)
  traceId: TraceId;

  // Model config
  model: ModelId;
  provider: Provider;
  temperature: number;           // [0, 2] typical
  topP: number;                  // (0, 1]
  maxOutputTokens?: number;

  // Prompt
  userMessage: string;           // the "task" the user wants re-tried

  // Context — built from sourceNode's ancestor chain, then user-edited
  context: ContextMessage[];

  // Estimated cost shown live in the panel (informational; recompute server-side)
  estInputTokens?: number;
  estOutputTokens?: number;
  estCost?: USD;
}
```

### 2.2 `ContextMessage`

Each message the LLM will see. The prototype builds this from the ancestor chain via `buildContextChain(node)`:

1. One `system` message (root system prompt).
2. For each ancestor node, in root→current order:
   - Any `<user>…</user>` blocks in `node.input` become `user` messages.
   - Each `node.toolCalls[i]` becomes a `tool_result` message (`"${name}(${args}) → ${result}"`).
   - `node.output` becomes an `assistant` message (skip for the branched-from node — that output is what we're re-generating).

```ts
// Persisted shape — what lives in BranchExperimentSpec.context and gets sent to the provider
interface ContextMessage {
  role: Role;
  content: string;
  source: NodeId | "system";     // where this message came from (for attribution in the UI)
}

// UI superset — never serialized. The panel strips `enabled`/`collapsed` before submit.
// Disabled messages are filtered out (not sent); collapsed is purely cosmetic.
interface ContextMessageUI extends ContextMessage {
  enabled: boolean;              // ui — user toggles without deleting
  collapsed: boolean;            // ui — fold/unfold in the panel
}

type Role = "system" | "user" | "tool_result" | "assistant";
```

Invariants:
- `role === "system"` messages typically appear once at the start, but the data model doesn't forbid multiple (some providers support role interleaving).
- `source === "system"` only for the root system prompt; every other message's `source` is a real `NodeId`.
- `enabled` and `collapsed` MUST NOT be persisted. Disabled messages are filtered out before the spec is written or sent; collapsed state is session-local.

### 2.3 `ModelCatalog`

Needed to compute cost estimates live. The prototype inlines this in `branch.jsx`; a real implementation stores it server-side and bumps on price changes.

```ts
interface ModelEntry {
  id: ModelId;
  provider: Provider;
  inputCostPerMTok: USD;         // e.g. 3 = $3 per million input tokens
  outputCostPerMTok: USD;
  contextWindow?: number;        // tokens
  capabilities?: string[];       // "tool-use", "vision", …
}
```

### 2.4 Provider adapters

The canonical data model (`ContextMessage` + `BranchExperimentSpec`) is **provider-agnostic**. Translation to a provider's native request shape happens in a thin adapter at the HTTP boundary — not in storage, not in the UI.

```ts
interface ProviderAdapter {
  provider: Provider;
  toRequest(spec: BranchExperimentSpec, catalog: ModelEntry): ProviderRequest;
  fromResponse(raw: unknown): NodePartial;       // what to persist on the resulting Node
}
```

Adapter responsibilities:
- Map our unified `Role` to native roles. E.g., `tool_result` → OpenAI `{role: "tool"}` vs. Anthropic `{role: "user", content: [{type: "tool_result", …}]}`.
- Fold `temperature`, `topP`, `maxOutputTokens` into the native params object.
- Handle streaming → non-streaming reassembly (for the persistent `Node.output`).
- Normalize token-usage and cost fields back to our units.

Why this boundary: the stored `ContextMessage` stays portable (you can re-run the same spec against a new provider without rewriting it), the UI renders one shape, and adding a provider is a new adapter — no migration.

### 2.5 `SavedExperiment`

Sidebar shows "Saved experiments" — named bundles of specs for reuse (e.g., "Cheap model sweep" runs the same context against haiku + gpt-5-mini).

```ts
interface SavedExperiment {
  id: string;                    // "exp_cheap_sweep"
  name: string;                  // "Cheap model sweep"
  createdAt: ISOTimestamp;
  specs: BranchExperimentSpec[]; // typically one template × N models
  notes?: string;
}
```

---

## 3. Wiki

Obsidian-style linked notes. The prototype stores pages in a map keyed by slug; wikilinks (`[[Page Title]]`) are resolved at render time against that same map.

### 3.1 `WikiPage`

```ts
interface WikiPage {
  slug: WikiSlug;                // the map key; stable identifier used by [[wikilinks]]
  title: string;                 // display title (may differ from slug, e.g., "INC-142 — SSO redirect loop")
  tags: string[];                // free-form labels: "runbook", "p1", "resolved", …
  updated: ISODate;              // YYYY-MM-DD is enough — the prototype doesn't track edit time
  body: string;                  // markdown with [[wikilinks]] (see §3.2)
  links: WikiSlug[];             // outgoing links — duplicated with body parse for fast graph queries
}

type WikiSlug = string;          // human-readable: "SSO Proxy", "Cookie Policy"
type ISODate = string;           // "2026-04-20"
```

Invariants:
- `slug` is unique across all pages.
- Every slug in `links` must reference an existing `WikiPage` (or be rendered as a dangling wikilink).
- `links` can be regenerated from `body` by parsing `/\[\[([^\]]+)\]\]/g` — keep as a denormalized index for cheap `backlinks` queries.

### 3.2 Markdown dialect

The prototype's `renderBody` supports a deliberately small subset:
- `# ` / `## ` headings
- `> ` blockquotes
- `1. ` ordered list items / `- ` unordered list items
- Blank lines → paragraph breaks
- Inline: `[[wikilink]]` (nothing else — no bold/italic/code spans in v1)

Any extension should be documented here before expanding the renderer.

### 3.3 Derived: backlinks & local graph

```ts
// derived
interface WikiDerived {
  backlinks: WikiSlug[];         // pages p where p.links.includes(this.slug)
  localGraph: {
    nodes: WikiSlug[];           // this page + 1-hop neighbors
    edges: [WikiSlug, WikiSlug][]; // directed, following `links`
  };
}
```

---

## 4. Code graph (AST / semantic model)

A visualization of the codebase as a graph of symbols (modules, functions, constants) connected by typed edges. Traces reference symbols, so the code graph and trace graph join on `FilePath` + symbol id.

### 4.1 `CodeSymbol`

```ts
interface CodeSymbol {
  id: SymbolId;                  // unique within a repo; could be a qualified name
  kind: SymbolKind;
  label: string;                 // display name
  parent?: SymbolId;             // the enclosing module (for fn/const); unset for top-level modules

  // Production additions (not in prototype)
  file?: FilePath;               // source location
  signature?: string;            // for functions/constants; UI shows as code block
  line?: number;                 // where it's defined

  // Telemetry
  hot?: boolean;                 // ui — "frequently used / on the hot path"
  warn?: boolean;                // ui — "recently touched by a failing trace / flagged"

  // Touched by (the trace × code join)
  touchedBy?: TraceTouch[];

  // Identity across renames (see §4.4)
  previousIds?: SymbolId[];      // chain of ids this symbol was previously known by, oldest → newest

  // Layout hints (ui only; a real renderer should run a force layout client-side)
  x?: number;                    // ui
  y?: number;                    // ui
}

interface TraceTouch {
  traceId: TraceId;
  nodeId: NodeId;
  role: "main-fix" | "proposed-refactor" | "read" | "edit" | string;
}

type SymbolId = string;          // e.g. "setSid", "middleware", "auth.ts"
type SymbolKind = "module" | "fn" | "const" | "class" | "type";  // open set
```

Invariants:
- If `kind === "module"`, `parent` is unset (or references a higher-level package/dir).
- If `kind !== "module"`, `parent` references a `module` (or a class, in future).

### 4.2 `CodeEdge`

```ts
interface CodeEdge {
  from: SymbolId;
  to: SymbolId;
  kind: EdgeKind;                // "calls" | "uses" | "reads" | …
  tag?: EdgeTag;                 // overlay for this run: "bug" | "proposed" | null
}

type EdgeKind = "calls" | "uses" | "reads" | "extends" | "imports" | "redirect-loop" | string;
type EdgeTag = "bug" | "proposed";
```

The prototype encodes edges as tuples `[from, to, kind, tag?]`; storage should use the object form above for extensibility. `tag: "bug"` renders red; `tag: "proposed"` renders dashed amber and ties back to an experiment branch via `touchedBy`.

Invariants:
- `from` and `to` both reference existing `CodeSymbol.id`.
- Edges are directed. Bidirectional relationships are two edges.

### 4.3 Symbol identity across renames

When a symbol is renamed (or moved between files), we allocate a **new `SymbolId`** and record a lineage link. The old id is retained so historical traces still resolve.

```ts
// Append-only log — one row per rename event
interface SymbolRename {
  from: SymbolId;                // old id (still resolvable via lookups)
  to: SymbolId;                  // new id
  at: ISOTimestamp;
  commit?: string;               // git sha where the rename landed
  reason?: "rename" | "move" | "split" | "merge" | string;
}
```

Resolution rules:
- Live lookups (tree view, code graph, joins from `Node.files`) always target the **current** id.
- Historical references (a `TraceTouch` written when the symbol still had its old id) resolve via the chain: follow `SymbolRename.from → to` transitively until you land on a symbol whose `id` is current.
- `CodeSymbol.previousIds` caches the chain for O(1) reads; rebuild when renames are appended.
- On `split` / `merge`, the 1-to-1 chain is broken — renderers should surface the lineage diagram rather than silently pick a successor.

Why this shape: a single id would force rewriting history on every rename (expensive, destroys audit trail); a pure rename log without `previousIds` makes every read a graph walk. The combo gives fast reads, accurate history, and a single source of truth for lineage.

### 4.4 Derived: callers / callees

```ts
// derived per symbol
interface CodeSymbolDerived {
  callers: SymbolId[];           // { e.from | e ∈ edges, e.to === this.id, e.kind === "calls" }
  callees: SymbolId[];           // { e.to   | e ∈ edges, e.from === this.id, e.kind === "calls" }
}
```

---

## 5. Cross-entity relationships

Diagram of the keys that span entity groups (for foreign keys in a relational implementation):

```
Trace  1 ─── * Node
Node   *  ─── 1 Node      (parent)
Node   *  ─── *  FilePath  → CodeSymbol.file
Node   *  ─── *  SymbolId  → CodeSymbol.touchedBy
WikiPage.body  ─── embeds refs like "trc_9f2a" → Trace.id (string match; no hard FK)
SavedExperiment.specs[*].sourceNodeId  → Node.id
```

Notes:
- Wiki ↔ Trace is intentionally loose: wiki pages reference trace ids as plain text. Upgrade to a typed link when we add auto-generated incident pages.
- CodeSymbol ↔ Node is the most valuable join (lets you answer "which traces touched `setSid`?"). Keep it denormalized on the symbol side for fast reads; rebuild from `Node.files` + symbol-in-file index on writes.

---

## 6. Enums & open sets

| Type | Values (closed) | Notes |
|------|-----------------|-------|
| `TraceStatus` | `running` \| `done` \| `failed` | Add `queued`, `canceled` when we have a runner. |
| `NodeKind` | `plan` \| `tool` \| `llm` \| `experiment` | Authorial intent, not mechanical. |
| `NodeStatus` | `ok` \| `error` \| `running` \| `skipped` | |
| `Role` | `system` \| `user` \| `tool_result` \| `assistant` | Provider-agnostic; map to `tool`/`function` at the provider boundary. |
| `BranchKind` | `alt-model` \| `experiment` | |
| `EdgeTag` | `bug` \| `proposed` \| null | |

**Open sets** (free strings, but conventions documented):
- `Provider`: `anthropic`, `openai`, `google`, `meta` in v1.
- `ToolName`: `search_fs`, `read_file`, `edit_file`, `run_tests` in v1 — add as tools are added.
- `SymbolKind`, `EdgeKind`: extensible; new values render as generic.

---

## 7. What's NOT in this model (and why)

- **User accounts / auth / org** — the prototype is single-user; add when multi-tenancy lands.
- **Real-time streaming deltas** — the prototype renders finished nodes. For live runs, add a `NodeEvent` append-only log (token deltas, tool-call progress); derive final `Node` state by folding events.
- **Annotations / human review** — no `comments` / `approvals` fields yet. Design separately when the review workflow lands.
- **Cost budgets / alerts** — sidebar shows 24h aggregates derived from `Trace.totalCost`; no budget entity yet.
- **Diffs** — the Diff tab in the detail panel renders on-the-fly from `input`/`output`. If we need persistent diffs (e.g., for code patches), add a `Patch` entity linked from `Node`.

---

## 8. Canonical example

Mapping the prototype's `n4` (the "aha" node) to the model:

```ts
const n4: Node = {
  id: "n4",
  traceId: "trc_9f2a",
  parent: "n3",
  kind: "llm",
  label: "analyze callback",
  summary: "Identify bug: callback sets cookie with wrong domain.",
  model: "claude-sonnet-4.5",
  provider: "anthropic",
  tools: ["read_file"],
  files: ["src/pages/auth/callback.ts"],
  inputTokens: 3_820,
  outputTokens: 641,
  cost: 0.021,
  latency: 3_180,
  ttft: 720,
  status: "ok",
  timestamp: "2026-04-20T14:22:17Z",
  highlighted: true,
  input: "<tool_result>…</tool_result>\n<user>Diagnose the loop.</user>",
  output: "Found the bug. In src/pages/auth/callback.ts line 47, …",
  toolCalls: [{ name: "read_file", args: { path: "src/pages/auth/callback.ts" }, result: "98 lines" }],
  decision: {
    goal: "Find why isValidSession() returns false immediately after SSO sets the cookie.",
    options: [
      { label: "Cookie set with wrong domain (subdomain mismatch)", chosen: true, reason: "…" },
      { label: "Cookie TTL too short",                              chosen: false, reason: "Set to 24h; unlikely." },
      { label: "Session store eventually consistent",              chosen: false, reason: "Using signed cookies, no remote store." },
      { label: "CSRF middleware strips cookie",                    chosen: false, reason: "CSRF runs after auth in the stack." },
    ],
    why: "Only the domain-mismatch hypothesis explains the loop *and* is consistent with the callback code on line 47.",
  },
};
```

And its branch `n4b` (human experiment from the panel):

```ts
const n4b: Node = {
  ...,
  id: "n4b",
  parent: "n3",                 // same parent as n4 — siblings in the tree
  kind: "experiment",
  isBranch: true,
  branchLabel: "new approach",
  branchKind: "experiment",
  model: "claude-opus-4",
  // …
};
```

The `BranchExperimentSpec` that produced `n4b` would reference `sourceNodeId: "n4"` (or `"n3"` — the user branched off the parent of n4 in the prototype; either is valid depending on whether the experiment is "rerun n4" or "new child of n3").

---

## 9. Decisions log

Resolved 2026-04-21 — recorded here so the rationale stays with the spec.

| # | Question | Decision | Lives in |
|---|----------|----------|----------|
| 1 | Branch ancestry: sibling or child? | **Sibling** — new node's `parent = sourceNode.parent`. "Branching from n4" means "try a different n4". | §1.5 |
| 2 | Where does `tool_result` translation live? | **Provider adapter at the HTTP boundary.** Canonical `ContextMessage` stays provider-agnostic; each provider has a thin adapter. | §2.4 |
| 3 | Symbol identity across renames? | **New id + lineage link.** Append-only `SymbolRename` log; `CodeSymbol.previousIds` caches the chain for fast reads. | §4.3 |
| 4 | Is `ContextMessage.enabled`/`collapsed` persisted? | **UI-only.** Split into `ContextMessage` (persisted: role/content/source) and `ContextMessageUI` (adds enabled/collapsed). Disabled messages are filtered before submit. | §2.2 |
