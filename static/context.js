/*
 * context.js — context-focused view for a single session.
 *
 * Aggregates the per-session timeline + the flat hook list into a stack of
 * logical blocks: session metadata, instructions, tools available, files
 * (cache), commands, searches, skills, turns, compacts, notes. Each block
 * and each item has a "last touched" timestamp; the age is colored by
 * staleness, and a hover tooltip shows the full timestamp + age + the
 * provider-specific note about what the staleness actually means.
 *
 * Provider inference: the hook payloads carry the same shape for Claude,
 * Codex, and Pi, but `transcript_path` and a few hints let us label the
 * session for the badge. The block contents are provider-agnostic.
 *
 * No server roundtrips. Pure functions, no DOM access in the aggregator.
 *
 * Loaded as a classic <script> by static/index.html; attaches to
 * window.Traceframe.context and exposes runTests() for the in-page smoke
 * runner.
 */
(function () {
  "use strict";

  // ---------- Provider inference -----------------------------------------

  // Best-effort. Looks at transcript_path, a couple of payload fields, and
  // session_name. Returns one of: "claude" | "codex" | "pi" | "unknown".
  // Falls back to "unknown" gracefully — the rest of the view is
  // provider-agnostic and renders fine without a label.
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
      const v = obj[k];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return "";
  }
  function numberField(obj, ...keys) {
    for (const k of keys) {
      const v = obj ? obj[k] : undefined;
      if (typeof v === "number" && !isNaN(v)) return v;
    }
    return 0;
  }


  // ---------- Staleness color buckets ------------------------------------
  //
  // These are *our* freshness signal, not a provider cache TTL. The values
  // are tuned for "agent-in-a-loop" pacing: <5m feels live, 5–30m is the
  // agent's "I should look at this again" zone, >30m is probably stale.
  // The tooltip text says so explicitly so the meaning isn't lost.
  //
  // Buckets are kind-aware because the meaning of "stale" differs. A
  // tool used 90 minutes ago is normal; a file read 90 minutes ago and
  // not re-read since is genuinely out-of-date.
  function stalenessTone(kind, ageMs) {
    if (ageMs == null || ageMs < 0) return "fresh";
    if (kind === "file") {
      if (ageMs < 5 * 60_000) return "fresh";
      if (ageMs < 30 * 60_000) return "warm";
      return "cold";
    }
    if (kind === "tool") {
      if (ageMs < 15 * 60_000) return "fresh";
      if (ageMs < 60 * 60_000) return "warm";
      return "cold";
    }
    if (ageMs < 10 * 60_000) return "fresh";
    if (ageMs < 60 * 60_000) return "warm";
    return "cold";
  }

  function formatAge(ageMs) {
    if (ageMs == null || ageMs < 0) return "—";
    if (ageMs < 1000) return "<1s";
    const s = Math.floor(ageMs / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m " + (s % 60) + "s";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h " + (m % 60) + "m";
    const d = Math.floor(h / 24);
    return d + "d " + (h % 24) + "h";
  }

  function formatFullTimestamp(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  }

  // ---------- Hook extraction --------------------------------------------

  // The timeline groups events into turns, but we need every hook event
  // for a session to compute some block contents (compacts, notifications,
  // the file dedup). `hooks` is the flat list from /api/hooks filtered to
  // the current session.
  function filterSessionHooks(allHooks, sessionID) {
    return (allHooks || []).filter((h) => h && h.session_id === sessionID);
  }

  // Tries to pull a path string out of an event's input/output, however
  // the provider spelled it. Returns "" if not a file-bearing event.
  function filePathOf(ev) {
    if (!ev) return "";
    const input = ev.input || {};
    if (typeof input.file_path === "string") return input.file_path;
    if (typeof input.notebook_path === "string") return input.notebook_path;
    if (typeof input.path === "string") return input.path;
    if (typeof input.pattern === "string" && typeof input.path === "string") {
      return input.path; // Glob/Grep with pattern + path
    }
    if (Array.isArray(input.path) && input.path.length) {
      return String(input.path[0]);
    }
    const output = ev.output || {};
    if (typeof output.filePath === "string") return output.filePath;
    if (typeof output.path === "string") return output.path;
    return "";
  }

  function firstLine(s, max) {
    if (!s) return "";
    const i = String(s).indexOf("\n");
    const head = i >= 0 ? s.slice(0, i) : s;
    if (max && head.length > max) return head.slice(0, max) + "…";
    return head;
  }
  function findFirst(arr, pred) {
    if (!arr) return null;
    for (let i = 0; i < arr.length; i++) {
      if (pred(arr[i])) return arr[i];
    }
    return null;
  }


  // ---------- Block builders ---------------------------------------------

  // Each builder returns either:
  //   - a block object (added to the output)
  //   - null (skipped — nothing meaningful for this session)
  // Block shape:
  //   { kind, title, icon, subtitle, count, last_touched, items, empty_text, raw_events }
  // Item shape:
  //   { id, title, subtitle, event_id, touched_at, kind, count, status, tooltip, raw_events }

  function buildSessionBlock(timeline, hooks) {
    const s = (timeline && timeline.session) || {};
    const provider = inferProvider(extractFirstPayload(hooks));
    const first = hooks && hooks.length ? hooks[hooks.length - 1] : null; // oldest
    const last = hooks && hooks.length ? hooks[0] : null; // newest
    const started = s.started_at || (first && first.event_time) || "";
    const ended = s.ended_at || (last && last.event_time) || "";
    const lines = [
      provider !== "unknown" ? "Provider: " + provider : null,
      "Started: " + formatFullTimestamp(started),
      "Ended: " + formatFullTimestamp(ended),
      "Duration: " + (s.duration_ms ? formatAge(s.duration_ms) : "—"),
      "Turns: " + (s.turn_count || 0),
      "Tools: " + (s.tool_count || 0),
      "Events: " + (s.event_count || (hooks ? hooks.length : 0)),
      s.failure_count ? "Failures: " + s.failure_count : null,
    ].filter(Boolean);
    return {
      kind: "session",
      title: "Session",
      icon: "◉",
      subtitle: provider !== "unknown" ? provider : "agent session",
      count: 0,
      last_touched: ended,
      items: lines.map((line, i) => ({
        id: "session-line-" + i,
        title: line,
        subtitle: "",
        event_id: null,
        touched_at: ended,
        kind: "session",
        tooltip: null,
        raw_events: [],
      })),
      empty_text: "",
      raw_events: [],
    };
  }

  function extractFirstPayload(hooks) {
    if (!hooks || !hooks.length) return null;
    // The first event we can find with a real payload wins. SessionStart is
    // a good candidate but might not be first in `hooks`; fall back to
    // whatever the timeline carries.
    for (const h of hooks) {
      if (h && (h.transcript_path || h.cwd || h.hook_event_name === "SessionStart")) {
        return h;
      }
    }
    return hooks[0];
  }

  function buildInstructionsBlock(timeline, hooks) {
    // We have no system prompt in the hook payload. Show what we *do* have:
    // the first user prompt (as the task) and the first SessionStart's
    // permission mode + effort + cwd. Honest about what's missing.
    const firstPrompt = findFirst(hooks, (h) => h.kind === "user_prompt");
    const firstStart = findFirst(hooks, (h) => h.event_name === "SessionStart");
    const items = [];

    if (firstStart) {
      const perm = firstStart.permission_mode;
      if (perm) {
        items.push({
          id: "perm-mode",
          title: "Permission mode: " + perm,
          subtitle: "set at session start",
          event_id: firstStart.event_id,
          touched_at: firstStart.event_time,
          kind: "instructions",
          tooltip: "Permission mode set at session start. " +
            "It controls which tool actions the agent auto-approves.",
        });
      }
      const effort = firstStart.effort;
      if (effort) {
        items.push({
          id: "effort",
          title: "Effort: " + effort,
          subtitle: "set at session start",
          event_id: firstStart.event_id,
          touched_at: firstStart.event_time,
          kind: "instructions",
          tooltip: "Reasoning effort requested at session start. " +
            "Doesn't change the hook stream.",
        });
      }
    }

    if (firstPrompt) {
      items.push({
        id: "first-prompt",
        title: "First prompt: " + firstLine(firstPrompt.content || firstPrompt.summary || "", 100),
        subtitle: "stand-in for the task",
        event_id: firstPrompt.event_id,
        touched_at: firstPrompt.event_time,
        kind: "instructions",
        tooltip: "The first user prompt in this session, shown as a stand-in " +
          "for the task. The system prompt itself is not in the hook payload.",
      });
    }

    if (items.length === 0) {
      return null;
    }
    return {
      kind: "instructions",
      title: "Instructions",
      icon: "§",
      subtitle: "what the agent was started with",
      count: items.length,
      last_touched: items[0].touched_at,
      items,
      empty_text: "No instructions captured for this session.",
      raw_events: items.filter((i) => i.event_id).map((i) => i.event_id),
    };
  }

  function buildToolsBlock(timeline, hooks) {
    // All unique tool_name values, with the call count and last invocation
    // time. Order by count desc; ties broken by last invocation desc.
    const map = new Map();
    for (const h of hooks || []) {
      if (h.kind !== "tool" || !h.tool_name) continue;
      const cur = map.get(h.tool_name) || {
        name: h.tool_name,
        count: 0,
        errors: 0,
        first_at: h.event_time,
        last_at: h.event_time,
        event_id: h.event_id,
        status: h.status,
      };
      cur.count += 1;
      if (h.status === "error") cur.errors += 1;
      if (h.event_time && (!cur.last_at || h.event_time > cur.last_at)) {
        cur.last_at = h.event_time;
        cur.event_id = h.event_id;
      }
      if (h.event_time && h.event_time < cur.first_at) {
        cur.first_at = h.event_time;
      }
      map.set(h.tool_name, cur);
    }
    const items = [...map.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(b.last_at).localeCompare(String(a.last_at));
    });
    if (items.length === 0) return null;
    return {
      kind: "tools",
      title: "Tools available",
      icon: "⚙",
      subtitle: "every tool the agent called in this session",
      count: items.length,
      last_touched: items[0].last_at,
      items: items.map((t) => ({
        id: "tool-" + t.name,
        title: t.name,
        subtitle: t.count + " call" + (t.count === 1 ? "" : "s") +
          (t.errors ? " · " + t.errors + " failed" : ""),
        event_id: t.event_id,
        touched_at: t.last_at,
        kind: "tool",
        tooltip:
          "First invoked: " + formatFullTimestamp(t.first_at) + "\n" +
          "Last invoked: " + formatFullTimestamp(t.last_at) + "\n" +
          "Total calls: " + t.count +
          (t.errors ? "\nFailures: " + t.errors : ""),
      })),
      empty_text: "No tool calls captured.",
      raw_events: items.map((t) => t.event_id).filter(Boolean),
    };
  }

  function buildFilesBlock(timeline, hooks) {
    // One item per unique file_path, with the latest touch and a "kinds"
    // summary (read/edited/etc). Read and Edit on the same file collapse
    // into one block item but keep both events in raw_events.
    const fileTools = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
    const map = new Map();
    for (const h of hooks || []) {
      if (h.kind !== "tool" || !fileTools.has(h.tool_name)) continue;
      const path = filePathOf(h);
      if (!path) continue;
      const cur = map.get(path) || {
        path,
        kinds: new Set(),
        lines: 0,
        first_at: h.event_time,
        last_at: h.event_time,
        last_event_id: h.event_id,
        last_tool: h.tool_name,
        events: [],
      };
      cur.kinds.add(h.tool_name);
      if (h.event_time && (!cur.last_at || h.event_time > cur.last_at)) {
        cur.last_at = h.event_time;
        cur.last_event_id = h.event_id;
        cur.last_tool = h.tool_name;
      }
      if (h.event_time && h.event_time < cur.first_at) {
        cur.first_at = h.event_time;
      }
      const numLines = numberField(h.output, "numLines");
      if (numLines > cur.lines) cur.lines = numLines;
      cur.events.push(h);
      map.set(path, cur);
    }
    const items = [...map.values()].sort((a, b) =>
      String(b.last_at).localeCompare(String(a.last_at))
    );
    if (items.length === 0) return null;
    return {
      kind: "files",
      title: "Files (cache)",
      icon: "▤",
      subtitle: "files the agent has read or written this session",
      count: items.length,
      last_touched: items[0].last_at,
      items: items.map((f) => {
        const kinds = [...f.kinds].sort();
        const subtitleParts = [];
        if (kinds.length) subtitleParts.push(kinds.join(" · "));
        if (f.lines) subtitleParts.push(f.lines + " lines");
        return {
          id: "file-" + f.path,
          title: f.path,
          subtitle: subtitleParts.join(" · "),
          event_id: f.last_event_id,
          touched_at: f.last_at,
          kind: "file",
          tooltip:
            "Path: " + f.path + "\n" +
            "Last touched: " + formatFullTimestamp(f.last_at) + "\n" +
            "First touched: " + formatFullTimestamp(f.first_at) + "\n" +
            "Operations: " + kinds.join(", ") + "\n" +
            (f.lines ? "Lines: " + f.lines + "\n" : "") +
            "\nNote: the age below is our staleness signal, not a provider cache TTL. " +
            "It refreshes the next time the agent touches this file.",
        };
      }),
      empty_text: "No files were read or written.",
      raw_events: items.map((f) => f.last_event_id).filter(Boolean),
    };
  }

  function buildCommandsBlock(timeline, hooks) {
    const items = [];
    for (const h of hooks || []) {
      if (h.kind !== "tool" || h.tool_name !== "Bash") continue;
      const input = h.input || {};
      const command = input.command || input.description || "";
      const exit = numberField(h.output, "exitCode");
      items.push({
        id: "cmd-" + h.event_id,
        title: firstLine(input.description || command, 100),
        subtitle: exit != null ? "exit " + exit : (h.status === "error" ? "failed" : ""),
        event_id: h.event_id,
        touched_at: h.event_time,
        kind: "command",
        tooltip:
          "Command: " + firstLine(command, 500) + "\n" +
          "When: " + formatFullTimestamp(h.event_time) + "\n" +
          (exit != null ? "Exit: " + exit + "\n" : "") +
          (h.status ? "Status: " + h.status : ""),
      });
    }
    if (items.length === 0) return null;
    items.sort((a, b) => String(b.touched_at).localeCompare(String(a.touched_at)));
    return {
      kind: "commands",
      title: "Commands",
      icon: "$",
      subtitle: "Bash commands run by the agent",
      count: items.length,
      last_touched: items[0].touched_at,
      items,
      empty_text: "No commands run.",
      raw_events: items.map((i) => i.event_id),
    };
  }

  function buildSearchesBlock(timeline, hooks) {
    const items = [];
    for (const h of hooks || []) {
      if (h.kind !== "tool") continue;
      if (h.tool_name !== "WebFetch" && h.tool_name !== "WebSearch" && h.tool_name !== "Glob" && h.tool_name !== "Grep") {
        continue;
      }
      const input = h.input || {};
      const text = input.query || input.url || input.pattern || "";
      items.push({
        id: "search-" + h.event_id,
        title: h.tool_name + ": " + firstLine(text, 100),
        subtitle: h.tool_name === "Glob" || h.tool_name === "Grep" ? (input.path || "") : "",
        event_id: h.event_id,
        touched_at: h.event_time,
        kind: "search",
        tooltip: h.tool_name + ": " + text + "\nWhen: " + formatFullTimestamp(h.event_time),
      });
    }
    if (items.length === 0) return null;
    items.sort((a, b) => String(b.touched_at).localeCompare(String(a.touched_at)));
    return {
      kind: "searches",
      title: "Searches",
      icon: "⌕",
      subtitle: "web searches, fetches, and file queries",
      count: items.length,
      last_touched: items[0].touched_at,
      items,
      empty_text: "No searches run.",
      raw_events: items.map((i) => i.event_id),
    };
  }

  function buildSkillsBlock(timeline, hooks) {
    // No provider sends skill paths through the hook stream. Show the
    // session's permission_mode + first cwd as the only "skills" data we
    // have, and be explicit that this is best-effort.
    const firstStart = findFirst(hooks, (h) => h.event_name === "SessionStart");
    if (!firstStart) return null;
    const items = [];
    if (firstStart.cwd) {
      items.push({
        id: "skill-cwd",
        title: "Working dir: " + firstStart.cwd,
        subtitle: "project root the agent started in",
        event_id: firstStart.event_id,
        touched_at: firstStart.event_time,
        kind: "skill",
        tooltip: "The cwd the agent was started in. " +
          "Project-local skills (Claude: .claude/skills, Pi: .pi/skills, " +
          "Codex: AGENTS.md) load from this tree, but the hook payload " +
          "doesn't list them.",
      });
    }
    if (firstStart.transcript_path) {
      items.push({
        id: "skill-transcript",
        title: "Transcript: " + firstStart.transcript_path,
        subtitle: "session log location",
        event_id: firstStart.event_id,
        touched_at: firstStart.event_time,
        kind: "skill",
        tooltip: "Path to the session's transcript. The provider's skills " +
          "and memory are loaded next to this file by the agent runtime, " +
          "not surfaced in the hook stream.",
      });
    }
    if (items.length === 0) return null;
    return {
      kind: "skills",
      title: "Skills & memory",
      icon: "✦",
      subtitle: "best-effort from the session payload",
      count: items.length,
      last_touched: items[0].touched_at,
      items,
      empty_text: "No skill or memory info captured.",
      raw_events: items.filter((i) => i.event_id).map((i) => i.event_id),
    };
  }

  function buildTurnsBlock(timeline, hooks) {
    // The existing per-turn grouping, presented as a single block. The
    // caller can still drop down to the "view timeline" toggle for the
    // per-event details.
    const turns = (timeline && timeline.turns) || [];
    if (turns.length === 0) return null;
    const last = turns[turns.length - 1];
    const items = turns.map((t, i) => {
      const lastEv = t.tools && t.tools.length ? t.tools[t.tools.length - 1] : t.response;
      return {
        id: "turn-" + i,
        title: "Turn " + (i + 1) + ": " + (t.prompt ? firstLine(t.prompt.content || t.prompt.summary || "(no prompt)", 80) : "(tool-only)"),
        subtitle: (t.tools || []).length + " tool" + ((t.tools || []).length === 1 ? "" : "s"),
        event_id: lastEv ? lastEv.event_id : (t.prompt ? t.prompt.event_id : null),
        touched_at: t.ended_at || t.started_at,
        kind: "turn",
        tooltip:
          "Started: " + formatFullTimestamp(t.started_at) + "\n" +
          "Ended: " + formatFullTimestamp(t.ended_at) + "\n" +
          "Tools: " + (t.tools || []).length,
      };
    });
    return {
      kind: "turns",
      title: "Turns",
      icon: "↻",
      subtitle: "prompt → tool calls → assistant",
      count: turns.length,
      last_touched: last ? (last.ended_at || last.started_at) : "",
      items,
      empty_text: "No turns in this session.",
      raw_events: items.map((i) => i.event_id).filter(Boolean),
    };
  }

  function buildCompactsBlock(timeline, hooks) {
    const items = [];
    for (const h of hooks || []) {
      if (h.kind !== "compact") continue;
      const trigger = stringField(h, "trigger") || stringField(h.input, "trigger");
      items.push({
        id: "compact-" + h.event_id,
        title: "Compact: " + (trigger || h.event_name),
        subtitle: "",
        event_id: h.event_id,
        touched_at: h.event_time,
        kind: "compact",
        tooltip: "Compaction event. " +
          "The hook payload doesn't include what was dropped.\n" +
          "When: " + formatFullTimestamp(h.event_time),
      });
    }
    if (items.length === 0) return null;
    items.sort((a, b) => String(a.touched_at).localeCompare(String(b.touched_at)));
    return {
      kind: "compacts",
      title: "Compacts",
      icon: "↦",
      subtitle: "context compaction events",
      count: items.length,
      last_touched: items[items.length - 1].touched_at,
      items,
      empty_text: "No compactions.",
      raw_events: items.map((i) => i.event_id),
    };
  }

  function buildNotesBlock(timeline, hooks) {
    const items = [];
    for (const h of hooks || []) {
      if (h.kind === "notification") {
        items.push({
          id: "note-" + h.event_id,
          title: "Notification: " + (h.summary || h.content || h.event_name),
          subtitle: "",
          event_id: h.event_id,
          touched_at: h.event_time,
          kind: "note",
          tooltip: formatFullTimestamp(h.event_time),
        });
      } else if (h.kind === "permission_request") {
        items.push({
          id: "perm-" + h.event_id,
          title: "Permission request: " + (h.tool_name || h.summary || ""),
          subtitle: "",
          event_id: h.event_id,
          touched_at: h.event_time,
          kind: "note",
          tooltip: formatFullTimestamp(h.event_time),
        });
      } else if (h.kind === "session_start") {
        items.push({
          id: "ss-" + h.event_id,
          title: "Session start" + (h.reason ? ": " + h.reason : ""),
          subtitle: "",
          event_id: h.event_id,
          touched_at: h.event_time,
          kind: "note",
          tooltip: formatFullTimestamp(h.event_time),
        });
      } else if (h.kind === "session_end") {
        items.push({
          id: "se-" + h.event_id,
          title: "Session end" + (h.reason ? ": " + h.reason : ""),
          subtitle: "",
          event_id: h.event_id,
          touched_at: h.event_time,
          kind: "note",
          tooltip: formatFullTimestamp(h.event_time),
        });
      } else if (h.kind === "tool" && h.status === "error") {
        items.push({
          id: "err-" + h.event_id,
          title: "Error: " + (h.tool_name || "tool") + " — " + (h.error || h.summary || "failed"),
          subtitle: "",
          event_id: h.event_id,
          touched_at: h.event_time,
          kind: "note",
          tooltip: formatFullTimestamp(h.event_time),
        });
      }
    }
    if (items.length === 0) return null;
    items.sort((a, b) => String(b.touched_at).localeCompare(String(a.touched_at)));
    return {
      kind: "notes",
      title: "Notes & errors",
      icon: "!",
      subtitle: "notifications, permission requests, session lifecycle, tool errors",
      count: items.length,
      last_touched: items[0].touched_at,
      items,
      empty_text: "Nothing to report.",
      raw_events: items.map((i) => i.event_id),
    };
  }

  // ---------- Public aggregator ------------------------------------------

  function buildContextBlocks(timeline, allHooks, opts) {
    const now = (opts && typeof opts.now === "number") ? opts.now : Date.now();
    const sessionID = (timeline && timeline.session && timeline.session.id) || "";
    const hooks = filterSessionHooks(allHooks, sessionID);

    const blocks = [
      buildSessionBlock(timeline, hooks),
      buildInstructionsBlock(timeline, hooks),
      buildToolsBlock(timeline, hooks),
      buildFilesBlock(timeline, hooks),
      buildCommandsBlock(timeline, hooks),
      buildSearchesBlock(timeline, hooks),
      buildSkillsBlock(timeline, hooks),
      buildTurnsBlock(timeline, hooks),
      buildCompactsBlock(timeline, hooks),
      buildNotesBlock(timeline, hooks),
    ].filter(Boolean);

    // Pre-compute staleness tone and age on every item, so the renderer
    // doesn't have to.
    for (const b of blocks) {
      for (const it of b.items) {
        const ts = it.touched_at ? new Date(it.touched_at).getTime() : NaN;
        it.age_ms = isNaN(ts) ? null : Math.max(0, now - ts);
        it.age_text = formatAge(it.age_ms);
        it.tone = stalenessTone(it.kind, it.age_ms);
      }
      if (b.last_touched) {
        const ts = new Date(b.last_touched).getTime();
        b.age_ms = isNaN(ts) ? null : Math.max(0, now - ts);
        b.age_text = formatAge(b.age_ms);
        b.tone = stalenessTone("block", b.age_ms);
      } else {
        b.age_text = "—";
        b.tone = "fresh";
      }
    }
    return { blocks, provider: inferProvider(extractFirstPayload(hooks)) };
  }

  // ---------- Render ------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderContextView(blocks, container, callbacks) {
    // callbacks: { onItemClick, onRawClick }
    container.textContent = "";
    if (!blocks || blocks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No context captured for this session yet.";
      container.appendChild(empty);
      return;
    }
    for (const b of blocks) {
      container.appendChild(renderBlock(b, callbacks));
    }
  }

  function renderBlock(block, callbacks) {
    const wrap = document.createElement("section");
    wrap.className = "ctx-block ctx-block--" + block.kind + " tone-" + (block.tone || "fresh");
    wrap.dataset.kind = block.kind;

    const header = document.createElement("header");
    header.className = "ctx-block__header";

    const title = document.createElement("div");
    title.className = "ctx-block__title";
    const icon = document.createElement("span");
    icon.className = "ctx-block__icon";
    icon.textContent = block.icon || "·";
    const titleText = document.createElement("span");
    titleText.textContent = block.title;
    title.append(icon, titleText);
    if (block.count > 0) {
      const count = document.createElement("span");
      count.className = "ctx-block__count";
      count.textContent = block.count;
      title.appendChild(count);
    }
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "ctx-block__meta";
    if (block.subtitle) {
      const sub = document.createElement("span");
      sub.className = "ctx-block__subtitle";
      sub.textContent = block.subtitle;
      meta.appendChild(sub);
    }
    if (block.last_touched && block.kind !== "session") {
      const age = document.createElement("span");
      age.className = "ctx-block__age chip tone-" + (block.tone || "fresh");
      age.textContent = block.age_text + " ago";
      age.title = "Last touched: " + formatFullTimestamp(block.last_touched);
      meta.appendChild(age);
    }
    if (block.raw_events && block.raw_events.length) {
      const raw = document.createElement("button");
      raw.type = "button";
      raw.className = "btn";
      raw.textContent = "View raw";
      raw.addEventListener("click", () => {
        if (callbacks && callbacks.onRawClick) callbacks.onRawClick(block.raw_events);
      });
      meta.appendChild(raw);
    }
    header.appendChild(meta);
    wrap.appendChild(header);

    const body = document.createElement("div");
    body.className = "ctx-block__body";
    if (!block.items || block.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ctx-block__empty";
      empty.textContent = block.empty_text || "Nothing.";
      body.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "ctx-item-list";
      for (const it of block.items) {
        list.appendChild(renderItem(it, block, callbacks));
      }
      body.appendChild(list);
    }
    wrap.appendChild(body);
    return wrap;
  }

  function renderItem(item, block, callbacks) {
    const li = document.createElement("li");
    li.className = "ctx-item tone-" + (item.tone || "fresh");
    li.dataset.eventId = item.event_id || "";
    li.dataset.blockKind = block.kind;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "ctx-item__main";
    main.disabled = !item.event_id;
    if (item.tooltip) {
      main.title = item.tooltip;
      main.dataset.tooltip = item.tooltip;
    }
    if (item.event_id && callbacks && callbacks.onItemClick) {
      main.addEventListener("click", () => callbacks.onItemClick(item));
    }

    const title = document.createElement("span");
    title.className = "ctx-item__title";
    title.textContent = item.title;
    main.appendChild(title);

    if (item.subtitle) {
      const sub = document.createElement("span");
      sub.className = "ctx-item__subtitle";
      sub.textContent = item.subtitle;
      main.appendChild(sub);
    }

    const side = document.createElement("span");
    side.className = "ctx-item__side";
    if (item.touched_at && block.kind !== "session") {
      const age = document.createElement("span");
      age.className = "chip tone-" + (item.tone || "fresh");
      age.textContent = item.age_text + " ago";
      age.title = formatFullTimestamp(item.touched_at);
      side.appendChild(age);
    }
    if (item.event_id) {
      const arrow = document.createElement("span");
      arrow.className = "ctx-item__arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      side.appendChild(arrow);
    }
    main.appendChild(side);

    li.appendChild(main);
    return li;
  }

  // ---------- Self-tests --------------------------------------------------

  function runTests() {
    const results = [];
    const t = function (name, cond, detail) {
      results.push((cond ? "PASS" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
    };

    // inferProvider basics
    t("inferProvider: claude via transcript_path",
      inferProvider({ transcript_path: "/Users/me/.claude/sessions/x.jsonl" }) === "claude",
      "got=" + inferProvider({ transcript_path: "/Users/me/.claude/sessions/x.jsonl" }));
    t("inferProvider: codex via cwd",
      inferProvider({ cwd: "/Users/me/.codex/work" }) === "codex");
    t("inferProvider: pi via source",
      inferProvider({ source: "pi" }) === "pi");
    t("inferProvider: unknown on empty",
      inferProvider({}) === "unknown");

    // stalenessTone
    t("stalenessTone file fresh <5m",
      stalenessTone("file", 60_000) === "fresh");
    t("stalenessTone file warm 5-30m",
      stalenessTone("file", 10 * 60_000) === "warm");
    t("stalenessTone file cold >30m",
      stalenessTone("file", 60 * 60_000) === "cold");
    t("stalenessTone tool warm 30m",
      stalenessTone("tool", 30 * 60_000) === "warm");

    // formatAge
    t("formatAge <1s", formatAge(500) === "<1s");
    t("formatAge seconds", formatAge(45_000) === "45s");
    t("formatAge minutes", formatAge(125_000) === "2m 5s");
    t("formatAge hours", formatAge(3_661_000) === "1h 1m");

    // buildContextBlocks — minimal session with a Read and an Edit
    const now = Date.parse("2026-07-06T12:00:00Z");
    const hooks = [
      // SessionStart
      {
        event_id: "ss1",
        event_time: "2026-07-06T10:00:00Z",
        event_name: "SessionStart",
        session_id: "s1",
        session_name: "demo",
        kind: "session_start",
        payload: { cwd: "/Users/me/proj", transcript_path: "/Users/me/.claude/sessions/s1.jsonl" },
        transcript_path: "/Users/me/.claude/sessions/s1.jsonl",
        cwd: "/Users/me/proj",
        permission_mode: "acceptEdits",
      },
      // UserPromptSubmit
      {
        event_id: "p1",
        event_time: "2026-07-06T10:00:05Z",
        event_name: "UserPromptSubmit",
        session_id: "s1",
        session_name: "demo",
        kind: "user_prompt",
        content: "implement the foo function",
        summary: "implement the foo function",
      },
      // Read on /Users/me/proj/main.go (1.5 hours ago, fresh)
      {
        event_id: "r1",
        event_time: "2026-07-06T10:30:00Z",
        event_name: "PreToolUse+PostToolUse",
        session_id: "s1",
        session_name: "demo",
        kind: "tool",
        tool_name: "Read",
        status: "ok",
        input: { file_path: "/Users/me/proj/main.go" },
        output: { numLines: 200 },
      },

      // Edit on /Users/me/proj/main.go (4 min ago — should be fresh)
      {
        event_id: "e1",
        event_time: "2026-07-06T11:56:00Z",
        event_name: "PreToolUse+PostToolUse",
        session_id: "s1",
        session_name: "demo",
        kind: "tool",
        tool_name: "Edit",
        status: "ok",
        input: { file_path: "/Users/me/proj/main.go" },
        output: {},
      },
      // Bash (10 min ago)
      {
        event_id: "b1",
        event_time: "2026-07-06T11:50:00Z",
        event_name: "PreToolUse+PostToolUse",
        session_id: "s1",
        session_name: "demo",
        kind: "tool",
        tool_name: "Bash",
        status: "ok",
        input: { command: "go test ./...", description: "run tests" },
        output: { exitCode: 0 },
      },
    ];
    const timeline = {
      session: {
        id: "s1",
        name: "demo",
        started_at: "2026-07-06T10:00:00Z",
        ended_at: "2026-07-06T11:55:00Z",
        duration_ms: 105 * 60_000,
        turn_count: 1,
        tool_count: 3,
        event_count: 5,
        failure_count: 0,
      },
      turns: [],
    };
    const { blocks, provider } = buildContextBlocks(timeline, hooks, { now });
    t("buildContextBlocks returns provider",
      provider === "claude",
      "got=" + provider);
    const byKind = Object.fromEntries(blocks.map((b) => [b.kind, b]));
    t("session block exists", !!byKind.session);
    t("session block lists provider", byKind.session && byKind.session.items.some((i) => i.title.includes("claude")));
    t("instructions block exists", !!byKind.instructions);
    t("instructions block lists permission mode", byKind.instructions && byKind.instructions.items.some((i) => i.title.includes("acceptEdits")));
    t("tools block has 3 unique tools", byKind.tools && byKind.tools.count === 3, "got=" + (byKind.tools && byKind.tools.count));
    t("files block last touched is the Edit", byKind.files && byKind.files.last_touched === "2026-07-06T11:56:00Z");
    t("files block staleness is fresh (4 min)", byKind.files && byKind.files.items[0].tone === "fresh", "tone=" + (byKind.files && byKind.files.items[0].tone));
    t("commands block has 1", byKind.commands && byKind.commands.count === 1);

    // Synthetic 1.5-hour-old file -> cold
    const coldHooks = [{
      event_id: "cold1",
      event_time: "2026-07-06T10:30:00Z",
      event_name: "PreToolUse+PostToolUse",
      session_id: "s2",
      session_name: "demo",
      kind: "tool",
      tool_name: "Read",
      status: "ok",
      input: { file_path: "/old/file.go" },
      output: {},
    }];
    const coldTimeline = { session: { id: "s2", name: "demo", event_count: 1 }, turns: [] };
    const { blocks: coldBlocks } = buildContextBlocks(coldTimeline, coldHooks, { now });
    const coldFiles = coldBlocks.find((b) => b.kind === "files");
    t("files staleness cold >30m",
      coldFiles && coldFiles.items[0].tone === "cold",
      "tone=" + (coldFiles && coldFiles.items[0].tone));

    return results;
  }

  // ---------- Export ------------------------------------------------------

  window.Traceframe = window.Traceframe || {};
  window.Traceframe.context = {
    inferProvider,
    stalenessTone,
    formatAge,
    formatFullTimestamp,
    buildContextBlocks,
    renderContextView,
    runTests,
  };
})();
