# Omp Traceframe Extension

`traceframe.ts` is an [Omp](https://github.com/oh-my-pi/pi-coding-agent) extension
that forwards Omp's lifecycle events to a Traceframe hook viewer, so Omp
sessions appear in the same UI as Claude Code, Codex, and Pi sessions.

The package it targets is `@oh-my-pi/pi-coding-agent`. The companion
extension for the upstream `pi-coding-agent` lives in
[`../pi/`](../pi/) and uses `@earendil-works/pi-coding-agent` instead.

## Install

Global — captures every Omp session for the current user:

```bash
cp hooks/omp/traceframe.ts ~/.omp/agent/extensions/
```

Project-local — captures sessions in this repo only (after `/trust`):

```bash
mkdir -p .omp/extensions
cp hooks/omp/traceframe.ts .omp/extensions/
```

The endpoint defaults to `http://localhost:4000`. Override before starting
Omp:

```bash
TRACEFRAME_ENDPOINT=http://traceframe.internal:4000 omp
```

Optional environment variables:

| Variable               | Effect                                          |
|------------------------|-------------------------------------------------|
| `TRACEFRAME_ENDPOINT`  | Base URL (default `http://localhost:4000`)      |
| `TRACEFRAME_DISABLED`  | `1` to no-op the extension                      |
| `TRACEFRAME_DEBUG`     | `1` to log failed posts to stderr               |

## Event mapping

| Omp event               | Traceframe `hook_event_name` | Notes |
|-------------------------|------------------------------|-------|
| `session_start`         | `SessionStart`               | Startup, `/new`, `/resume`, `/fork`, `/clone`. |
| `input`                 | `UserPromptSubmit`           | Skips messages injected by other extensions.   |
| `tool_execution_start`  | `PreToolUse`                 | Includes `tool_name` and `tool_input`.         |
| `tool_execution_end`    | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`             | `Stop`                       | Includes `last_assistant_message`.             |
| `session_shutdown`      | `SessionEnd`                 |                                                 |

`source` is set to `"omp"` so the UI can distinguish Omp events from Pi
events, which use `"pi"`.

## Session grouping

`session_id` is the basename of Omp's session file
(e.g. `2026-07-03_abc` from
`/Users/me/.omp/agent/sessions/2026-07-03_abc.jsonl`), stable across
resumes and distinct across forks. `session_name` is the basename of the
working directory so the UI shows a useful label.

## Safety

The extension never blocks Omp. Every POST is fire-and-forget; a missing
or slow Traceframe server cannot stall the agent, and a network error is
silently swallowed (or logged when `TRACEFRAME_DEBUG=1`).

## How it differs from the Pi extension

The mapping is the same, but the package import is different
(`@oh-my-pi/pi-coding-agent` vs `@earendil-works/pi-coding-agent`). Both
extension files live in this repo for completeness — pick the one that
matches the agent you're running.
