/**
 * Traceframe Hooks Extension for Omp
 *
 * Forwards Omp agent lifecycle events to a Traceframe hook viewer
 * (https://github.com/...) so they show up in the same UI as Claude Code
 * and Pi sessions.
 *
 * Mapping (Omp event -> Traceframe `hook_event_name`):
 *   session_start        -> SessionStart
 *   input                -> UserPromptSubmit
 *   tool_execution_start -> PreToolUse
 *   tool_execution_end   -> PostToolUse
 *   agent_end            -> Stop  (with last_assistant_message)
 *   session_shutdown     -> SessionEnd
 *
 * Installation:
 *   Global:   cp traceframe.ts ~/.omp/agent/extensions/
 *   Project:  mkdir -p .omp/extensions && cp traceframe.ts .omp/extensions/
 *
 * Configuration (env vars, all optional):
 *   TRACEFRAME_ENDPOINT  - default http://localhost:4000
 *   TRACEFRAME_DISABLED  - set to "1" to no-op the extension
 *   TRACEFRAME_DEBUG     - set to "1" to log failed posts to stderr
 *
 * The extension never blocks Omp. Every POST is fire-and-forget; a missing
 * or slow Traceframe server cannot stall or crash the agent.
 *
 * The file is intentionally dependency-free — no third-party imports —
 * so the documented `cp`-based install works without a sibling
 * package.json or extra install step. Event payloads are read with
 * runtime type guards at the handler boundary.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

// --- Config ----------------------------------------------------------------

const ENDPOINT = (process.env.TRACEFRAME_ENDPOINT || "http://localhost:4000").replace(/\/+$/, "");
const HOOK_URL = `${ENDPOINT}/api/hooks`;
const DISABLED = process.env.TRACEFRAME_DISABLED === "1";
const DEBUG = process.env.TRACEFRAME_DEBUG === "1";

// --- Event narrowers -------------------------------------------------------
//
// Omp events are `unknown` at the API boundary; we only read a handful of
// fields from each. The guards below narrow each handler's `event` to just
// the fields that handler reads, keeping the read surface small and the
// behavior identical to a typed schema. Every guard accepts `undefined`
// gracefully — Omp can grow new optional fields without breaking us.

function asObject(v: unknown): Record<string, unknown> | undefined {
	return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function readString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
	if (!obj) return undefined;
	const value = obj[key];
	return typeof value === "string" ? value : undefined;
}

function readBoolean(obj: Record<string, unknown> | undefined, key: string): boolean | undefined {
	if (!obj) return undefined;
	const value = obj[key];
	return typeof value === "boolean" ? value : undefined;
}


function readMessages(obj: Record<string, unknown> | undefined) {
	if (!obj) return undefined;
	const value = obj["messages"];
	if (!Array.isArray(value)) return undefined;
	const out: Array<{ role: string; content: unknown }> = [];
	for (const item of value) {
		const o = asObject(item);
		if (!o) continue;
		const role = readString(o, "role");
		const content = o["content"];
		if (role === undefined || content === undefined) continue;
		out.push({ role, content });
	}
	return out;
}

// --- Session state ---------------------------------------------------------

/**
 * Resolved at every event from the live session manager so the value tracks
 * session forks, /resume, and /clone correctly (each of those rebinds the
 * session file).
 */
function sessionID(ctx: ExtensionContext): string {
	const file = ctx.sessionManager.getSessionFile();
	if (!file) return "ephemeral";
	// Basename without extension: ".../2026-07-03_abc.jsonl" -> "2026-07-03_abc".
	// Matches the granularity the UI expects (one per real session, not per
	// resume of the same session).
	const segments = file.split("/").filter(Boolean);
	const last = segments[segments.length - 1];
	if (!last) return "ephemeral";
	return last.replace(/\.[^.]+$/, "");
}

function sessionName(ctx: ExtensionContext): string {
	const cwd = ctx.cwd ?? "";
	if (cwd) {
		// Last path segment, e.g. "/Users/me/code/traceframe" -> "traceframe".
		const segments = cwd.split("/").filter(Boolean);
		const last = segments[segments.length - 1];
		if (last) return last;
	}
	return "Omp session";
}

function transcriptPath(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile() ?? undefined;
}

// --- Network ---------------------------------------------------------------

/**
 * Post a hook payload to Traceframe. Never throws. Callers do not await
 * this — it's invoked fire-and-forget from the event handlers.
 */
async function postHook(payload: Record<string, unknown>): Promise<void> {
	if (DISABLED) return;
	try {
		const res = await fetch(HOOK_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok && DEBUG) {
			process.stderr.write(
				`[traceframe] ${payload.hook_event_name} -> HTTP ${res.status}: ${await res.text().catch(() => "")}\n`,
			);
		}
	} catch (err) {
		if (DEBUG) {
			process.stderr.write(`[traceframe] post failed: ${(err as Error).message}\n`);
		}
	}
}

/**
 * Build the common envelope every event shares: session context, the
 * original event payload, and the hook_event_name + tool_use_id fields
 * Traceframe looks at to pair Pre/Post tool calls and group sessions.
 */
function envelope(
	ctx: ExtensionContext,
	hookEventName: string,
	event: Record<string, unknown>,
	extras: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		hook_event_name: hookEventName,
		session_id: sessionID(ctx),
		session_name: sessionName(ctx),
		cwd: ctx.cwd,
		transcript_path: transcriptPath(ctx),
		source: "omp",
		...extras,
		event,
	};
}

function fire(
	ctx: ExtensionContext,
	hookEventName: string,
	event: Record<string, unknown>,
	extras: Record<string, unknown> = {},
): void {
	const payload = envelope(ctx, hookEventName, event, extras);
	// Intentionally unawaited. We want Omp to keep moving even if Traceframe
	// is slow or down.
	void postHook(payload);
}

/** Strip an unknown value's surface so it can be used as a top-level event
 *  property without leaking non-serializable junk to Traceframe. */
function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// --- Event-specific shaping ------------------------------------------------

/** Flatten the content blocks of the last assistant message into a single
 *  string Traceframe can render as the assistant reply in Stop events. */
function lastAssistantText(
	messages: Array<{ role: string; content: unknown }> | undefined,
): string {
	if (!messages || messages.length === 0) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const raw of content) {
				const block = asObject(raw);
				if (!block) continue;
				if (block["type"] === "text") {
					const text = block["text"];
					if (typeof text === "string") parts.push(text);
				}
			}
			return parts.join("\n");
		}
		return "";
	}
	return "";
}

// --- Extension entry point -------------------------------------------------

export default function (pi: ExtensionAPI) {
	// SessionStart: fires once per session lifetime (startup, /new, /resume,
	// /fork, /clone). The session_id is re-resolved per-event so /fork and
	// /clone get their own bucket automatically.
	pi.on("session_start", async (event, ctx) => {
		const obj = asObject(event);
		const reason = readString(obj, "reason");
		fire(ctx, "SessionStart", asRecord(event), { reason });
	});

	// UserPromptSubmit: capture raw user input that flows through to the
	// agent. We log and let it pass (returning undefined is the documented
	// "continue" behavior). Skip messages injected by other extensions to
	// avoid logging automated sub-agent prompts as if the user typed them.
	pi.on("input", async (event, ctx) => {
		const obj = asObject(event);
		const source = readString(obj, "source");
		if (source === "extension") return; // sent by another extension
		const text = readString(obj, "text");
		if (text === undefined || text.trim() === "") return;
		fire(ctx, "UserPromptSubmit", { text, source });
	});

	// PreToolUse / PostToolUse: tool_execution_start runs before the tool,
	// tool_execution_end runs after. We forward both with the same
	// tool_use_id so Traceframe can pair them into a single timeline row.
	pi.on("tool_execution_start", async (event, ctx) => {
		const obj = asObject(event);
		const toolCallId = readString(obj, "toolCallId");
		const toolName = readString(obj, "toolName");
		const args = obj ? obj["args"] : undefined;
		fire(
			ctx,
			"PreToolUse",
			{ toolName, args },
			{ tool_use_id: toolCallId, tool_name: toolName, tool_input: args },
		);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const obj = asObject(event);
		const toolCallId = readString(obj, "toolCallId");
		const toolName = readString(obj, "toolName");
		const args = obj ? obj["args"] : undefined;
		const result = obj ? obj["result"] : undefined;
		const isError = readBoolean(obj, "isError");
		fire(
			ctx,
			"PostToolUse",
			{ toolName, args, result, isError },
			{
				tool_use_id: toolCallId,
				tool_name: toolName,
				tool_input: args,
				tool_response: result,
			},
		);
	});

	// Stop: the agent has finished a turn. We forward the final assistant
	// text so the UI can show it the same way it shows Claude's
	// last_assistant_message on Stop events.
	pi.on("agent_end", async (event, ctx) => {
		const obj = asObject(event);
		const messages = readMessages(obj);
		fire(ctx, "Stop", { messageCount: messages?.length ?? 0 }, {
			last_assistant_message: lastAssistantText(messages),
		});
	});

	// SessionEnd: when the session runtime is torn down (exit, /new,
	// /resume to a different session).
	pi.on("session_shutdown", async (event, ctx) => {
		const obj = asObject(event);
		const reason = readString(obj, "reason");
		fire(ctx, "SessionEnd", asRecord(event), { reason });
	});

	// Surface the resolved endpoint once on startup so the user can see
	// where the events are going. Cheap; no UI side effects beyond a toast.
	pi.on("session_start", async (_event, ctx) => {
		if (DISABLED) return;
		ctx.ui.notify(`Traceframe → ${HOOK_URL}`, "info");
	});
}
