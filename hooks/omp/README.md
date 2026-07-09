# Omp Hooks for Traceframe

`traceframe.ts` is an [Omp](https://github.com/oh-my-pi/pi-coding-agent) extension
that forwards Omp's lifecycle events to a Traceframe hook viewer, so Omp
sessions appear in the same UI as Claude Code and Pi sessions.

`source` is set to `"omp"` so the UI can distinguish Omp events from
Pi's `source: "pi"`.

## Install

Pick one of two layouts. Both reference the same file —
`hooks/omp/traceframe.ts` is the single source of truth; do not edit one
copy without updating the other.

### Project-local (preferred in this repo)

Drop a `.omp/settings.json` at the repo root that points at the
extension:

```json
{
  "extensions": ["../hooks/omp/traceframe.ts"]
}
```

Trust the project once (`/trust`) and the extension loads on every
`omp` invocation here. (This repo doesn't ship that file yet — add it
if you want the auto-load, or use the global layout below.)

### Global — every Omp session for the current user

```bash
cp hooks/omp/traceframe.ts ~/.omp/agent/extensions/
```

Restart Omp (or run `/reload`) and the extension is loaded.

## Configure

The endpoint is `http://localhost:4000` by default. Override with an
environment variable before starting Omp:

```bash
TRACEFRAME_ENDPOINT=http://traceframe.internal:4000 omp
```

> **Warning:** tool arguments, working-directory paths, and echoed
> environment values travel in the POST body in cleartext. Use
> `https://` for any host that is not `localhost` or `127.0.0.1`, and
> never point at a Traceframe deployment you do not trust.

Other environment variables:

| Variable               | Effect                                                         |
|------------------------|----------------------------------------------------------------|
| `TRACEFRAME_ENDPOINT`  | Base URL (default `http://localhost:4000`)                     |
| `TRACEFRAME_DISABLED`  | Set to `1` to disable all posts (useful for debugging Omp)     |
| `TRACEFRAME_DEBUG`     | Set to `1` to log non-2xx responses and network errors to stderr|

## Event mapping

| Omp event               | Traceframe `hook_event_name` | Notes |
|-------------------------|------------------------------|-------|
| `session_start`         | `SessionStart`               | Fires for startup, `/new`, `/resume`, `/fork`, `/clone`. |
| `input`                 | `UserPromptSubmit`           | Skips messages injected by other extensions, slash commands, automation, and voice input. |
| `tool_execution_start`  | `PreToolUse`                 | Includes `tool_name` and `tool_input`. |
| `tool_execution_end`    | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`             | `Stop`                       | Includes `last_assistant_message`. Tool-only and thinking-only turns render a brief summary instead of an empty string. |
| `session_shutdown`      | `SessionEnd`                 |                                                              |

## Session grouping

`session_id` is the basename of the session file (e.g. `2026-07-03_abc`
from `/Users/me/.omp/agent/sessions/2026-07-03_abc.jsonl`). This
matches the granularity the UI expects: one bucket per real session,
stable across resumes, distinct across forks and clones.

`session_name` is the basename of the working directory so the UI shows
a useful label ("traceframe", "voicebird-app", etc.).

`transcript_path` is the absolute path to the session JSONL. The path
is forwarded verbatim — for single-user local use that is fine;
sharing a remote Traceframe deployment multiplies the blast radius.

## Why a fetch wrapper

Every POST is fire-and-forget with a 2s `AbortSignal` timeout — Omp
never waits on the network. A missing or slow Traceframe server cannot
stall the agent, and a network error is swallowed silently (or printed
to stderr with `TRACEFRAME_DEBUG=1`). The timeout caps the worst-case
socket lifetime so a stuck server cannot leak undici sockets for the
full 5-minute undici default.

## Testing

Pure helpers (boundary parsers, session-name resolution, content-block
flattening) are inlined into `traceframe.ts` and unit-tested with
`bun test`:

```bash
bun test hooks/omp/traceframe.test.ts
```

The test file imports only the named helper exports from
`traceframe.ts`. It uses `node:test` + `node:assert/strict`; pick
whichever runtime is in your toolchain (`bun test`, or
`node --test --import tsx/esm`).

> The helpers are deliberately inlined into `traceframe.ts` (and the
> file ships as a single self-contained source) so the documented
> `cp` install (`cp hooks/omp/traceframe.ts ~/.omp/agent/extensions/`)
> keeps working without a sibling `package.json` or a second copied
> file. The companion Pi extension still ships helpers in a separate
> file — see the next section.

## How it differs from the Pi extension

`hooks/pi/traceframe.ts` covers the upstream
`@earendil-works/pi-coding-agent`. Same event mapping, same payload
shape, `source: "pi"` instead of `"omp"`, `sessionName` falls back to
`"Pi session"` instead of `"Omp session"`, and the Pi side keeps its
helpers in a sibling `traceframe-helpers.ts` file. The Omp side
inlines the helpers because Omp's documented install paths copy a
single `.ts`; the Pi side can split because Pi resolves the
extensions tree relative to the loaded file. Test coverage shapes
differ accordingly — both folders ship a `*.test.ts` that exercises
the same boundary parsers.
