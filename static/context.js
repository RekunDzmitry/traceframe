/*
 * context.js — Context Usage Map for a single session.
 *
 * Aggregates the per-session timeline + the flat hook list + the last
 * assistant message's `usage` block into a token grid + per-category
 * breakdown + per-message block list. Modeled on Claude Code's
 * `/context` command (leaked source: toby-bridges/claude-code-leaked
 * src/utils/analyzeContext.ts) but adapted to:
 *
 *   - run in the browser, not in the agent runtime
 *   - take hook events (no full message array)
 *   - use a CDN-loaded tokenizer for token counts (Claude via
 *     @anthropic-ai/tokenizer, OpenAI/Codex via gpt-tokenizer's
 *     cl100k_base, heuristic fallback when the CDN is unreachable)
 *   - derive cache stats from `usage.cache_read_input_tokens` /
 *     `usage.cache_creation.ephemeral_5m_input_tokens` /
 *     `usage.cache_creation.ephemeral_1h_input_tokens` (Anthropic),
 *     `usage.cacheRead` / `usage.cacheWrite` (Pi-normalized), or
 *     `usage.prompt_tokens_details.cached_tokens` (MiniMax /
 *     OpenAI-Compatible chat-completions) when present, and fall back
 *     to a "re-read == cache hit" proxy when not
 *
 * The shape returned to the renderer:
 *
 *   {
 *     model: string,             // claude-opus-4-7, gpt-4, codex,
 *                               // MiniMax-M3, MiniMax-M2, ...
 *     provider: string,          // claude | codex | pi | minimax | unknown
 *     totalTokens: number,       // sum across all categories
 *     maxTokens: number,         // context window for the model
 *     percentage: number,        // totalTokens / maxTokens, [0..1+]
 *     categories: Category[],    // System prompt, Tools, Skills, Messages, ...
 *     gridRows: Square[][],      // 10x10 = 100 squares, 1% each
 *     apiUsage: { input_tokens, output_tokens,
 *                 cache_creation_input_tokens,
 *                 cache_read_input_tokens } | null,
 *     messages: MessageBlock[],  // one per message, with cache stats + size hint
 *   }
 *
 * `messages` is the click target: clicking a block in the UI looks up
 * its `id` here and opens a dialog with the full content. The block id
 * is `m:<event_id>` for messages and `b:<kind>:<slug>` for system blocks.
 *
 * Loaded as a classic <script> by static/index.html and exposes
 * `window.Traceframe.context` for the rest of the page.
 */
(function () {
  "use strict";

  // ---------- Provider / model inference -----------------------------------

  /** Best-effort. Returns one of:
   *  "claude" | "codex" | "pi" | "minimax" | "unknown". */
  function inferProvider(payload) {
    if (!payload || typeof payload !== "object") return "unknown";
    const tp = stringField(payload, "transcript_path", "transcriptPath");
    const cwd = stringField(payload, "cwd");
    const source = stringField(payload, "source").toLowerCase();
    const model = stringField(payload, "model").toLowerCase();
    const haystack = (tp + "\n" + cwd + "\n" + source + "\n" + model).toLowerCase();
    if (haystack.includes("/.claude/") || haystack.includes("\\.claude\\") || source === "claude") {
      return "claude";
    }
    if (haystack.includes("/.codex/") || haystack.includes("\\.codex\\") || source === "codex") {
      return "codex";
    }
    if (haystack.includes("/.pi/") || haystack.includes("\\.pi\\") || source === "pi") {
      return "pi";
    }
    // MiniMax: the provider reports itself as "minimax" (Pi's AgentMessage
    // sets `provider: "minimax"`), the model id starts with "minimax-",
    // or the session lives under a `~/.minimax/...` config dir.
    if (source === "minimax" || model.startsWith("minimax-") ||
        haystack.includes("/.minimax/") || haystack.includes("\\.minimax\\")) {
      return "minimax";
    }
    return "unknown";
  }

  function stringField(obj, ...keys) {
    for (const k of keys) {
      if (!obj || typeof obj !== "object") continue;
      const v = obj[k];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return "";
  }

  /** Pull the model id out of any hook event. Assistant events carry it
   *  directly; others may carry it in the payload. Returns "" if missing. */
  function inferModel(allHooks) {
    for (const h of allHooks || []) {
      if (!h || typeof h !== "object") continue;
      if (typeof h.model === "string" && h.model.length > 0) return h.model;
      if (h.payload && typeof h.payload === "object") {
        const m = h.payload.model;
        if (typeof m === "string" && m.length > 0) return m;
      }
    }
    return "";
  }

  // ---------- Context window by model --------------------------------------

  /** Conservative defaults. Expand as we get accurate numbers from the
   *  agent hooks. The UI's percentage bar uses this as the denominator
   *  even when the actual API limit differs — close enough for a glance. */
  // Model id → context window (tokens). Numbers come from the official
  // model cards / API docs — keep these in sync with the source.
  //
  // MiniMax (M-series) models: the API accepts both the legacy "MiniMax-..."
  // and the newer "minimax-..." identifiers. The leading-capital form is
  // what the API returns today (see platform.minimax.io); we list it first
  // so the O(1) lookup in getContextWindowForModel hits it before the
  // case-insensitive scan.
  const MODEL_CONTEXT_WINDOWS = {
    "claude-opus-4-7": 1_000_000,
    "claude-opus-4":   1_000_000,
    "claude-sonnet-4": 1_000_000,
    "claude-3-7-sonnet": 200_000,
    "claude-3-5-sonnet": 200_000,
    "claude-3-5-haiku": 200_000,
    "claude-3-opus":   200_000,
    "gpt-4":           128_000,
    "gpt-4-turbo":     128_000,
    "gpt-4o":          128_000,
    "gpt-4o-mini":     128_000,
    "o1":              200_000,
    "o1-mini":         128_000,
    "o3-mini":         200_000,
    "codex":           200_000,
    // MiniMax M-series: M1 / M3 ship with MSA and 1M context; M2 / M2.5 /
    // M2.7 cap at 200K; M2-her is a 65K dialogue-tuned sibling.
    "MiniMax-M1": 1_000_000,
    "MiniMax-M3": 1_000_000,
    "MiniMax-M2": 200_000,
    "MiniMax-M2.5": 200_000,
    "MiniMax-M2.7": 200_000,
    "MiniMax-M2-her": 65_536,
  };

  function getContextWindowForModel(model) {
    if (typeof model === "string" && MODEL_CONTEXT_WINDOWS[model]) {
      return MODEL_CONTEXT_WINDOWS[model];
    }
    // Case-insensitive fallback: providers occasionally return identifiers
    // with a different capitalisation than the model card ("minimax-m3" vs
    // "MiniMax-M3", "CLAUDE-OPUS-4-7", ...). The table keys are the
    // canonical form; the runtime is whatever the API hands us.
    if (typeof model === "string" && model.length > 0) {
      const lower = model.toLowerCase();
      for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
        if (key.toLowerCase() === lower) return MODEL_CONTEXT_WINDOWS[key];
      }
    }
    // Default to 200k — matches the Claude 3.x / 4.x Sonnet default and
    // the Codex default. OpenAI gpt-4 is the only one we'd miss here.
    return 200_000;
  }

  // ---------- Tokenizer (lazy) ----------------------------------------------

  /** Token-counting facade that wraps the CDN-loaded tokenizer module. */
  async function countTokens(text, model) {
    const t = (typeof window !== "undefined" && window.Traceframe && window.Traceframe.tokenizer) || null;
    if (t && typeof t.countTokens === "function") {
      try { return await t.countTokens(text, model); } catch (_) {}
    }
    return t && typeof t.estimate === "function"
      ? t.estimate(text)
      : Math.max(1, Math.ceil((text || "").length / 4));
  }

  // ---------- Filter hooks to one session -----------------------------------

  function filterSessionHooks(allHooks, sessionID) {
    if (!sessionID) return (allHooks || []).slice();
    return (allHooks || []).filter((h) => h && h.session_id === sessionID);
  }

  // ---------- API usage extraction (cache stats) ---------------------------

  /** Walk hooks for the most recent assistant record carrying `usage`.
   *  The pi extension forwards `usage` on Stop events; claude/codex may
   *  carry it on assistant events directly. */
  /**
   * Pick the most-recent usage block from the session's hooks. Hooks can
   * arrive in either order — the global /api/hooks list is DESC
   * (newest-first), while /api/sessions/{id}/hooks is ASC (oldest-first).
   * Don't rely on either; find the assistant record with the latest
   * `event_time` that carries a usage block. Returns the zero-valued usage
   * sentinel when nothing carries one.
   */
  function extractAPIUsage(hooks) {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      present: false,
    };
    let latest = null;
    let latestTime = -Infinity;
    for (const h of hooks || []) {
      if (!h || typeof h !== "object") continue;
      const u = h.usage || (h.payload && typeof h.payload === "object" && h.payload.usage);
      if (!u || typeof u !== "object") continue;
      const t = Date.parse(h.event_time || "");
      if (!isFinite(t)) continue;
      if (t > latestTime) {
        latestTime = t;
        latest = u;
      }
    }
    if (!latest) return usage;
    // Anthropic / OpenAI-Compatible. input_tokens / output_tokens are the
    // raw names in both — MiniMax reuses the OpenAI names verbatim.
    if (typeof latest.input_tokens === "number") usage.input_tokens = latest.input_tokens;
    if (typeof latest.output_tokens === "number") usage.output_tokens = latest.output_tokens;
    if (typeof latest.cache_creation_input_tokens === "number") usage.cache_creation_input_tokens = latest.cache_creation_input_tokens;
    if (typeof latest.cache_read_input_tokens === "number") usage.cache_read_input_tokens = latest.cache_read_input_tokens;
    // Pi-normalized usage (AgentMessage.usage). Pi flattens every provider
    // into { input, output, cacheRead, cacheWrite, totalTokens } and the
    // hook forwards it verbatim for the last assistant message. Only
    // fill in fields the raw names didn't already populate — we never
    // want a missing sibling to zero out a real value.
    if (typeof latest.input === "number" && usage.input_tokens === 0) {
      usage.input_tokens = latest.input;
    }
    if (typeof latest.output === "number" && usage.output_tokens === 0) {
      usage.output_tokens = latest.output;
    }
    if (typeof latest.cacheRead === "number" && latest.cacheRead > 0 &&
        usage.cache_read_input_tokens === 0) {
      usage.cache_read_input_tokens = latest.cacheRead;
    }
    if (typeof latest.cacheWrite === "number" && latest.cacheWrite > 0 &&
        usage.cache_creation_input_tokens === 0) {
      usage.cache_creation_input_tokens = latest.cacheWrite;
    }
    // MiniMax / OpenAI-Compatible chat-completions shape.
    //   prompt_tokens / completion_tokens → input / output
    //   prompt_tokens_details.cached_tokens → cache read
    if (typeof latest.prompt_tokens === "number" && usage.input_tokens === 0) {
      usage.input_tokens = latest.prompt_tokens;
    }
    if (typeof latest.completion_tokens === "number" && usage.output_tokens === 0) {
      usage.output_tokens = latest.completion_tokens;
    }
    const ptd = latest.prompt_tokens_details;
    if (ptd && typeof ptd === "object" && typeof ptd.cached_tokens === "number" &&
        ptd.cached_tokens > 0 && usage.cache_read_input_tokens === 0) {
      usage.cache_read_input_tokens = ptd.cached_tokens;
    }
    if (latest.cache_creation && typeof latest.cache_creation === "object") {
      usage.cache_creation = {
        ephemeral_5m_input_tokens: typeof latest.cache_creation.ephemeral_5m_input_tokens === "number" ? latest.cache_creation.ephemeral_5m_input_tokens : 0,
        ephemeral_1h_input_tokens: typeof latest.cache_creation.ephemeral_1h_input_tokens === "number" ? latest.cache_creation.ephemeral_1h_input_tokens : 0,
      };
    }
    usage.present = true;
    return usage;
  }

  // ---------- Category builders --------------------------------------------
  //
  // Each builder returns a Category { name, kind, tokens, items, ... }.
  // Items are clickable units that show up in the per-category list and
  // (for messages) in the message-block grid.

  const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

  function filePathOf(ev) {
    if (!ev) return "";
    const input = ev.input || {};
    if (typeof input.file_path === "string") return input.file_path;
    if (typeof input.notebook_path === "string") return input.notebook_path;
    if (typeof input.path === "string") return input.path;
    if (Array.isArray(input.path) && input.path.length) return String(input.path[0]);
    return "";
  }

  function firstLine(s, max) {
    if (!s) return "";
    const i = String(s).indexOf("\n");
    const head = i >= 0 ? s.slice(0, i) : s;
    if (max && head.length > max) return head.slice(0, max) + "…";
    return head;
  }

  function findFirstPayload(hooks) {
    if (!hooks || !hooks.length) return null;
    for (const h of hooks) {
      if (h && (h.transcript_path || h.cwd || h.hook_event_name === "SessionStart")) return h;
    }
    return hooks[0];
  }

  /** System prompt: from SessionStart payload.system_prompt. */
  function buildSystemPromptCategory(hooks) {
    let prompt = "";
    for (const h of hooks || []) {
      if (!h || h.kind !== "session_start") continue;
      const p = h.system_prompt || (h.payload && h.payload.system_prompt);
      if (typeof p === "string" && p.length > 0) { prompt = p; break; }
    }
    if (!prompt) {
      return { name: "System prompt", kind: "system_prompt", tokens: 0, items: [], note: "not captured by this provider's hook" };
    }
    return {
      name: "System prompt",
      kind: "system_prompt",
      tokens: 0, // filled in by main aggregator (async)
      items: [{ id: "sys-prompt", text: prompt, touched_at: null }],
    };
  }

  /** System tools: from SessionStart payload.system_tools (pi) or derived
   *  from observed tool calls (any provider). We use the observed list when
   *  the declared list is missing — every tool that was called IS a tool
   *  the model knows about. */
  function buildSystemToolsCategory(hooks) {
    const declared = [];
    for (const h of hooks || []) {
      if (!h || h.kind !== "session_start") continue;
      const arr = h.system_tools || (h.payload && h.payload.system_tools);
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (t && typeof t === "object" && typeof t.name === "string") {
            declared.push({ name: t.name, description: typeof t.description === "string" ? t.description : "" });
          }
        }
      }
    }
    const used = new Set();
    const usedNames = new Map();
    for (const h of hooks || []) {
      if (!h || h.kind !== "tool") continue;
      if (typeof h.tool_name === "string" && h.tool_name) {
        used.add(h.tool_name);
        usedNames.set(h.tool_name, (usedNames.get(h.tool_name) || 0) + 1);
      }
    }
    const items = [];
    const seen = new Set();
    for (const d of declared) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        items.push({ id: "tool:" + d.name, text: d.name, subtitle: d.description ? firstLine(d.description, 80) : "", count: usedNames.get(d.name) || 0 });
      }
    }
    for (const name of used) {
      if (!seen.has(name)) {
        seen.add(name);
        items.push({ id: "tool:" + name, text: name, subtitle: "", count: usedNames.get(name) || 0 });
      }
    }
    return {
      name: "System tools",
      kind: "system_tools",
      tokens: 0,
      items,
      note: declared.length === 0 ? "inferred from observed tool calls" : null,
    };
  }

  /** Skills: skills called via the SkillTool. We surface them as items
   *  with their frontmatter. */
  function buildSkillsCategory(hooks) {
    const items = [];
    for (const h of hooks || []) {
      if (!h || h.kind !== "tool") continue;
      if (h.tool_name !== "Skill" && h.tool_name !== "SlashCommand" && h.tool_name !== "SkillTool") continue;
      const input = h.input || {};
      const name = typeof input.name === "string" ? input.name
        : typeof input.skill === "string" ? input.skill
        : typeof input.command === "string" ? input.command
        : "skill";
      items.push({ id: "skill:" + (h.event_id || name), text: name, subtitle: h.summary || "" });
    }
    if (items.length === 0) return null;
    return { name: "Skills", kind: "skills", tokens: 0, items };
  }

  /** Messages: the bulk. Each message becomes a clickable block in the
   *  message-grid. We pair Pre/Post tool events by tool_use_id, then
   *  bucket the result by its associated assistant response (if any) so
   *  cache stats can be attributed. */
  function buildMessages(hooks, apiUsage) {
    // Pair Pre/Post by tool_use_id, similar to the Go-side buildToolSummary.
    const preById = new Map();
    const postById = new Map();
    for (const h of hooks || []) {
      if (!h || h.kind !== "tool") continue;
      const id = h.tool_use_id || "";
      if (!id) continue;
      if (h.event_name === "PreToolUse") preById.set(id, h);
      else if (h.event_name === "PostToolUse") postById.set(id, h);
    }
    const consumed = new Set();
    const merged = [];
    for (const h of hooks || []) {
      if (!h || h.kind !== "tool") continue;
      const id = h.tool_use_id || "";
      if (id && consumed.has(id)) continue;
      if (id) consumed.add(id);
      merged.push({ pre: preById.get(id) || null, post: postById.get(id) || null });
    }

    // Bucket: each merged tool pair belongs to the LAST preceding user/assistant
    // message; orphan tools go in their own bucket. For cache attribution we
    // treat every event between two Stop markers as one bucket.
    const buckets = [];
    let current = { id: "bucket-pre", label: "preamble", start: null, events: [] };
    for (const m of merged) {
      const ev = m.post || m.pre;
      if (!ev) continue;
      if (!current.start) current.start = ev.event_time;
      current.events.push(m);
    }
    if (current.events.length) buckets.push(current);

    // Walk all hooks in chronological order and build message blocks.
    const blocks = [];
    for (const h of hooks || []) {
      if (!h) continue;
      if (h.kind === "user_prompt") {
        const txt = (h.content || h.summary || "").toString();
        blocks.push({
          id: "m:" + (h.event_id || "u" + blocks.length),
          kind: "user",
          text: txt,
          tool_name: "",
          tokens: 0, // filled async
          touched_at: h.event_time || null,
          event_id: h.event_id || null,
          cache: { hit_count: 0, expires_at: null, ttl_kind: null },
        });
      } else if (h.kind === "assistant_stop") {
        const txt = (h.content || h.summary || "").toString();
        blocks.push({
          id: "m:" + (h.event_id || "a" + blocks.length),
          kind: "assistant",
          text: txt,
          tool_name: "",
          tokens: 0,
          touched_at: h.event_time || null,
          event_id: h.event_id || null,
          cache: { hit_count: 0, expires_at: null, ttl_kind: null },
        });
      } else if (h.kind === "tool" && (h.event_name === "PreToolUse" || h.event_name === "PostToolUse")) {
        // Skip individual tool events — they're represented via the
        // merged map of (pre, post) pairs below.
      }
    }

    // Add a merged-tool block for each tool_use_id, so the user sees the
    // call + result as a single unit.
    for (const m of merged) {
      const pre = m.pre;
      const post = m.post;
      const ev = post || pre;
      if (!ev) continue;
      const id = ev.tool_use_id || "tu" + blocks.length;
      const input = (pre && pre.input) || {};
      const result = (post && post.output) || (pre && pre.output) || null;
      let subtitle = "";
      if (input && typeof input === "object") {
        if (typeof input.file_path === "string") subtitle = input.file_path;
        else if (typeof input.command === "string") subtitle = firstLine(input.command, 80);
        else if (typeof input.url === "string") subtitle = input.url;
        else if (typeof input.pattern === "string") subtitle = input.pattern;
      }
      blocks.push({
        id: "m:" + id,
        kind: "tool_call",
        text: ev.tool_name || "tool",
        subtitle,
        tool_name: ev.tool_name || "",
        input,
        output: result,
        tokens: 0,
        touched_at: ev.event_time || null,
        event_id: ev.event_id || null,
        cache: { hit_count: 0, expires_at: null, ttl_kind: null },
      });
    }

    // Apply cache stats: if apiUsage.cache_creation_input_tokens > 0, the
    // FIRST block is a new cache entry; cache_read_input_tokens > 0 means
    // subsequent blocks in the window hit the cache. Without per-block
    // attribution, we approximate: split the cache_read evenly across the
    // last N blocks where N is the count of blocks in the last 5 minutes.
    if (apiUsage && apiUsage.present) {
      const last5minBlocks = blocks.filter((b) => {
        if (!b.touched_at) return false;
        const t = Date.parse(b.touched_at);
        if (isNaN(t)) return false;
        return Date.now() - t < 5 * 60_000;
      });
      const hitCount = apiUsage.cache_read_input_tokens || 0;
      const creates = (apiUsage.cache_creation && apiUsage.cache_creation.ephemeral_5m_input_tokens) || 0;
      const ttlKind = creates > 0 ? "5m" : null;
      // Distribute the cache_read_total across the last-5min blocks as
      // a synthetic hit_count. We don't know which block specifically
      // hit the cache; a uniform split is honest about that uncertainty.
      const perBlock = last5minBlocks.length > 0 ? Math.round(hitCount / last5minBlocks.length) : 0;
      for (const b of last5minBlocks) {
        b.cache.hit_count = perBlock;
        b.cache.ttl_kind = ttlKind;
        if (b.touched_at) {
          b.cache.expires_at = new Date(Date.parse(b.touched_at) + 5 * 60_000).toISOString();
        }
      }
    }

    // File re-read proxy: every additional Read on the same file counts
    // as a cache hit when we don't have real cache_read data.
    if (!(apiUsage && apiUsage.present && apiUsage.cache_read_input_tokens > 0)) {
      const readByFile = new Map();
      for (const b of blocks) {
        if (b.kind !== "tool_call" || b.tool_name !== "Read") continue;
        const p = b.subtitle || "";
        if (!p) continue;
        const cur = readByFile.get(p) || 0;
        readByFile.set(p, cur + 1);
        b.cache.hit_count = cur; // 0 for first read, 1 for second, etc.
      }
    }

    return blocks;
  }

  // ---------- Main aggregator -----------------------------------------------

  /** Build the full Context Usage Map. Async because token counts need
   *  the CDN tokenizer to settle. */
  async function buildContextUsageMap(timeline, allHooks, opts) {
    opts = opts || {};
    const now = (typeof opts.now === "number") ? opts.now : Date.now();
    const sessionID = (timeline && timeline.session && timeline.session.id) || "";
    const hooks = filterSessionHooks(allHooks, sessionID);
    const model = (opts.model) || inferModel(hooks);
    const provider = inferProvider(findFirstPayload(hooks));
    const maxTokens = getContextWindowForModel(model);

    const sysCat  = buildSystemPromptCategory(hooks);
    const toolsCat = buildSystemToolsCategory(hooks);
    const skillsCat = buildSkillsCategory(hooks);
    const apiUsage = extractAPIUsage(hooks);
    const messages = buildMessages(hooks, apiUsage);
    const messagesCategory = {
      name: "Messages",
      kind: "messages",
      tokens: 0,
      items: messages,
      message_blocks: messages,
    };

    // Token-count every category in parallel. We await all so the totals
    // are ready before the renderer sees them. Skills can be null when
    // no SkillTool events were observed; skip it cleanly.
    const allText = [];
    for (const c of [sysCat, toolsCat, skillsCat, messagesCategory]) {
      if (!c) continue;
      for (const it of c.items || []) {
        allText.push((it && it.text) || "");
      }
    }
    const allCounts = await Promise.all(allText.map((t) => countTokens(t, model)));

    // Distribute the per-item counts back.
    let idx = 0;
    const tokenize = (cat) => {
      let sum = 0;
      for (const it of cat.items || []) {
        const n = allCounts[idx++] || 0;
        it.tokens = n;
        sum += n;
      }
      cat.tokens = sum;
    };
    tokenize(sysCat);
    tokenize(toolsCat);
    if (skillsCat) tokenize(skillsCat);
    tokenize(messagesCategory);

    const categories = [
      sysCat, toolsCat, skillsCat, messagesCategory,
    ].filter((c) => c && (c.tokens > 0 || (c.items && c.items.length > 0)));

    const totalTokens = categories.reduce((s, c) => s + c.tokens, 0);
    const percentage = maxTokens > 0 ? (totalTokens / maxTokens) : 0;

    // Build the grid: TOTAL_SQUARES cells, token-proportional. We pack
    // category → count of cells, then fill each cell with the category's
    // color. For "Messages" cells, we layer in cache-info so the renderer
    // can vary per-cell.
    const TOTAL_SQUARES = 100;
    const gridSquares = [];
    for (const cat of categories) {
      if (cat.tokens <= 0) continue;
      const exact = (cat.tokens / Math.max(maxTokens, 1)) * TOTAL_SQUARES;
      const whole = Math.floor(exact);
      const frac = exact - whole;
      for (let i = 0; i < whole; i++) {
        gridSquares.push(makeSquare(cat, i, whole, 1.0, model));
      }
      if (frac > 0) {
        gridSquares.push(makeSquare(cat, whole, whole, frac, model));
      }
    }
    // Free space: pad the grid up to TOTAL_SQUARES with outlined free cells.
    while (gridSquares.length < TOTAL_SQUARES) {
      gridSquares.push({
        color: "free",
        isFilled: false,
        categoryName: "Free space",
        tokens: 0,
        percentage: 0,
        squareFullness: 0,
        kind: "free",
      });
    }
    // Autocompact buffer at the end (decorative; the actual model window
    // already accounts for this — we mark it as a visual hint).
    if (gridSquares.length > TOTAL_SQUARES) {
      gridSquares.length = TOTAL_SQUARES;
    }
    // Split into rows of 10.
    const GRID_WIDTH = 10;
    const gridRows = [];
    for (let i = 0; i < gridSquares.length; i += GRID_WIDTH) {
      gridRows.push(gridSquares.slice(i, i + GRID_WIDTH));
    }

    return {
      model,
      provider,
      totalTokens,
      maxTokens,
      percentage,
      categories,
      gridRows,
      apiUsage: apiUsage.present ? {
        input_tokens: apiUsage.input_tokens,
        output_tokens: apiUsage.output_tokens,
        cache_creation_input_tokens: apiUsage.cache_creation_input_tokens,
        cache_read_input_tokens: apiUsage.cache_read_input_tokens,
        cache_creation: apiUsage.cache_creation,
      } : null,
      messages,
    };
  }

  function makeSquare(cat, indexInCat, totalInCat, fullness, model) {
    return {
      color: cat.kind,
      isFilled: fullness > 0,
      categoryName: cat.name,
      tokens: Math.round(cat.tokens * (fullness / totalInCat || 0)),
      percentage: 0, // filled in renderer if needed
      squareFullness: fullness,
      kind: cat.kind,
    };
  }

  // ---------- Renderer -------------------------------------------------------

  // Cache TTL palette: red (expired) → amber (halfway) → green (fresh).
  // The first expiry is 5 minutes after the block's last touch; subsequent
  // hits refresh the window (which is what cache_read does). For blocks
  // without a real expires_at (e.g. pre-usage events) we don't color.
  function cacheTone(cache, now) {
    if (!cache || !cache.expires_at) return null;
    const exp = Date.parse(cache.expires_at);
    if (isNaN(exp)) return null;
    const remaining = exp - now;
    if (remaining <= 0) return "expired";
    if (remaining < 60_000) return "soon";          // < 1 min remaining
    if (remaining < 5 * 60_000) return "fresh";     // < 5 min remaining
    return "fresh-long";
  }

  // Block size: a base radius + hit_count * step. Capped at 1.4× so blocks
  // don't dominate the grid. Blocks with no hits keep the base size.
  function blockSizePx(hitCount) {
    const base = 8;
    const step = Math.min(8, hitCount || 0);
    return base + step;
  }

  // Click handler registry: each message block has a `data-block-id` and
  // the container catches clicks and dispatches to the registered handler.
  let clickHandler = null;

  function renderContextUsageMap(data, container, callbacks) {
    callbacks = callbacks || {};
    container.textContent = "";
    if (!data || !data.categories || data.categories.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ctx-empty";
      empty.textContent = "No context captured for this session yet.";
      container.appendChild(empty);
      return;
    }

    // --- Header ------------------------------------------------------------
    const header = document.createElement("div");
    header.className = "ctx-header";
    const title = document.createElement("h2");
    title.className = "ctx-header__title";
    title.textContent = "Context Usage";
    const sub = document.createElement("div");
    sub.className = "ctx-header__sub";
    const pct = (data.percentage * 100).toFixed(1);
    sub.innerHTML = "";
    const modelSpan = document.createElement("span");
    modelSpan.className = "ctx-header__model";
    modelSpan.textContent = data.model || "unknown model";
    const sep1 = document.createElement("span");
    sep1.textContent = " · ";
    const tokensSpan = document.createElement("span");
    tokensSpan.className = "ctx-header__tokens";
    tokensSpan.textContent = formatTokens(data.totalTokens) + " / " + formatTokens(data.maxTokens) + " tokens (" + pct + "%)";
    sub.append(modelSpan, sep1, tokensSpan);
    if (data.apiUsage && data.apiUsage.cache_read_input_tokens > 0) {
      const cacheSpan = document.createElement("span");
      cacheSpan.className = "ctx-header__cache";
      const cached = data.apiUsage.cache_read_input_tokens;
      const created = data.apiUsage.cache_creation_input_tokens || 0;
      cacheSpan.textContent = " · " + formatTokens(cached) + " cache hits (" + formatTokens(created) + " created)";
      sub.appendChild(cacheSpan);
    }
    header.append(title, sub);
    container.appendChild(header);

    // --- Grid (one continuous strip of squares) ---------------------------
    const grid = document.createElement("div");
    grid.className = "ctx-grid";
    grid.dataset.kind = "grid";
    let squareIdx = 0;
    for (let r = 0; r < data.gridRows.length; r++) {
      const row = document.createElement("div");
      row.className = "ctx-grid__row";
      for (let c = 0; c < data.gridRows[r].length; c++) {
        const sq = data.gridRows[r][c];
        const cell = document.createElement("div");
        cell.className = "ctx-grid__cell ctx-grid__cell--" + (sq.color || "free");
        if (sq.isFilled) {
          cell.style.opacity = (0.4 + 0.6 * sq.squareFullness).toFixed(2);
        } else {
          cell.classList.add("ctx-grid__cell--free");
        }
        cell.title = sq.categoryName + " · " + formatTokens(sq.tokens);
        row.appendChild(cell);
        squareIdx++;
      }
      grid.appendChild(row);
    }
    container.appendChild(grid);

    // --- Message grid (per-message blocks, colored by cache TTL, sized by
    //     hit count) -------------------------------------------------------
    if (data.messages && data.messages.length > 0) {
      const msgWrap = document.createElement("div");
      msgWrap.className = "ctx-msgs";
      const msgHeader = document.createElement("div");
      msgHeader.className = "ctx-msgs__header";
      const mh = document.createElement("span");
      mh.className = "ctx-msgs__title";
      mh.textContent = "Message blocks";
      const mhSub = document.createElement("span");
      mhSub.className = "ctx-msgs__sub";
      mhSub.textContent = "color = cache expiration · size = cache hits · click for content";
      msgHeader.append(mh, mhSub);
      msgWrap.appendChild(msgHeader);

      const msgGrid = document.createElement("div");
      msgGrid.className = "ctx-msg-grid";
      for (const b of data.messages) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ctx-msg ctx-msg--" + b.kind;
        const tone = cacheTone(b.cache, Date.now());
        if (tone) cell.classList.add("ctx-msg--ttl-" + tone);
        cell.dataset.blockId = b.id;
        const hits = (b.cache && b.cache.hit_count) || 0;
        const sz = blockSizePx(hits);
        cell.style.width = sz + "px";
        cell.style.height = sz + "px";
        // Tooltip with the message details + cache info.
        const tipParts = [];
        tipParts.push(b.kind + (b.tool_name ? " · " + b.tool_name : ""));
        if (b.text) tipParts.push(firstLine(b.text, 80));
        if (b.tokens) tipParts.push(formatTokens(b.tokens) + " tokens");
        if (hits > 0) tipParts.push(hits + " cache hit" + (hits === 1 ? "" : "s"));
        if (b.cache && b.cache.ttl_kind) tipParts.push("ttl " + b.cache.ttl_kind);
        if (b.cache && b.cache.expires_at) {
          const rem = Math.max(0, Date.parse(b.cache.expires_at) - Date.now());
          tipParts.push("expires in " + formatAge(rem));
        }
        cell.title = tipParts.join("\n");
        msgGrid.appendChild(cell);
      }
      msgWrap.appendChild(msgGrid);
      container.appendChild(msgWrap);

      // Wire up click → dialog. The dialog itself lives in index.html.
      msgGrid.addEventListener("click", (e) => {
        const t = e.target.closest("[data-block-id]");
        if (!t) return;
        const id = t.dataset.blockId;
        const block = data.messages.find((b) => b.id === id);
        if (block && callbacks.onItemClick) callbacks.onItemClick(block);
      });
    }

    // --- Per-category list ------------------------------------------------
    const list = document.createElement("div");
    list.className = "ctx-cats";
    for (const c of data.categories) {
      const row = document.createElement("div");
      row.className = "ctx-cat ctx-cat--" + c.kind;
      const left = document.createElement("div");
      left.className = "ctx-cat__left";
      const name = document.createElement("span");
      name.className = "ctx-cat__name";
      name.textContent = c.name;
      const tokens = document.createElement("span");
      tokens.className = "ctx-cat__tokens";
      tokens.textContent = formatTokens(c.tokens);
      const pctSpan = document.createElement("span");
      pctSpan.className = "ctx-cat__pct";
      pctSpan.textContent = ((c.tokens / Math.max(data.maxTokens, 1)) * 100).toFixed(1) + "%";
      left.append(name, tokens, pctSpan);

      const bar = document.createElement("div");
      bar.className = "ctx-cat__bar";
      const fill = document.createElement("div");
      fill.className = "ctx-cat__bar-fill ctx-cat__bar-fill--" + c.kind;
      fill.style.width = Math.min(100, (c.tokens / Math.max(data.maxTokens, 1)) * 100) + "%";
      bar.appendChild(fill);

      const wrap = document.createElement("div");
      wrap.className = "ctx-cat__row";
      wrap.append(left, bar);
      row.appendChild(wrap);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  // ---------- Helpers -------------------------------------------------------

  function formatTokens(n) {
    if (typeof n !== "number" || isNaN(n)) return "—";
    if (n < 0) return "—";
    if (n === 0) return "0";
    if (n < 1000) return n + "";
    if (n < 1_000_000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + "K";
    return (n / 1_000_000).toFixed(1) + "M";
  }

  function formatAge(ms) {
    if (ms == null || ms < 0) return "—";
    if (ms < 1000) return "<1s";
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m " + (s % 60) + "s";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h " + (m % 60) + "m";
    const d = Math.floor(h / 24);
    return d + "d " + (h % 24) + "h";
  }

  // ---------- Tests --------------------------------------------------------

  /** In-page smoke tests. Read by the headless browser via
   *  window.__traceframeTests (results are stashed on window; nothing
   *  injected into the visible DOM). */
  function runTests() {
    const results = [];
    const t = (name, cond, detail) => {
      results.push((cond ? "PASS" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
    };

    // Provider inference
    t("inferProvider: claude via transcript_path",
      inferProvider({ transcript_path: "/Users/me/.claude/sessions/x.jsonl" }) === "claude");
    t("inferProvider: codex via cwd",
      inferProvider({ cwd: "/Users/me/.codex/work" }) === "codex");
    t("inferProvider: pi via source",
      inferProvider({ source: "pi" }) === "pi");
    t("inferProvider: minimax via source",
      inferProvider({ source: "minimax" }) === "minimax");
    t("inferProvider: minimax via model id",
      inferProvider({ model: "MiniMax-M3" }) === "minimax");
    t("inferProvider: minimax via lowercase model id",
      inferProvider({ model: "minimax-m2" }) === "minimax");
    t("inferProvider: minimax via config path",
      inferProvider({ transcript_path: "/Users/me/.minimax/sessions/x.jsonl" }) === "minimax");
    t("inferProvider: unknown on empty",
      inferProvider({}) === "unknown");

    // Model inference
    t("inferModel: from assistant event",
      inferModel([{ kind: "assistant_stop", model: "claude-opus-4-7" }]) === "claude-opus-4-7");
    t("inferModel: from payload.model",
      inferModel([{ kind: "tool", payload: { model: "gpt-4" } }]) === "gpt-4");
    t("inferModel: MiniMax-M3 from payload.model",
      inferModel([{ kind: "tool", payload: { model: "MiniMax-M3" } }]) === "MiniMax-M3");
    t("inferModel: empty fallback",
      inferModel([]) === "");

    // Context window lookup
    t("context window: claude-opus-4-7 → 1M",
      getContextWindowForModel("claude-opus-4-7") === 1_000_000);
    t("context window: MiniMax-M3 → 1M",
      getContextWindowForModel("MiniMax-M3") === 1_000_000);
    t("context window: MiniMax-M1 → 1M",
      getContextWindowForModel("MiniMax-M1") === 1_000_000);
    t("context window: MiniMax-M2 → 200K",
      getContextWindowForModel("MiniMax-M2") === 200_000);
    t("context window: MiniMax-M2.5 → 200K",
      getContextWindowForModel("MiniMax-M2.5") === 200_000);
    t("context window: MiniMax-M2.7 → 200K",
      getContextWindowForModel("MiniMax-M2.7") === 200_000);
    t("context window: MiniMax-M2-her → 65K",
      getContextWindowForModel("MiniMax-M2-her") === 65_536);
    t("context window: lowercase MiniMax-M3 → 1M",
      getContextWindowForModel("minimax-m3") === 1_000_000);
    t("context window: UPPERCASE MINI MAX M2 → 200K",
      getContextWindowForModel("MINIMAX-M2") === 200_000);
    t("context window: unknown → 200k default",
      getContextWindowForModel("not-a-model") === 200_000);

    // API usage extraction
    const u = extractAPIUsage([
      { kind: "assistant_stop", usage: { input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 5 } },
    ]);
    t("apiUsage: extracts cache_creation", u.cache_creation_input_tokens === 100);
    t("apiUsage: extracts cache_read", u.cache_read_input_tokens === 200);
    t("apiUsage: marks present", u.present === true);
    t("apiUsage: empty when missing", extractAPIUsage([]).present === false);

    // Pi-normalized usage (AgentMessage.usage from the Pi extension).
    // event_time is required so extractAPIUsage actually picks the row;
    // real Go summaries always carry one.
    const piU = extractAPIUsage([
      { kind: "assistant_stop", event_time: "2026-07-06T10:00:00Z",
        usage: { input: 1200, output: 350, cacheRead: 800, cacheWrite: 400, totalTokens: 2350 } },
    ]);
    t("apiUsage(Pi): extracts input from .input", piU.input_tokens === 1200);
    t("apiUsage(Pi): extracts output from .output", piU.output_tokens === 350);
    t("apiUsage(Pi): cacheRead → cache_read", piU.cache_read_input_tokens === 800);
    t("apiUsage(Pi): cacheWrite → cache_creation", piU.cache_creation_input_tokens === 400);

    // MiniMax / OpenAI-Compatible chat-completions shape.
    const mmU = extractAPIUsage([
      { kind: "assistant_stop", event_time: "2026-07-06T10:00:00Z", usage: {
        prompt_tokens: 1366,
        completion_tokens: 293,
        total_tokens: 1659,
        prompt_tokens_details: { cached_tokens: 114 },
      } },
    ]);
    t("apiUsage(MiniMax): prompt_tokens → input", mmU.input_tokens === 1366);
    t("apiUsage(MiniMax): completion_tokens → output", mmU.output_tokens === 293);
    t("apiUsage(MiniMax): prompt_tokens_details.cached_tokens → cache_read",
      mmU.cache_read_input_tokens === 114);

    // Anthropic raw fields take priority over Pi / MiniMax when both are
    // present (e.g. a hook that forwards the AgentMessage verbatim AND
    // the raw OpenAI usage). Otherwise a real Anthropic value could be
    // silently overwritten by a missing Pi sibling.
    const mixed = extractAPIUsage([
      { kind: "assistant_stop", event_time: "2026-07-06T10:00:00Z", usage: {
        input_tokens: 5000,
        output_tokens: 200,
        cache_read_input_tokens: 4000,
        input: 1,  // Pi leftover; should NOT clobber input_tokens
        cacheRead: 999,  // Pi leftover; should NOT clobber cache_read_input_tokens
      } },
    ]);
    t("apiUsage: Anthropic input_tokens not clobbered by Pi .input",
      mixed.input_tokens === 5000);
    t("apiUsage: Anthropic cache_read_input_tokens not clobbered by Pi cacheRead",
      mixed.cache_read_input_tokens === 4000);

    // Cache TTL tone
    const nowT = Date.parse("2026-07-06T12:00:00Z");
    t("cacheTone: no expires_at → null", cacheTone({}, nowT) === null);
    t("cacheTone: expired → 'expired'",
      cacheTone({ expires_at: new Date(nowT - 1000).toISOString() }, nowT) === "expired");
    t("cacheTone: 30s remaining → 'soon'",
      cacheTone({ expires_at: new Date(nowT + 30_000).toISOString() }, nowT) === "soon");
    t("cacheTone: 4 min remaining → 'fresh'",
      cacheTone({ expires_at: new Date(nowT + 4 * 60_000).toISOString() }, nowT) === "fresh");

    // buildMessages: file re-read proxy
    const mhooks = [
      { kind: "user_prompt", event_id: "p1", event_time: "2026-07-06T10:00:00Z", content: "go" },
      { kind: "tool", event_id: "r1", event_time: "2026-07-06T10:01:00Z", event_name: "PreToolUse", tool_name: "Read", tool_use_id: "t1", input: { file_path: "/a.go" } },
      { kind: "tool", event_id: "r2", event_time: "2026-07-06T10:02:00Z", event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t1", input: { file_path: "/a.go" } },
      { kind: "tool", event_id: "r3", event_time: "2026-07-06T10:03:00Z", event_name: "PreToolUse", tool_name: "Read", tool_use_id: "t2", input: { file_path: "/a.go" } },
      { kind: "tool", event_id: "r4", event_time: "2026-07-06T10:04:00Z", event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t2", input: { file_path: "/a.go" } },
    ];
    const msgs = buildMessages(mhooks, { present: false });
    t("messages: includes user", msgs.some((b) => b.kind === "user"));
    t("messages: tool calls are merged by tool_use_id",
      msgs.filter((b) => b.kind === "tool_call").length === 2);
    const reads = msgs.filter((b) => b.kind === "tool_call" && b.tool_name === "Read");
    t("messages: re-read proxy: first read = 0 hits", reads[0] && reads[0].cache.hit_count === 0);
    t("messages: re-read proxy: second read = 1 hit", reads[1] && reads[1].cache.hit_count === 1);

    // formatTokens
    t("formatTokens: 0 → '0'", formatTokens(0) === "0");
    t("formatTokens: 500 → '500'", formatTokens(500) === "500");
    t("formatTokens: 1500 → '1.5K'", formatTokens(1500) === "1.5K");
    t("formatTokens: 1.2M → '1.2M'", formatTokens(1_200_000) === "1.2M");

    return results;
  }

  // ---------- Export -------------------------------------------------------

  window.Traceframe = window.Traceframe || {};
  window.Traceframe.context = {
    // New surface (replaces the old buildContextBlocks / renderContextView).
    buildContextUsageMap,
    renderContextUsageMap,
    runTests,
    // Public helpers, useful for the modal + smoke tests.
    inferProvider,
    inferModel,
    getContextWindowForModel,
    extractAPIUsage,
    cacheTone,
    formatTokens,
    formatAge,
  };
})();
