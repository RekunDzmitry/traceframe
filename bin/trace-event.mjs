#!/usr/bin/env node
// traceframe/trace-event — Emit a single event to the ingest endpoint.
// Usage: node trace-event.mjs <type> <label> [detail-json]
//   e.g. node trace-event.mjs bash "ls -la" '{"cwd":"/tmp"}'
//
// Requires TRACEFRAME_API_KEY, TRACEFRAME_ENDPOINT, TRACEFRAME_TRACE_ID in env.

const ENDPOINT = process.env.TRACEFRAME_ENDPOINT;
const API_KEY = process.env.TRACEFRAME_API_KEY;
const TRACE_ID = process.env.TRACEFRAME_TRACE_ID;

if (!ENDPOINT || !API_KEY || !TRACE_ID) {
  console.error("Missing TRACEFRAME_API_KEY, TRACEFRAME_ENDPOINT, or TRACEFRAME_TRACE_ID");
  process.exit(1);
}

const [,, type, label, detailJson] = process.argv;
if (!type) {
  console.error("Usage: node trace-event.mjs <type> <label> [detail-json]");
  process.exit(1);
}

let detail = {};
if (detailJson) {
  try { detail = JSON.parse(detailJson); } catch { detail = { raw: detailJson }; }
}

const event = {
  traceId: TRACE_ID,
  type,
  timestamp: new Date().toISOString(),
  label,
  ...detail,
};

const res = await fetch(ENDPOINT + '/ingest/events', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer ' + API_KEY
  },
  body: JSON.stringify({ events: [event] })
});

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
console.log(`OK: ${type} → ${label} (${body.accepted} events accepted)`);
