// traceframe session tracer — send events to the local ingest service.
//
// Usage:
//   import { trace, initTraceSession } from "./bin/trace.mjs";
//   initTraceSession("my-session-id");
//   trace("tool_call", { tool: "read", file: "index.js" });
//

const ENDPOINT = process.env.TRACEFRAME_ENDPOINT || "http://localhost:4000";
const API_KEY = process.env.TRACEFRAME_API_KEY;

let currentTraceId = null;

const eventTypes = {
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  FILE_READ: "file_read",
  FILE_WRITE: "file_write",
  FILE_EDIT: "file_edit",
  BASH: "bash",
  BASH_RESULT: "bash_result",
  DECISION: "decision",
  SESSION_START: "session_start",
  SESSION_END: "session_end",
};

const initTraceSession = (sessionId) => {
  currentTraceId = `trc_${sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
  return currentTraceId;
};

const trace = async (type, payload = {}) => {
  if (!API_KEY) {
    console.error("[trace] TRACEFRAME_API_KEY not set — skipping");
    return;
  }
  if (!currentTraceId) {
    console.error("[trace] No trace session — call initTraceSession() first");
    return;
  }

  const event = {
    traceId: currentTraceId,
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  try {
    const res = await fetch(`${ENDPOINT}/ingest/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ events: [event] }),
    });
    if (!res.ok) {
      console.error(`[trace] ingest failed: ${res.status}`);
    }
  } catch (e) {
    console.error(`[trace] error: ${e.message}`);
  }
};

export { trace, initTraceSession, eventTypes, currentTraceId };
