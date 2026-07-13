/**
 * Traceframe Hooks Extension for Pi
 *
 * Forwards Pi agent lifecycle events to a Traceframe hook viewer
 * (https://github.com/RekunDzmitry/traceframe) so they show up in the same
 * UI as Claude Code and Codex events.
 *
 * Mapping (Pi event -> Traceframe `hook_event_name`):
 *   session_start        -> SessionStart
 *   input                -> UserPromptSubmit
 *   tool_execution_start -> PreToolUse
 *   tool_execution_end   -> PostToolUse
 *   agent_end            -> Stop  (with last_assistant_message,
 *                                         model, provider, usage)
 *   session_shutdown     -> SessionEnd
 *
 * Install (project-local — preferred):
 *   This repo ships a project-local config in `.pi/settings.json` that points
 *   at `../hooks/pi/traceframe.ts`. Trust the project once with `/trust` and
 *   the extension loads on every `pi` invocation here.
 *
 * Install (global — all your Pi sessions):
 *   cp hooks/pi/traceframe.ts ~/.pi/agent/extensions/
 *
 * Configuration (env vars, all optional):
 *   TRACEFRAME_ENDPOINT  - default http://localhost:4000 (use https:// for any
 *                          non-localhost host; tool args and env values travel
 *                          through the request body in cleartext over http)
 *   TRACEFRAME_DISABLED  - set to "1" to no-op the extension
 *   TRACEFRAME_DEBUG     - set to "1" to log failed posts to stderr
 *
 * The extension never blocks Pi. Every POST is fire-and-forget with a 2s
 * timeout; a missing or slow Traceframe server cannot stall or crash the
 * agent.
 *
 * `transcript_path` is sent verbatim — it points at the per-session JSONL
 * file under `~/.pi/agent/sessions/`, which is fine for single-user local
 * use. Sharing a remote Traceframe deployment multiplies the blast radius.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	isRecord,
	lastAssistantMeta,
	lastAssistantText,
	parseAgentEnd,
	parseInput,
	parseSessionStart,
	parseToolEvent,
	sessionIDFromFile,
	sessionNameFromCwd,
	type UnknownRecord,
} from "./traceframe-helpers";

const ENDPOINT = (process.env.TRACEFRAME_ENDPOINT || "http://localhost:4000").replace(/\/+$/, "");
const HOOK_URL = `${ENDPOINT}/api/hooks`;
const DISABLED = process.env.TRACEFRAME_DISABLED === "1";
const DEBUG = process.env.TRACEFRAME_DEBUG === "1";
// Sources that did NOT originate from a real user keystroke. We skip these
// so the timeline only shows what the user actually said to the agent.
const NON_USER_SOURCES: Record<string, true> = {
	extension: true,
	slash: true,
	command: true,
	automation: true,
	voice: true,
};

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function sessionID(ctx: ExtensionContext): string {
	return sessionIDFromFile(ctx.sessionManager.getSessionFile());
}

function sessionName(ctx: ExtensionContext): string {
	return sessionNameFromCwd(ctx.cwd);
}

function transcriptPath(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile() ?? undefined;
}

// --- Network ---------------------------------------------------------------

/**
 * Post a hook payload to Traceframe. Resolves with the response status (or
 * -1 on network error) and never throws. Callers do not await this — it's
 * invoked fire-and-forget from the event handlers.
 *
 * The 2s AbortSignal timeout caps the worst-case socket lifetime so a stuck
 * Traceframe server cannot leak undici sockets for the full 300s undici
 * default while the agent keeps generating events.
 */
async function postHook(payload: Record<string, unknown>): Promise<void> {
	if (DISABLED) return;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 2000);
	try {
		const res = await fetch(HOOK_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		if (!res.ok && DEBUG) {
			// Bound the body read so a 100MB error response cannot block the
			// agent while we drain the socket. 4 KiB is plenty for debugging.
			const body = await res.text().catch(() => "");
			process.stderr.write(
				`[traceframe] ${payload.hook_event_name} -> HTTP ${res.status}: ${body.slice(0, 4096)}\n`,
			);
		}
	} catch (err) {
		if (DEBUG) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[traceframe] post failed: ${message}\n`);
		}
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Build the common envelope every event shares: session context, the
 * original event payload, and the hook_event_name + tool_use_id fields
 * Traceframe looks at to pair Pre/Post tool calls and group sessions.
 *
 * The spread order is `{ event, extras }` (extras wins) so any reserved
 * field set by the extension cannot be silently overridden by a colliding
 * key in the Pi event payload.
 */
function envelope(
	ctx: ExtensionContext,
	hookEventName: string,
	event: UnknownRecord,
	extras: UnknownRecord = {},
): Record<string, unknown> {
	return {
		hook_event_name: hookEventName,
		session_id: sessionID(ctx),
		session_name: sessionName(ctx),
		cwd: ctx.cwd,
		transcript_path: transcriptPath(ctx),
		source: "pi",
		event,
		...extras,
	};
}

function fire(ctx: ExtensionContext, hookEventName: string, event: unknown, extras: UnknownRecord = {}): void {
	if (!isRecord(event)) {
		if (DEBUG) {
			process.stderr.write(`[traceframe] dropping ${hookEventName}: payload is not an object\n`);
		}
		return;
	}
	const payload = envelope(ctx, hookEventName, event, extras);
	// Intentionally unawaited. We want Pi to keep moving even if Traceframe
	// is slow or down.
	void postHook(payload);
}

// --- Extension entry point -------------------------------------------------

export default function (pi: ExtensionAPI) {
	// SessionStart: fires once per session lifetime (startup, /new, /resume,
	// /fork, /clone). The session_id is re-resolved per-event so /fork and
	// /clone get their own bucket automatically.
	//
	// Surface the resolved endpoint once on startup so the user can see
	// where the events are going. Both behaviors live in the SAME handler:
	// if Pi's `ExtensionAPI.on` is last-write-wins, a second `session_start`
	// registration would silently replace the first and Stop events would
	// never reach Traceframe.
	pi.on("session_start", async (event, ctx) => {
		const parsed = parseSessionStart(event);
		if (parsed) {
			fire(ctx, "SessionStart", event as UnknownRecord, { reason: parsed.reason });
		}
		if (!DISABLED) {
			ctx.ui.notify(`Traceframe → ${HOOK_URL}`, "info");
		}
	});

	// UserPromptSubmit: capture raw user input that flows through to the
	// agent. We log and let it pass (returning undefined is the documented
	// "continue" behavior). Skip messages injected by other extensions,
	// slash commands, automation, and voice input so the timeline only
	// shows what the user actually typed.
	pi.on("input", async (event, ctx) => {
		const parsed = parseInput(event);
		if (!parsed) return;
		if (parsed.source !== undefined && NON_USER_SOURCES[parsed.source]) return;
		fire(ctx, "UserPromptSubmit", { text: parsed.text, source: parsed.source });
	});

	// PreToolUse / PostToolUse: tool_execution_start runs before the tool,
	// tool_execution_end runs after. We forward both with the same
	// tool_use_id so Traceframe can pair them into a single timeline row.
	pi.on("tool_execution_start", async (event, ctx) => {
		const e = parseToolEvent(event);
		if (!e) return;
		fire(
			ctx,
			"PreToolUse",
			{ toolName: e.toolName, args: e.args },
			{
				tool_use_id: asString(e.toolCallId),
				tool_name: asString(e.toolName),
				tool_input: e.args,
			},
		);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const e = parseToolEvent(event);
		if (!e) return;
		fire(
			ctx,
			"PostToolUse",
			{ toolName: e.toolName, args: e.args, result: e.result, isError: asBoolean(e.isError) },
			{
				tool_use_id: asString(e.toolCallId),
				tool_name: asString(e.toolName),
				tool_input: e.args,
				tool_response: e.result,
			},
		);
	});

	// Stop: the agent has finished a turn. We forward the final assistant
	// text, the model id, the provider, and the usage block so the UI can
	// show it the same way it shows Claude's last_assistant_message on
	// Stop events AND know the right context window + per-turn cache
	// stats. Without model + usage the Context Usage Map falls back to
	// "unknown model" and 200K (the Anthropic Sonnet default) — wrong
	// for MiniMax (1M) and most other non-Claude providers.
	pi.on("agent_end", async (event, ctx) => {
		const e = parseAgentEnd(event);
		if (!e) return;
		const meta = lastAssistantMeta(e.messages);
		const extras: UnknownRecord = {
			last_assistant_message: lastAssistantText(e.messages),
		};
		if (meta?.model) extras.model = meta.model;
		if (meta?.provider) extras.provider = meta.provider;
		if (meta?.usage) extras.last_assistant_usage = meta.usage;
		fire(ctx, "Stop", { messageCount: e.messages.length }, extras);
	});

	// SessionEnd: when the session runtime is torn down (exit, /new,
	// /resume to a different session).
	pi.on("session_shutdown", async (event, ctx) => {
		fire(ctx, "SessionEnd", event);
	});
}
