/**
 * Unit tests for the pure helpers inlined into `traceframe.ts`.
 *
 * Run with: `bun test hooks/omp/traceframe.test.ts`
 *   or:    `node --test --import tsx/esm hooks/omp/traceframe.test.ts`
 * (the file is plain TypeScript with no test-time deps; pick whichever
 *  runtime is in your toolchain).
 *
 * The helpers live inside `traceframe.ts` so the documented single-file
 * install (`cp hooks/omp/traceframe.ts ~/.omp/agent/extensions/`) keeps
 * working. The helper tests import the named exports from the entry
 * module rather than re-implementing the logic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	isNonUserSource,
	isRecord,
	lastAssistantText,
	NON_USER_SOURCES,
	parseAgentEnd,
	parseInput,
	parseSessionStart,
	parseToolEvent,
	sessionIDFromFile,
	sessionNameFromCwd,
	type AssistantMessage,
} from "./traceframe";

describe("isRecord", () => {
	it("accepts plain objects", () => {
		assert.equal(isRecord({ a: 1 }), true);
		assert.equal(isRecord({}), true);
	});

	it("rejects primitives, null, and arrays", () => {
		assert.equal(isRecord(null), false);
		assert.equal(isRecord(undefined), false);
		assert.equal(isRecord("x"), false);
		assert.equal(isRecord(7), false);
		assert.equal(isRecord([]), false);
		assert.equal(isRecord([1, 2]), false);
	});
});

describe("sessionIDFromFile", () => {
	it("strips directory and extension from .jsonl files", () => {
		assert.equal(sessionIDFromFile("/u/m/.omp/agent/sessions/2026-07-03_abc.jsonl"), "2026-07-03_abc");
		assert.equal(sessionIDFromFile("/x/y/foo.json"), "foo");
	});

	it("returns the basename when there is no extension", () => {
		assert.equal(sessionIDFromFile("/x/y/plain"), "plain");
	});

	it("returns 'ephemeral' for missing sessions", () => {
		assert.equal(sessionIDFromFile(undefined), "ephemeral");
		assert.equal(sessionIDFromFile(""), "ephemeral");
	});
});

describe("sessionNameFromCwd", () => {
	it("returns the last path segment", () => {
		assert.equal(sessionNameFromCwd("/Users/me/code/traceframe"), "traceframe");
		assert.equal(sessionNameFromCwd("/x/y/z/voicebird-app"), "voicebird-app");
	});

	it("skips the trailing empty segment from a root path", () => {
		assert.equal(sessionNameFromCwd("/traceframe/"), "traceframe");
	});

	it("falls back to 'Omp session' when cwd is empty or missing", () => {
		assert.equal(sessionNameFromCwd(""), "Omp session");
		assert.equal(sessionNameFromCwd(undefined), "Omp session");
	});
});

describe("NON_USER_SOURCES", () => {
	it("covers every documented non-user source", () => {
		for (const key of ["extension", "slash", "command", "automation", "voice"]) {
			assert.equal(NON_USER_SOURCES[key], true, `missing ${key}`);
		}
	});
});

describe("isNonUserSource", () => {
	it("flags every documented non-user source", () => {
		assert.equal(isNonUserSource("extension"), true);
		assert.equal(isNonUserSource("slash"), true);
		assert.equal(isNonUserSource("command"), true);
		assert.equal(isNonUserSource("automation"), true);
		assert.equal(isNonUserSource("voice"), true);
	});

	it("lets 'user' and undefined through", () => {
		assert.equal(isNonUserSource("user"), false);
		assert.equal(isNonUserSource(undefined), false);
	});
});

describe("parseSessionStart", () => {
	it("returns undefined for non-objects", () => {
		assert.equal(parseSessionStart(null), undefined);
		assert.equal(parseSessionStart("hi"), undefined);
		assert.equal(parseSessionStart([]), undefined);
	});

	it("extracts the reason field when it is a string", () => {
		assert.deepEqual(parseSessionStart({ reason: "startup" }), { reason: "startup" });
	});

	it("drops non-string reason values", () => {
		assert.deepEqual(parseSessionStart({ reason: 7 }), { reason: undefined });
		assert.deepEqual(parseSessionStart({}), { reason: undefined });
	});
});

describe("parseInput", () => {
	it("returns undefined for empty, missing, or non-string text", () => {
		assert.equal(parseInput({ text: "" }), undefined);
		assert.equal(parseInput({ text: "   " }), undefined);
		assert.equal(parseInput({ text: 123 }), undefined);
		assert.equal(parseInput({}), undefined);
		assert.equal(parseInput(null), undefined);
	});

	it("trims and returns the text plus the source", () => {
		assert.deepEqual(
			parseInput({ text: "  hello  ", source: "user" }),
			{ text: "  hello  ", source: "user" }, // parser preserves; caller's source filter does the dropping
		);
	});

	it("returns the text and undefined source when source is missing or non-string", () => {
		assert.deepEqual(parseInput({ text: "hi" }), { text: "hi", source: undefined });
		assert.deepEqual(parseInput({ text: "hi", source: 5 }), { text: "hi", source: undefined });
	});
});

describe("parseToolEvent", () => {
	it("returns undefined for non-objects", () => {
		assert.equal(parseToolEvent(null), undefined);
		assert.equal(parseToolEvent("x"), undefined);
	});

	it("captures every known field verbatim (still unknown; tool handlers narrow with asString/asBoolean)", () => {
		const e = parseToolEvent({ toolCallId: "abc", toolName: "Read", args: { path: "/x" } });
		assert.equal(e?.toolCallId, "abc");
		assert.equal(e?.toolName, "Read");
		assert.deepEqual(e?.args, { path: "/x" });
	});
});

describe("parseAgentEnd", () => {
	it("returns undefined for non-objects", () => {
		assert.equal(parseAgentEnd(null), undefined);
		assert.equal(parseAgentEnd(42), undefined);
	});

	it("returns an empty messages array when messages is missing", () => {
		assert.deepEqual(parseAgentEnd({}), { messages: [] });
	});

	it("filters out messages with non-string role", () => {
		const parsed = parseAgentEnd({ messages: [{ role: 7 }, { role: "assistant", content: "hi" }] });
		assert.deepEqual(parsed?.messages, [{ role: "assistant", content: "hi" }]);
	});

	it("keeps messages that are not objects out of the result", () => {
		const parsed = parseAgentEnd({ messages: ["junk", 42, null, { role: "user", content: "yo" }] });
		assert.deepEqual(parsed?.messages, [{ role: "user", content: "yo" }]);
	});
});

describe("lastAssistantText", () => {
	const asst = (content: unknown): AssistantMessage => ({ role: "assistant", content });
	const user = (content: unknown): AssistantMessage => ({ role: "user", content });

	it("returns '' for empty or missing message lists", () => {
		assert.equal(lastAssistantText(undefined), "");
		assert.equal(lastAssistantText([]), "");
	});

	it("returns '' when no assistant message exists", () => {
		assert.equal(lastAssistantText([user("hi"), user("there")]), "");
	});

	it("returns plain-string content verbatim", () => {
		assert.equal(lastAssistantText([asst("Direct reply.")]), "Direct reply.");
	});

	it("joins multiple text blocks with a newline", () => {
		const content = [
			{ type: "text", text: "first" },
			{ type: "text", text: "second" },
		];
		assert.equal(lastAssistantText([asst(content)]), "first\nsecond");
	});

	it("skips empty text blocks", () => {
		const content = [
			{ type: "text", text: "" },
			{ type: "text", text: "kept" },
		];
		assert.equal(lastAssistantText([asst(content)]), "kept");
	});

	it("summarises a tool_use-only turn (was the reviewer-reported empty-string bug)", () => {
		const content = [
			{ type: "tool_use", name: "Read", input: { path: "/x" } },
			{ type: "tool_use", name: "Bash", input: { cmd: "ls" } },
		];
		assert.equal(lastAssistantText([asst(content)]), "[called 2 tools]");
	});

	it("uses singular grammar for a single tool call", () => {
		const content = [{ type: "tool_use", name: "Read", input: { path: "/x" } }];
		assert.equal(lastAssistantText([asst(content)]), "[called 1 tool]");
	});

	it("summarises a thinking-only turn", () => {
		const content = [
			{ type: "thinking", text: "hmm" },
			{ type: "thinking", text: "still thinking" },
		];
		assert.equal(lastAssistantText([asst(content)]), "[2 thinking blocks]");
	});

	it("summarises a mixed tool_use + thinking turn", () => {
		const content = [
			{ type: "thinking", text: "plan" },
			{ type: "tool_use", name: "Bash", input: {} },
		];
		assert.equal(lastAssistantText([asst(content)]), "[called 1 tool, 1 thinking block]");
	});

	it("prefers the LAST assistant message when several exist", () => {
		const messages = [
			asst("first"),
			asst("second"),
			user("interrupt"),
			asst("third"),
		];
		assert.equal(lastAssistantText(messages), "third");
	});

	it("skips non-object and non-string-array content", () => {
		assert.equal(lastAssistantText([asst(42)]), "");
		assert.equal(lastAssistantText([asst(null)]), "");
		assert.equal(lastAssistantText([asst("just a string")]), "just a string");
	});
});
