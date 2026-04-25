/**
 * Traceframe Extension — Pi
 *
 * Automatically traces every pi session to a Traceframe ingest endpoint.
 * Captures: tool calls (read/edit/write/bash), LLM turns, prompts, session lifecycle.
 *
 * Config: TRACEFRAME_ENDPOINT (default http://localhost:4000)
 *         TRACEFRAME_TRACE_ID  (auto-generated if unset)
 *         TRACEFRAME_BATCH_MS  (default 2000)
 *
 * Placement: .pi/extensions/traceframe.ts  (project-local)
 *            ~/.pi/agent/extensions/traceframe.ts  (global)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ──────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────

const ENDPOINT = process.env.TRACEFRAME_ENDPOINT ?? "http://localhost:4000";
const BATCH_MS = Number(process.env.TRACEFRAME_BATCH_MS) || 2000;
const MAX_BATCH = 25;

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────

let traceId = "";
let sessionId = "";
let batch: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let sessionStartSent = false;  // guard against missed session.start

// Track in-flight tool calls for pairing start/end
const toolTimings = new Map<string, { startMs: number; name: string }>();

// Per-agent-loop bookkeeping
let agentLoopId = 0;
const agentToolCalls = new Map<number, { name: string; startMs: number }[]>();

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

const ts = () => new Date().toISOString();
const ms = () => Date.now();

function makeTraceId(id: string): string {
  return `trc_${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "anon"}`;
}

function enqueue(event: Record<string, unknown>) {
  batch.push({
    traceId,
    timestamp: ts(),
    ...event,
  });

  if (batch.length >= MAX_BATCH) {
    flush(true);
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush(false);
  }, BATCH_MS);
}

async function flush(sync: boolean) {
  if (!batch.length) return;
  const events = batch;
  batch = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  try {
    const controller = new AbortController();
    const timeoutMs = sync ? 3000 : 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${ENDPOINT}/ingest/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.error(`[traceframe] flush failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[traceframe] flush error: ${err}`);
  }
}

function summarizeContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content.slice(0, 4000);
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => b && typeof b === "object" && b.type === "text")
      .map((b) => (b.text ?? "").slice(0, 4000))
      .join("\n")
      .slice(0, 4000);
  }
  return "";
}

function detailFromContent(content: unknown): { text?: string; toolCalls?: unknown[] } {
  if (!content || typeof content !== "object") return {};
  const detail: { text?: string; toolCalls?: unknown[] } = {};
  if (Array.isArray(content)) {
    const texts: string[] = [];
    const tools: unknown[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof (block as any).text === "string") {
        texts.push((block as any).text);
      } else if (block.type === "tool_use") {
        tools.push({ id: (block as any).id, name: (block as any).name, input: (block as any).input });
      }
    }
    detail.text = texts.join("\n").slice(0, 2000);
    detail.toolCalls = tools.length ? tools : undefined;
  } else if (typeof (content as any).text === "string") {
    detail.text = (content as any).text.slice(0, 2000);
  }
  return detail;
}

// ──────────────────────────────────────────────────────────
// Extension
// ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── session_start ──────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    sessionId = `pi-${event.reason ?? "startup"}-${Date.now().toString(36)}`;
    traceId = makeTraceId(sessionId);
    shuttingDown = false;
    sessionStartSent = false;
    batch = [];
    toolTimings.clear();
    agentLoopId = 0;
    agentToolCalls.clear();

    enqueue({
      type: "session.start",
      sessionId,
      cwd: ctx.cwd,
      reason: event.reason,
    });
    sessionStartSent = true;
    console.log(`[traceframe] session.start enqueued traceId=${traceId} reason=${event.reason ?? "startup"}`);
  });

  // ── agent_start (user prompt) ─────────────────────────
  // Defensive: if session.start was missed, emit it now.
  pi.on("agent_start", async (event, ctx) => {
    if (!sessionStartSent) {
      sessionId = `pi-startup-${Date.now().toString(36)}`;
      traceId = makeTraceId(sessionId);
      enqueue({ type: "session.start", sessionId, cwd: ctx.cwd, reason: "startup" });
      sessionStartSent = true;
      console.log("[traceframe] defensive session.start emitted");
    }

    agentLoopId++;
    agentToolCalls.set(agentLoopId, []);

    enqueue({
      type: "prompt.start",
      prompt: event.prompt?.slice(0, 2000) ?? "",
      images: event.images?.length ?? 0,
    });
  });

  // ── agent_end (assistant finished) ─────────────────────
  pi.on("agent_end", async (event, ctx) => {
    const calls = agentToolCalls.get(agentLoopId) ?? [];
    agentToolCalls.delete(agentLoopId);

    // Compute aggregate usage from last assistant message
    let usage: Record<string, number> = {};
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        const u = (entry.message as any).usage;
        if (u) {
          usage.input = u.input_tokens ?? 0;
          usage.output = u.output_tokens ?? 0;
          usage.cache_read = u.cache_read_input_tokens ?? 0;
          usage.cache_write = u.cache_creation_input_tokens ?? 0;
        }
      }
    }

    enqueue({
      type: "prompt.end",
      toolCalls: calls.length,
      tools: calls.map((c) => c.name),
      ...usage,
    });
  });

  // ── tool_call (before execution) ───────────────────────
  pi.on("tool_call", async (event, _ctx) => {
    const startMs = ms();
    toolTimings.set(event.toolCallId, { startMs, name: event.toolName });
    agentToolCalls.get(agentLoopId)?.push({ name: event.toolName, startMs });

    // Capture tool-specific metadata
    const meta: Record<string, unknown> = { toolName: event.toolName };

    if (event.toolName === "read" && event.input && typeof event.input === "object") {
      meta.path = (event.input as any).path;
    } else if (event.toolName === "edit" && event.input && typeof event.input === "object") {
      meta.path = (event.input as any).path;
    } else if (event.toolName === "write" && event.input && typeof event.input === "object") {
      meta.path = (event.input as any).path;
    } else if (event.toolName === "bash" && event.input && typeof event.input === "object") {
      meta.command = (event.input as any).command?.slice(0, 1000);
      meta.timeout = (event.input as any).timeout;
    }

    enqueue({
      type: "tool.call",
      toolCallId: event.toolCallId,
      ...meta,
    });
  });

  // ── tool_result (after execution) ─────────────────────
  pi.on("tool_result", async (event, _ctx) => {
    const timing = toolTimings.get(event.toolCallId);
    toolTimings.delete(event.toolCallId);

    const duration = timing ? ms() - timing.startMs : 0;
    const isError = event.isError ?? false;

    const meta: Record<string, unknown> = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      duration,
      isError,
    };

    // For read/edit/write, include file path
    if (event.input && typeof event.input === "object") {
      meta.path = (event.input as any).path;
    }

    // For bash, include command and exit code
    if (event.details && typeof event.details === "object") {
      const d = event.details as Record<string, unknown>;
      if (d.exitCode !== undefined) meta.exitCode = d.exitCode;
      if (d.command) meta.command = (d.command as string).slice(0, 1000);
    }

    // Include truncated output preview
    if (event.content) {
      const text = summarizeContent(event.content);
      if (text) meta.outputPreview = text.slice(0, 500);
    }

    enqueue({ type: "tool.result", ...meta });
  });

  // ── session_shutdown ───────────────────────────────────
  pi.on("session_shutdown", async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    enqueue({
      type: "session.end",
      sessionId,
    });

    // Synchronous flush before exit
    await flush(true);
    console.log(`[traceframe] shutdown flushed traceId=${traceId} eventsSent`);
  });
}
