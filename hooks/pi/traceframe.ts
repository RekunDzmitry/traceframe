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
 *   agent_end            -> Stop  (with last_assistant_message + usage)
 *   session_shutdown     -> SessionEnd
 *
 * On SessionStart we forward the system prompt text and the available tool
 * definitions so the UI can show them as "what the agent was started with"
 * blocks. On Stop we forward the last assistant message's `usage` (cache
 * creation / read tokens, input / output tokens) so the UI can show a
 * token-grid breakdown with real cache TTL.
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

/**
 * Pi's `event` arg is typed as a discriminated union by the ExtensionAPI
 * generic — but the *individual* handler blocks need to read fields off
 * `e`, and the union members don't declare those fields. We name them
 * with local interfaces (one per handler) so the property reads are
 * type-checked without an unchecked cast.
 */
interface SessionStartEvent {
	reason?: string;
}
interface InputEvent {
	text?: string;
	source?: string;
}
interface ToolStartEvent {
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
}
interface ToolEndEvent extends ToolStartEvent {
	result?: unknown;
	isError?: boolean;
}
interface AgentEndEvent {
	messages?: ReadonlyArray<unknown>;
}

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

/** Coerce Pi's ExtensionContext into the shape we need, safely.
 *  The context object is a class with public methods, not a plain
 *  record; reading optional fields through guards keeps the call sites
 *  honest about what's actually present in a given Pi version. */
type SystemToolsAccessor = () => Array<{ name?: unknown; description?: unknown }> | undefined;

interface SystemPromptReader {
	systemPrompt?: unknown;
	getSystemTools?: SystemToolsAccessor;
}

function readSystemPrompt(ctx: ExtensionContext): string | undefined {
	const probe = ctx as unknown as SystemPromptReader;
	const v = probe.systemPrompt;
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readSystemTools(ctx: ExtensionContext): Array<{ name: string; description?: string }> {
	const probe = ctx as unknown as SystemPromptReader;
	const v = typeof probe.getSystemTools === "function" ? probe.getSystemTools() : undefined;
	if (!Array.isArray(v)) return [];
	interface RawToolDef { name?: unknown; description?: unknown }
	const out: Array<{ name: string; description?: string }> = [];
	for (const t of v) {
		if (!t || typeof t !== "object") continue;
		const raw = t as RawToolDef;
		const name = raw.name;
		if (typeof name !== "string" || name.length === 0) continue;
		const desc = raw.description;
		out.push({
			name,
			description: typeof desc === "string" ? desc : undefined,
		});
	}
	return out;
}

/** Flatten the content blocks of the last assistant message into a single
 *  string Traceframe can render as the assistant reply in Stop events. */
function lastAssistantText(messages: ReadonlyArray<unknown> | undefined): string {
	if (!messages || messages.length === 0) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || typeof msg !== "object" || !("role" in msg)) continue;
		if ((msg as Record<string, unknown>).role !== "assistant") continue;
		const parts: string[] = [];
		const content = (msg as Record<string, unknown>).content;
		if (typeof content === "string") {
			parts.push(content);
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (!block || typeof block !== "object") continue;
				if (!("type" in block)) continue;
				if ((block as Record<string, unknown>).type !== "text") continue;
				if (!("text" in block)) continue;
				const text = (block as Record<string, unknown>).text;
				if (typeof text === "string") parts.push(text);
			}
		}
		return parts.join("\n");
	}
	return "";
}

/** Pull the Anthropic-style `usage` block off the last assistant message,
 *  if Pi attached one. Returns undefined when the field is missing or has
 *  an unrecognized shape — we never invent cache stats we don't have. */
function lastAssistantUsage(messages: ReadonlyArray<unknown> | undefined): Record<string, unknown> | undefined {
	if (!messages || messages.length === 0) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || typeof msg !== "object" || !("role" in msg)) continue;
		if ((msg as Record<string, unknown>).role !== "assistant") continue;
		const usage = (msg as Record<string, unknown>).usage;
		if (usage && typeof usage === "object") {
			return usage as Record<string, unknown>;
		}
		return undefined;
	}
	return undefined;
}

// --- Extension entry point -------------------------------------------------

export default function (pi: ExtensionAPI) {
	// SessionStart: fires once per session lifetime (startup, /new, /resume,
	// /fork, /clone). The session_id is re-resolved per-event so /fork and
	// /clone get their own bucket automatically.
	pi.on("session_start", async (event, ctx) => {
		const e = event as SessionStartEvent;
		fire(ctx, "SessionStart", event as unknown as Record<string, unknown>, {
			reason: e.reason,
			system_prompt: readSystemPrompt(ctx),
			system_tools: readSystemTools(ctx),
		});
	});

	// UserPromptSubmit: capture raw user input that flows through to the
	// agent. We log and let it pass (returning undefined is the documented
	// "continue" behavior). Skip messages injected by other extensions to
	// avoid logging automated sub-agent prompts as if the user typed them.
	pi.on("input", async (event, ctx) => {
		const e = event as InputEvent;
		if (e.source === "extension") return; // sent by another extension
		if (typeof e.text !== "string" || e.text.trim() === "") return;
		fire(ctx, "UserPromptSubmit", { text: e.text, source: e.source });
	});

	// PreToolUse / PostToolUse: tool_execution_start runs before the tool,
	// tool_execution_end runs after. We forward both with the same
	// tool_use_id so Traceframe can pair them into a single timeline row.
	pi.on("tool_execution_start", async (event, ctx) => {
		const e = event as ToolStartEvent;
		fire(
			ctx,
			"PreToolUse",
			{ toolName: e.toolName, args: e.args },
			{ tool_use_id: e.toolCallId, tool_name: e.toolName, tool_input: e.args },
		);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const e = event as ToolEndEvent;
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
	// text plus its `usage` block (if Pi attached one) so the UI can show
	// both the reply and the cache stats that produced it.
	pi.on("agent_end", async (event, ctx) => {
		const e = event as AgentEndEvent;
		fire(ctx, "Stop", { messageCount: e.messages?.length ?? 0 }, {
			last_assistant_message: lastAssistantText(e.messages),
			usage: lastAssistantUsage(e.messages),
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
