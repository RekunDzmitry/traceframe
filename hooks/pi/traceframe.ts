/**
 * Traceframe Hooks Extension for Pi
 *
 * Forwards Pi agent lifecycle events to a Traceframe hook viewer
 * (https://github.com/...) so they show up in the same UI as Claude Code
 * and Codex events.
 *
 * Mapping (Pi event -> Traceframe `hook_event_name`):
 *   session_start        -> SessionStart
 *   input                -> UserPromptSubmit
 *   tool_execution_start -> PreToolUse
 *   tool_execution_end   -> PostToolUse
 *   agent_end            -> Stop  (with last_assistant_message)
 *   session_shutdown     -> SessionEnd
 *
 * Installation:
 *   Global:   cp traceframe.ts ~/.pi/agent/extensions/
 *   Project:  cp traceframe.ts .pi/extensions/
 *
 * Configuration (env vars, all optional):
 *   TRACEFRAME_ENDPOINT  - default http://localhost:4000
 *   TRACEFRAME_DISABLED  - set to "1" to no-op the extension
 *   TRACEFRAME_DEBUG     - set to "1" to log failed posts to stderr
 *
 * The extension never blocks Pi. Every POST is fire-and-forget; a missing or
 * slow Traceframe server cannot stall or crash the agent.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENDPOINT = (process.env.TRACEFRAME_ENDPOINT || "http://localhost:4000").replace(/\/+$/, "");
const HOOK_URL = `${ENDPOINT}/api/hooks`;
const DISABLED = process.env.TRACEFRAME_DISABLED === "1";
const DEBUG = process.env.TRACEFRAME_DEBUG === "1";

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
	const base = file.split("/").pop() ?? file;
	return base.replace(/\.[^.]+$/, "");
}

function sessionName(ctx: ExtensionContext): string {
	const cwd = ctx.cwd ?? "";
	if (cwd) {
		// Last path segment, e.g. "/Users/me/code/traceframe" -> "traceframe".
		const segments = cwd.split("/").filter(Boolean);
		const last = segments[segments.length - 1];
		if (last) return last;
	}
	return "Pi session";
}

function transcriptPath(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile() ?? undefined;
}

// --- Network ---------------------------------------------------------------

/**
 * Post a hook payload to Traceframe. Resolves with the response status (or
 * -1 on network error) and never throws. Callers do not await this — it's
 * invoked fire-and-forget from the event handlers.
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
		source: "pi",
		...extras,
		event,
	};
}

function fire(ctx: ExtensionContext, hookEventName: string, event: unknown, extras: Record<string, unknown> = {}): void {
	const payload = envelope(ctx, hookEventName, event as Record<string, unknown>, extras);
	// Intentionally unawaited. We want Pi to keep moving even if Traceframe
	// is slow or down.
	void postHook(payload);
}

// --- Event-specific shaping ------------------------------------------------

/** Flatten the content blocks of the last assistant message into a single
 *  string Traceframe can render as the assistant reply in Stop events. */
function lastAssistantText(messages: Array<{ role: string; content: unknown }> | undefined): string {
	if (!messages || messages.length === 0) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const parts: string[] = [];
		const content = msg.content;
		if (typeof content === "string") {
			parts.push(content);
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
					const text = (block as { text?: unknown }).text;
					if (typeof text === "string") parts.push(text);
				}
			}
		}
		return parts.join("\n");
	}
	return "";
}

// --- Extension entry point -------------------------------------------------

export default function (pi: ExtensionAPI) {
	// SessionStart: fires once per session lifetime (startup, /new, /resume,
	// /fork, /clone). The session_id is re-resolved per-event so /fork and
	// /clone get their own bucket automatically.
	pi.on("session_start", async (event, ctx) => {
		fire(
			ctx,
			"SessionStart",
			event as unknown as Record<string, unknown>,
			{ reason: (event as { reason?: string }).reason },
		);
	});

	// UserPromptSubmit: capture raw user input that flows through to the
	// agent. We log and let it pass (returning undefined is the documented
	// "continue" behavior). Skip messages injected by other extensions to
	// avoid logging automated sub-agent prompts as if the user typed them.
	pi.on("input", async (event, ctx) => {
		const e = event as { text?: string; source?: string };
		if (e.source === "extension") return; // sent by another extension
		if (typeof e.text !== "string" || e.text.trim() === "") return;
		fire(ctx, "UserPromptSubmit", { text: e.text, source: e.source });
	});

	// PreToolUse / PostToolUse: tool_execution_start runs before the tool,
	// tool_execution_end runs after. We forward both with the same
	// tool_use_id so Traceframe can pair them into a single timeline row.
	pi.on("tool_execution_start", async (event, ctx) => {
		const e = event as { toolCallId?: string; toolName?: string; args?: unknown };
		fire(
			ctx,
			"PreToolUse",
			{ toolName: e.toolName, args: e.args },
			{ tool_use_id: e.toolCallId, tool_name: e.toolName, tool_input: e.args },
		);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const e = event as {
			toolCallId?: string;
			toolName?: string;
			args?: unknown;
			result?: unknown;
			isError?: boolean;
		};
		fire(
			ctx,
			"PostToolUse",
			{ toolName: e.toolName, args: e.args, result: e.result, isError: e.isError },
			{
				tool_use_id: e.toolCallId,
				tool_name: e.toolName,
				tool_input: e.args,
				tool_response: e.result,
			},
		);
	});

	// Stop: the agent has finished a turn. We forward the final assistant
	// text so the UI can show it the same way it shows Claude's
	// last_assistant_message on Stop events.
	pi.on("agent_end", async (event, ctx) => {
		const e = event as { messages?: Array<{ role: string; content: unknown }> };
		fire(ctx, "Stop", { messageCount: e.messages?.length ?? 0 }, {
			last_assistant_message: lastAssistantText(e.messages),
		});
	});

	// SessionEnd: when the session runtime is torn down (exit, /new,
	// /resume to a different session).
	pi.on("session_shutdown", async (event, ctx) => {
		fire(ctx, "SessionEnd", event as unknown as Record<string, unknown>);
	});

	// Surface the resolved endpoint once on startup so the user can see
	// where the events are going. Cheap; no UI side effects beyond a toast.
	pi.on("session_start", async (_event, ctx) => {
		if (DISABLED) return;
		ctx.ui.notify(`Traceframe → ${HOOK_URL}`, "info");
	});
}
