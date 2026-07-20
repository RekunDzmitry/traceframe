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
 *     `usage.cache_creation.ephemeral_1h_input_tokens` when present,
 *     and fall back to a "re-read == cache hit" proxy when not
 *
 * The shape returned to the renderer:
 *
 *   {
 *     model: string,             // claude-opus-4-7, gpt-4, codex, ...
 *     provider: string,          // claude | codex | pi | unknown
 *     totalTokens: number,       // sum across all categories
 *     maxTokens: number,         // context window for the model
 *     percentage: number,        // totalTokens / maxTokens, [0..1+]
 *     categories: Category[],    // System prompt, Tools, Skills, Messages, ...
 *     grid: GridItem[],          // proportional strip entries, no padding
 *     apiUsage: { input_tokens, output_tokens,
 *                 cache_creation_input_tokens,
 *                 cache_read_input_tokens } | null,
 *     messages: MessageBlock[],  // one per message, with cache stats + size hint
 *   }
 *
 * `grid` items are { kind, weight, tokens, categoryName, children? }. The
 * `messages` kind nests per-message children for sub-tiling inside its
 * strip. Weights sum to ~1 across visible categories (no free placeholders).
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

  /** Best-effort. Returns one of: "claude" | "codex" | "pi" | "unknown". */
  function inferProvider(payload) {
    if (!payload || typeof payload !== "object") return "unknown";
    const tp = stringField(payload, "transcript_path", "transcriptPath");
    const cwd = stringField(payload, "cwd");
    const source = stringField(payload, "source").toLowerCase();
    const haystack = (tp + "\n" + cwd + "\n" + source).toLowerCase();
    if (haystack.includes("/.claude/") || haystack.includes("\\.claude\\") || source === "claude") {
      return "claude";
    }
    if (haystack.includes("/.codex/") || haystack.includes("\\.codex\\") || source === "codex") {
      return "codex";
    }
    if (haystack.includes("/.pi/") || haystack.includes("\\.pi\\") || source === "pi") {
      return "pi";
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
  };

  function getContextWindowForModel(model) {
    if (typeof model === "string" && MODEL_CONTEXT_WINDOWS[model]) {
      return MODEL_CONTEXT_WINDOWS[model];
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
    if (typeof latest.input_tokens === "number") usage.input_tokens = latest.input_tokens;
    if (typeof latest.output_tokens === "number") usage.output_tokens = latest.output_tokens;
    if (typeof latest.cache_creation_input_tokens === "number") usage.cache_creation_input_tokens = latest.cache_creation_input_tokens;
    if (typeof latest.cache_read_input_tokens === "number") usage.cache_read_input_tokens = latest.cache_read_input_tokens;
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

    // Build the proportional grid: one entry per category whose tokens
    // contribute, with a `weight` = its share of used tokens. The renderer
    // paints each entry as a strip whose flex-grow equals its weight, so
    // the bar fills its container exactly — no fake placeholder cells.
    // Free space becomes real whitespace on the right (or below, on
    // narrow viewports).
    //
    // For the `messages` category we nest `children[]` so the renderer
    // can sub-tile the messages strip with one tile per message block.
    const totalUsed = totalTokens;
    const grid = [];
    for (const cat of categories) {
      if (cat.tokens <= 0) continue;
      const weight = totalUsed > 0 ? (cat.tokens / totalUsed) : 0;
      const item = {
        kind: cat.kind,
        weight,
        tokens: cat.tokens,
        categoryName: cat.name,
      };
      if (cat.kind === "messages"
          && Array.isArray(cat.message_blocks)
          && cat.message_blocks.length > 0) {
        const blocks = cat.message_blocks;
        const msgTotal = blocks.reduce((s, b) => s + (b.tokens > 0 ? b.tokens : 0), 0) || 1;
        item.children = blocks.map((b) => ({
          id: b.id,
          kind: b.kind,
          weight: msgTotal > 0 ? ((b.tokens > 0 ? b.tokens : 0) / msgTotal) : 0,
          tokens: b.tokens || 0,
          hit_count: (b.cache && b.cache.hit_count) || 0,
          cache: b.cache || null,
        }));
      }
      grid.push(item);
    }

    return {
      model,
      provider,
      totalTokens,
      maxTokens,
      percentage,
      categories,
      grid,
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

  /** Tile size for a single message block: width = height = base +
   *  (max-base) * sqrt(weight), so the tile's area scales linearly with
   *  the block's token share of the messages category. Caps at `max` so a
   *  single dominant block can't dominate the strip. */
  function blockSizePx(tokens, totalTokens) {
    const share = totalTokens > 0 ? (tokens / totalTokens) : 0;
    const base = 14;
    const max = 36;
    const clamped = share < 0 ? 0 : (share > 1 ? 1 : share);
    return Math.round(base + (max - base) * Math.sqrt(clamped));
  }

  // ---------- Renderer ------------------------------------------------------
  //
  // The renderer is split into two halves so we can test the structural
  // output without a DOM:
  //
  //   * build*Tree() functions return plain-object trees shaped like
  //     { tag, class, attrs, children } (recursively). These are pure and
  //     easy to assert on in runTests.
  //
  //   * mountTree() walks a tree and builds real DOM nodes. All DOM
  //     touching happens here; the builders never call document.*.
  //
  // renderContextUsageMap() ties the two together.

  function buildHeaderTree(data) {
    const pct = (data.percentage * 100).toFixed(1);
    const subChildren = [
      { text: data.model || "unknown model", className: "ctx-header__model" },
      { text: " · " },
      {
        text:
          formatTokens(data.totalTokens) + " / " + formatTokens(data.maxTokens)
          + " tokens (" + pct + "%)",
        className: "ctx-header__tokens",
      },
    ];
    if (data.apiUsage && data.apiUsage.cache_read_input_tokens > 0) {
      const cached = data.apiUsage.cache_read_input_tokens;
      const created = data.apiUsage.cache_creation_input_tokens || 0;
      subChildren.push({
        text: " · " + formatTokens(cached) + " cache hits (" + formatTokens(created) + " created)",
        className: "ctx-header__cache",
      });
    }
    return {
      tag: "div",
      className: "ctx-header",
      children: [
        { tag: "h2", className: "ctx-header__title", text: "Context Usage" },
        { tag: "div", className: "ctx-header__sub", children: subChildren },
      ],
    };
  }

  function buildLegendTree(data) {
    // Always include the four category kinds, even when some are absent
    // from this session — keeps the legend stable across sessions.
    const kinds = [
      { kind: "system_prompt", label: "System prompt" },
      { kind: "system_tools", label: "System tools" },
      { kind: "skills", label: "Skills" },
      { kind: "messages", label: "Messages" },
    ];
    const items = kinds.map((k) => ({
      tag: "span",
      className: "ctx-legend__item",
      children: [
        {
          tag: "span",
          className: "ctx-legend__sw ctx-legend__sw--" + k.kind,
          attrs: { "aria-hidden": "true" },
        },
        { text: k.label },
      ],
    }));
    return {
      tag: "div",
      className: "ctx-legend",
      attrs: { role: "list" },
      children: items,
    };
  }

  function buildGridTree(data) {
    const now = Date.now();
    const cats = Array.isArray(data.grid) ? data.grid : [];
    const catChildren = cats.map((c) => {
      const isMessages = c.kind === "messages";
      const subChildren = isMessages && Array.isArray(c.children)
        ? c.children.map((sub) => {
            const tone = cacheTone(sub.cache, now);
            const node = {
              tag: "div",
              className: "ctx-grid__sub",
              attrs: {
                "data-block-id": sub.id || "",
                "data-kind": sub.kind || "",
                title: buildMsgTitle(sub),
              },
              style: { flexGrow: String(sub.weight || 0) },
            };
            if (tone) node.className += " ctx-grid__sub--ttl-" + tone;
            return node;
          })
        : null;
      const node = {
        tag: "div",
        className: "ctx-grid__cat ctx-grid__cat--" + (c.kind || "unknown"),
        attrs: {
          title: (c.categoryName || c.kind) + " · " + formatTokens(c.tokens || 0),
        },
        style: { flexGrow: String(c.weight || 0) },
      };
      if (subChildren) {
        node.children = subChildren;
        node.attrs["data-has-children"] = "1";
      }
      return node;
    });
    return [
      {
        tag: "div",
        className: "ctx-grid",
        attrs: { "data-kind": "grid" },
        children: [{ tag: "div", className: "ctx-grid__strip", children: catChildren }],
      },
      buildLegendTree(data),
    ];
  }

  function buildMsgTitle(b) {
    const tipParts = [];
    tipParts.push((b.kind || "block") + (b.tool_name ? " · " + b.tool_name : ""));
    if (b.text) tipParts.push(firstLine(b.text, 80));
    if (b.tokens) tipParts.push(formatTokens(b.tokens) + " tokens");
    const hits = b.hit_count || 0;
    if (hits > 0) tipParts.push(hits + " cache hit" + (hits === 1 ? "" : "s"));
    if (b.cache && b.cache.ttl_kind) tipParts.push("ttl " + b.cache.ttl_kind);
    if (b.cache && b.cache.expires_at) {
      const rem = Math.max(0, Date.parse(b.cache.expires_at) - Date.now());
      tipParts.push("expires in " + formatAge(rem));
    }
    return tipParts.join("\n");
  }

  function buildMsgTree(data) {
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    const msgTotal = msgs.reduce((s, b) => s + (b.tokens > 0 ? b.tokens : 0), 0);
    const tiles = msgs.map((b) => {
      const hits = (b.cache && b.cache.hit_count) || 0;
      const sz = blockSizePx(b.tokens || 0, msgTotal);
      const tone = cacheTone(b.cache, Date.now());
      const node = {
        tag: "button",
        className: "ctx-msg ctx-msg__border--" + (b.kind || "unknown"),
        attrs: {
          type: "button",
          "data-block-id": b.id,
          title: buildMsgTitle({
            kind: b.kind,
            tool_name: b.tool_name,
            text: b.text,
            tokens: b.tokens,
            hit_count: hits,
            cache: b.cache,
          }),
        },
        style: { width: sz + "px", height: sz + "px" },
      };
      if (tone) node.className += " ctx-msg--ttl-" + tone;
      // Hits badge: small bottom-right pill so size stays token-driven.
      if (hits > 0) {
        node.children = [
          {
            tag: "span",
            className: "ctx-msg__badge",
            text: hits > 99 ? "99+" : "" + hits,
          },
        ];
      }
      return node;
    });
    if (tiles.length === 0) return null;
    return {
      tag: "div",
      className: "ctx-msgs",
      children: [
        {
          tag: "div",
          className: "ctx-msgs__header",
          children: [
            { tag: "span", className: "ctx-msgs__title", text: "Message blocks" },
            {
              tag: "span",
              className: "ctx-msgs__sub",
              text: "color = cache expiration · size = tokens · border = kind",
            },
          ],
        },
        { tag: "div", className: "ctx-msg-grid", children: tiles },
      ],
    };
  }

  function buildCategoryListTree(data) {
    const rows = (data.categories || []).map((c) => {
      const pct = ((c.tokens / Math.max(data.maxTokens, 1)) * 100).toFixed(1) + "%";
      return {
        tag: "div",
        className: "ctx-cat ctx-cat--" + (c.kind || "unknown"),
        children: [
          {
            tag: "div",
            className: "ctx-cat__row",
            children: [
              {
                tag: "div",
                className: "ctx-cat__left",
                children: [
                  { tag: "span", className: "ctx-cat__name", text: c.name },
 { tag: "span", className: "ctx-cat__tokens", text: formatTokens(c.tokens) },
 { tag: "span", className: "ctx-cat__pct", text: pct },
                ],
              },
              {
                tag: "div",
                className: "ctx-cat__bar",
                children: [
                  {
 tag: "div",
 className: "ctx-cat__bar-fill ctx-cat__bar-fill--" + (c.kind || "unknown"),
                    style: {
                      width:
                        Math.min(100, (c.tokens / Math.max(data.maxTokens, 1)) * 100) + "%",
                    },
                  },
                ],
              },
            ],
          },
        ],
      };
    });
    return { tag: "div", className: "ctx-cats", children: rows };
  }

  /** Mount a plain-object tree into a real DOM container. Each node is
   *  { tag, className?, text?, attrs?, style?, children? }. Strings/numbers
   *  in `children` become text nodes. */
  function mountTree(tree, container) {
    const node = document.createElement(tree.tag || "div");
    if (tree.className) node.className = tree.className;
    if (tree.attrs) {
      for (const k in tree.attrs) {
        const v = tree.attrs[k];
        if (v == null) continue;
        node.setAttribute(k, String(v));
      }
    }
    if (tree.style) {
      for (const k in tree.style) node.style[k] = tree.style[k];
    }
    if (tree.text != null) node.textContent = String(tree.text);
    if (tree.children) {
      for (const ch of tree.children) {
        if (ch == null) continue;
        if (typeof ch === "string" || typeof ch === "number") {
          node.appendChild(document.createTextNode(String(ch)));
        } else if (ch.text != null && !ch.tag) {
          node.appendChild(document.createTextNode(String(ch.text)));
        } else {
          node.appendChild(mountTree(ch, container));
        }
      }
    }
    return node;
  }

  function buildEmptyTree() {
    return {
      tag: "div",
      className: "ctx-empty",
      text: "No context captured for this session yet.",
    };
  }

  function renderContextUsageMap(data, container, callbacks) {
    callbacks = callbacks || {};
    container.textContent = "";
    if (!data || !data.categories || data.categories.length === 0) {
      container.appendChild(mountTree(buildEmptyTree(), container));
      return;
    }

    // Header
    container.appendChild(mountTree(buildHeaderTree(data), container));

    // Grid + legend
    const gridTrees = buildGridTree(data);
    for (const t of gridTrees) {
      container.appendChild(mountTree(t, container));
    }

    // Message tiles (click → modal)
    const msgTree = buildMsgTree(data);
    if (msgTree) {
      const msgNode = mountTree(msgTree, container);
      container.appendChild(msgNode);
      const grid = msgNode.querySelector(".ctx-msg-grid");
      if (grid) {
        grid.addEventListener("click", (e) => {
          const t = e.target.closest("[data-block-id]");
          if (!t) return;
          const id = t.dataset.blockId;
          const block = (data.messages || []).find((b) => b.id === id);
          if (block && callbacks.onItemClick) callbacks.onItemClick(block);
        });
      }
    }

    // Per-category list
    container.appendChild(mountTree(buildCategoryListTree(data), container));
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
    t("inferProvider: unknown on empty",
      inferProvider({}) === "unknown");

    // Model inference
    t("inferModel: from assistant event",
      inferModel([{ kind: "assistant_stop", model: "claude-opus-4-7" }]) === "claude-opus-4-7");
    t("inferModel: from payload.model",
      inferModel([{ kind: "tool", payload: { model: "gpt-4" } }]) === "gpt-4");
    t("inferModel: empty fallback",
      inferModel([]) === "");

    // Context window lookup
    t("context window: claude-opus-4-7 → 1M",
      getContextWindowForModel("claude-opus-4-7") === 1_000_000);
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

    // blockSizePx: tile area scales with token share via sqrt.
    t("blockSizePx: 0 → base",
      blockSizePx(0, 1000) === 14);
    t("blockSizePx: full share → max",
      blockSizePx(1000, 1000) === 36);
    t("blockSizePx: half share → between base and max",
      (function () {
        const sz = blockSizePx(500, 1000);
        return sz > 14 && sz < 36;
      })());
    t("blockSizePx: monotonic across sweep",
      (function () {
        let prev = blockSizePx(0, 1000);
        for (let i = 1; i <= 10; i++) {
          const cur = blockSizePx(i * 100, 1000);
          if (cur < prev) return false;
          prev = cur;
        }
        return true;
      })());

    // Tree builders: pure, no DOM. Build stub data shaped like the real
    // aggregator output and assert structural properties.
    const stubData = {
      model: "claude-opus-4-7",
      provider: "claude",
      totalTokens: 6200,
      maxTokens: 200_000,
      percentage: 0.031,
      categories: [
        { kind: "system_prompt", name: "System prompt", tokens: 1500, items: [] },
        { kind: "system_tools", name: "System tools", tokens: 700, items: [] },
        { kind: "messages", name: "Messages", tokens: 4000, items: [] },
      ],
      grid: [
        { kind: "system_prompt", weight: 0.242, tokens: 1500, categoryName: "System prompt" },
        { kind: "system_tools", weight: 0.113, tokens: 700, categoryName: "System tools" },
 {
          kind: "messages", weight: 0.645, tokens: 4000, categoryName: "Messages",
          children: [
 { id: "m:u1", kind: "user", weight: 0.25, tokens: 1000, hit_count: 0, cache: null },
 { id: "m:a1", kind: "assistant", weight: 0.5, tokens: 2000, hit_count: 2, cache: { hit_count: 2, ttl_kind: "5m", expires_at: new Date(Date.now() + 60_000).toISOString() } },
 { id: "m:t1", kind: "tool_call", weight: 0.25, tokens: 1000, hit_count: 0, cache: null },
          ],
        },
      ],
      messages: [
 { id: "m:u1", kind: "user", tokens: 1000, text: "hi", tool_name: "", cache: null },
 { id: "m:a1", kind: "assistant", tokens: 2000, text: "hello back", tool_name: "", cache: { hit_count: 2, ttl_kind: "5m", expires_at: new Date(Date.now() + 60_000).toISOString() } },
 { id: "m:t1", kind: "tool_call", tokens: 1000, text: "Read", tool_name: "Read", cache: null },
      ],
      apiUsage: null,
    };

    // buildHeaderTree
    const hdr = buildHeaderTree(stubData);
    t("headerTree: class ctx-header", hdr && hdr.className === "ctx-header");
    t("headerTree: title is 'Context Usage'",
      hdr.children[0] && hdr.children[0].text === "Context Usage");

    // buildGridTree: returns [grid, legend].
    const gridTrees = buildGridTree(stubData);
    t("gridTree: returns [grid, legend]",
      Array.isArray(gridTrees) && gridTrees.length === 2);
    t("gridTree: first child is the strip wrapper",
      gridTrees[0].children[0].className === "ctx-grid__strip");
    t("gridTree: one cat per visible category (no free padding)",
      gridTrees[0].children[0].children.length === 3);
    t("gridTree: weights sum to ~1.0 across cats",
      Math.abs(gridTrees[0].children[0].children.reduce((s, c) => s + (Number(c.style.flexGrow) || 0), 0) - 1.0) < 0.01);
    t("gridTree: messages cat has sub-tile children",
      gridTrees[0].children[0].children[2].children
        && gridTrees[0].children[0].children[2].children.length === 3);
    t("gridTree: sub-tile child weights sum to ~1.0 within messages",
      Math.abs(gridTrees[0].children[0].children[2].children.reduce((s, c) => s + (Number(c.style.flexGrow) || 0), 0) - 1.0) < 0.01);
    t("gridTree: legend lists all 4 category kinds",
      gridTrees[1].children.length === 4
        && gridTrees[1].children.every((c) => c.className && c.className.indexOf("ctx-legend__item") === 0));

    // buildMsgTree: one tile per message, square (border-radius not 50%).
    const msgTree = buildMsgTree(stubData);
    t("msgTree: wraps tiles in ctx-msg-grid",
      msgTree && msgTree.children[1].className === "ctx-msg-grid");
    t("msgTree: one tile per message",
      msgTree.children[1].children.length === 3);
    t("msgTree: tile size uses blockSizePx (square, in 14–36 range)",
 (function () {
 const tile = msgTree.children[1].children[1];
 const w = parseInt(tile.style.width, 10);
 const h = parseInt(tile.style.height, 10);
 return w === h && w >= 14 && w <= 36;
 })());
    t("msgTree: hits badge present on tiles with cache hits",
      msgTree.children[1].children[1].children
        && msgTree.children[1].children[1].children[0].className === "ctx-msg__badge");
    t("msgTree: TTL palette class applied when cache tone exists",
      /ctx-msg--ttl-/.test(msgTree.children[1].children[1].className));
    t("msgTree: returns null when no messages",
      buildMsgTree({ messages: [] }) === null);

    // buildCategoryListTree: one row per category.
    const catsTree = buildCategoryListTree(stubData);
    t("catsTree: one row per category",
      catsTree.children.length === stubData.categories.length);
 t("catsTree: bar fill uses ctx-cat__bar-fill--kind class",
      catsTree.children[0].children[0].children[1].children[0].className.indexOf("ctx-cat__bar-fill--system_prompt") >= 0);

    return results;
  }

  // ---------- Export -------------------------------------------------------

  window.Traceframe = window.Traceframe || {};
  window.Traceframe.context = {
    // Aggregator + renderer.
    buildContextUsageMap,
    renderContextUsageMap,
    // Pure tree builders (tested without a DOM).
    buildHeaderTree,
    buildGridTree,
    buildMsgTree,
    buildCategoryListTree,
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
