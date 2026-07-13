/**
 * Traceframe Hooks Extension for Omp
 *
 * Forwards Omp agent lifecycle events to a Traceframe hook viewer
 * (https://github.com/RekunDzmitry/traceframe) so they show up in the same
 * UI as Claude Code and Pi sessions.
 *
 * Mapping (Omp event -> Traceframe `hook_event_name`):
 *   session_start        -> SessionStart
 *   input                -> UserPromptSubmit
 *   tool_execution_start -> PreToolUse
 *   tool_execution_end   -> PostToolUse
 *   agent_end            -> Stop  (with last_assistant_message,
 *                                         model, provider, usage)
 *   session_shutdown     -> SessionEnd
 *
 * Self-contained install:
 *   The file is intentionally a SINGLE source file. The documented install
 *   copies only this `.ts` into `~/.omp/agent/extensions/` or
 *   `.omp/extensions/`, so we deliberately do NOT import any sibling file
 *   (no package.json ships next to it; the loader would fail to resolve a
 *   `./traceframe-helpers` import). All helpers live below and are also
 *   exported as named exports so the helper unit tests can import them
 *   without re-implementing the logic.
 *
 * Install (project-local — preferred):
 *   Drop a `.omp/settings.json` at the repo root that points at the
 *   extension:
 *
 *     {
 *       "extensions": ["../hooks/omp/traceframe.ts"]
 *     }
 *
 *   Trust the project once (`/trust`) and the extension loads on every
 *   `omp` invocation here.
 *
 * Install (global — all your Omp sessions):
 *   cp hooks/omp/traceframe.ts ~/.omp/agent/extensions/
 *
 * Configuration (env vars, all optional):
 *   TRACEFRAME_ENDPOINT  - default http://localhost:4000 (use https:// for any
 *                          non-localhost host; tool args and env values travel
 *                          through the request body in cleartext over http)
 *   TRACEFRAME_DISABLED  - set to "1" to no-op the extension
 *   TRACEFRAME_DEBUG     - set to "1" to log failed posts to stderr
 *
 * The extension never blocks Omp. Every POST is fire-and-forget with a 2s
 * timeout; a missing or slow Traceframe server cannot stall or crash the
 * agent.
 *
 * `transcript_path` is sent verbatim — it points at the per-session JSONL
 * file under `~/.omp/agent/sessions/`, which is fine for single-user local
 * use. Sharing a remote Traceframe deployment multiplies the blast radius.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

// --- Config ----------------------------------------------------------------

const ENDPOINT = (process.env.TRACEFRAME_ENDPOINT || "http://localhost:4000").replace(/\/+$/, "");
const HOOK_URL = `${ENDPOINT}/api/hooks`;
const DISABLED = process.env.TRACEFRAME_DISABLED === "1";
const DEBUG = process.env.TRACEFRAME_DEBUG === "1";

// --- Pure helpers (also re-exported at the bottom for tests) --------------

export type UnknownRecord = Record<string, unknown>;

export interface AssistantMessage {
	role: string;
	content: unknown;
	// Pi-normalized model / provider / usage. Optional because older Pi
	// versions and non-Pi providers omit them. The hook extracts them off
	// the last assistant message so the UI's Context Usage Map knows the
	// real model id and per-turn cache stats instead of falling back to
	// "unknown model" + 200K (the Anthropic Sonnet default).
	model?: unknown;
	provider?: unknown;
	api?: unknown;
	usage?: unknown;
}

export interface SessionStartEvent {
	reason?: string;
}

export interface ToolEvent {
	toolCallId?: unknown;
	toolName?: unknown;
	args?: unknown;
	result?: unknown;
	isError?: unknown;
}

// --- Type guards -----------------------------------------------------------

export function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

export function asString(value: unknown): string | undefined {
	return isString(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	return isBoolean(value) ? value : undefined;
}

function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] | undefined {
	return Array.isArray(value) ? value.filter(guard) : undefined;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
	return isRecord(value) && typeof value.role === "string";
}

// --- Boundary parsers ------------------------------------------------------

export function parseSessionStart(event: unknown): SessionStartEvent | undefined {
	if (!isRecord(event)) return undefined;
	return { reason: asString(event.reason) };
}

/**
 * Returns the trimmed text and source if the input event is well-formed and
 * non-empty. Returns undefined for missing text, empty text, or any non-object
 * payload — the caller drops the event in that case.
 */
export function parseInput(event: unknown): { text: string; source: string | undefined } | undefined {
	if (!isRecord(event)) return undefined;
	const text = asString(event.text);
	if (text === undefined || text.trim() === "") return undefined;
	const source = asString(event.source);
	return { text, source };
}

export function parseToolEvent(event: unknown): ToolEvent | undefined {
	if (!isRecord(event)) return undefined;
	return {
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		args: event.args,
		result: event.result,
		isError: event.isError,
	};
}

/**
 * Returns the assistant message list if the payload is an object. Always
 * returns an array (possibly empty) so the caller never needs to special-case
 * missing `messages`.
 */
export function parseAgentEnd(event: unknown): { messages: AssistantMessage[] } | undefined {
	if (!isRecord(event)) return undefined;
	const messages = asArray(event.messages, isAssistantMessage);
	return { messages: messages ?? [] };
}

// --- Session state helpers -------------------------------------------------

/**
 * Stable session id derived from the live session file. Tracks forks, /resume,
 * and /clone because the session manager rebinds the file for each.
 */
export function sessionIDFromFile(file: string | undefined): string {
	if (!file) return "ephemeral";
	// Basename without extension: ".../2026-07-03_abc.jsonl" -> "2026-07-03_abc".
	// Matches the granularity the UI expects (one per real session, not per
	// resume of the same session).
	const base = file.split("/").pop() ?? file;
	return base.replace(/\.[^.]+$/, "");
}

/**
 * Human label derived from the working directory's last segment.
 */
export function sessionNameFromCwd(cwd: string | undefined): string {
	if (cwd) {
		const segments = cwd.split("/").filter(Boolean);
		const last = segments[segments.length - 1];
		if (last) return last;
	}
	return "Omp session";
}

/**
 * Sources that did NOT originate from a real user keystroke. The input
 * handler skips events tagged with any of these so the timeline only shows
 * what the user actually said to the agent.
 */
export const NON_USER_SOURCES: Record<string, true> = {
	extension: true,
	slash: true,
	command: true,
	automation: true,
	voice: true,
};

export function isNonUserSource(source: string | undefined): boolean {
	return source !== undefined && NON_USER_SOURCES[source] === true;
}

// --- Event-specific shaping ------------------------------------------------

/**
 * Flatten the content blocks of the last assistant message into a single
 * string Traceframe can render as the assistant reply in Stop events.
 *
 * - Plain string content is returned verbatim.
 * - Array content is reduced to a single string: text blocks are concatenated;
 *   tool_use / thinking blocks are summarised so a tool-only assistant turn
 *   does not produce an empty `last_assistant_message`.
 * - Any other shape (null, number, etc.) yields "".
 */
export function lastAssistantText(messages: AssistantMessage[] | undefined): string {
	if (!messages || messages.length === 0) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (isString(content)) return content;
		if (!Array.isArray(content)) return "";
		const parts: string[] = [];
		let toolUseCount = 0;
		let thinkingCount = 0;
		for (const block of content) {
			if (!isRecord(block)) continue;
			const type = block.type;
			if (type === "text") {
				const text = block.text;
				if (isString(text) && text.length > 0) parts.push(text);
			} else if (type === "tool_use") {
				toolUseCount += 1;
			} else if (type === "thinking") {
				thinkingCount += 1;
			}
		}
		if (parts.length > 0) return parts.join("\n");
		if (toolUseCount > 0 && thinkingCount > 0) {
			return `[called ${toolUseCount} tool${toolUseCount === 1 ? "" : "s"}, ${thinkingCount} thinking block${thinkingCount === 1 ? "" : "s"}]`;
		}
		if (toolUseCount > 0) {
			return `[called ${toolUseCount} tool${toolUseCount === 1 ? "" : "s"}]`;
		}
		if (thinkingCount > 0) {
			return `[${thinkingCount} thinking block${thinkingCount === 1 ? "" : "s"}]`;
		}
		return "";
	}
	return "";
}

/**
 * Pull the model id, provider, and usage block off the last assistant
 * message. Returns undefined when no assistant message exists or when
 * neither model nor usage is set.
 *
 * Pi's AgentMessage always has a `usage` block on the final assistant
 * turn; on earlier (or aborted) turns the block may be present with all
 * zeros. The hook passes the whole `usage` through to the traceframe
 * server as `last_assistant_usage`, and the Go / JS extractors on the
 * consumer side know how to interpret both the Pi-normalized form
 * ({ input, output, cacheRead, cacheWrite, totalTokens, cost }) and the
 * raw provider form (Anthropic / OpenAI-Compatible / MiniMax).
 */
export function lastAssistantMeta(
	messages: AssistantMessage[] | undefined,
): { model?: string; provider?: string; usage?: unknown } | undefined {
	if (!messages || messages.length === 0) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const model = asString(msg.model);
		const provider = asString(msg.provider);
		const usage = isRecord(msg.usage) ? msg.usage : undefined;
		if (!model && !provider && !usage) return undefined;
		const out: { model?: string; provider?: string; usage?: unknown } = {};
		if (model) out.model = model;
		if (provider) out.provider = provider;
		if (usage) out.usage = usage;
		return out;
	}
	return undefined;
}

// --- Context-bound session helpers ----------------------------------------

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
 * key in the Omp event payload.
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
		source: "omp",
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
	// Intentionally unawaited. We want Omp to keep moving even if Traceframe
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
	// if Omp's `ExtensionAPI.on` is last-write-wins, a second `session_start`
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
		if (isNonUserSource(parsed.source)) return;
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
