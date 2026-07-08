/**
 * Pure helpers for the Traceframe Pi extension.
 *
 * Anything that can be unit-tested in isolation lives here, with no
 * dependency on `fetch`, `process`, or the Pi extension API. The extension
 * entry point (`traceframe.ts`) imports these helpers and adds the
 * network/UI plumbing.
 */

export type UnknownRecord = Record<string, unknown>;

export interface AssistantMessage {
	role: string;
	content: unknown;
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

function asString(value: unknown): string | undefined {
	return isString(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
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
	return "Pi session";
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
