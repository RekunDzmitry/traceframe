# Pi Agent Hooks for Traceframe

`traceframe.ts` is a [Pi extension](https://github.com/earendil-works/pi-coding-agent)
that forwards Pi's lifecycle events to a Traceframe hook viewer, so Pi
sessions appear in the same UI as Claude Code and Codex.

## Install

<<<<<<< HEAD
### Global (all your Pi sessions)

```bash
cp traceframe.ts ~/.pi/agent/extensions/
=======
This repo ships a project-local Pi config at `../.pi/settings.json` that
points at `../hooks/pi/traceframe.ts`. The extension loads automatically
when you run `pi` from the repo root — trust the project once (`/trust`)
and you're set.

To install for all your Pi sessions (any directory), copy the file to
your global extensions folder:

```bash
cp hooks/pi/traceframe.ts ~/.pi/agent/extensions/
>>>>>>> origin/main
```

Restart Pi (or run `/reload`) and the extension is loaded.

<<<<<<< HEAD
### Project-local (only this repo)

```bash
mkdir -p .pi/extensions
cp traceframe.ts .pi/extensions/
```

The project must be trusted before Pi loads the extension — `/trust` once
and you're set.
=======
> Single source of truth: keep the canonical copy in `hooks/pi/`; both
> the project-local config and the global install reference the same
> file. Do not edit one without updating the other.
>>>>>>> origin/main

## Configure

The endpoint is `http://localhost:4000` by default. Override with an
environment variable before starting Pi:

```bash
TRACEFRAME_ENDPOINT=http://traceframe.internal:4000 pi
```

<<<<<<< HEAD
=======
> **Warning:** tool arguments, working-directory paths, and echoed
> environment values travel in the POST body in cleartext. Use
> `https://` for any host that is not `localhost` or `127.0.0.1`, and
> never point at a Traceframe deployment you do not trust.

>>>>>>> origin/main
Other environment variables:

| Variable               | Effect                                                         |
|------------------------|----------------------------------------------------------------|
| `TRACEFRAME_ENDPOINT`  | Base URL (default `http://localhost:4000`)                     |
| `TRACEFRAME_DISABLED`  | Set to `1` to disable all posts (useful for debugging Pi)      |
| `TRACEFRAME_DEBUG`     | Set to `1` to log non-2xx responses and network errors to stderr |

## Event mapping

| Pi event                 | Traceframe `hook_event_name` | Notes |
|--------------------------|------------------------------|-------|
| `session_start`          | `SessionStart`               | Fires for startup, `/new`, `/resume`, `/fork`, `/clone`. |
<<<<<<< HEAD
| `input`                  | `UserPromptSubmit`           | Skips messages injected by other extensions. |
| `tool_execution_start`   | `PreToolUse`                 | Includes `tool_name` and `tool_input`. |
| `tool_execution_end`     | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`              | `Stop`                       | Includes `last_assistant_message`. |
=======
| `input`                  | `UserPromptSubmit`           | Skips messages injected by other extensions, slash commands, automation, and voice input. |
| `tool_execution_start`   | `PreToolUse`                 | Includes `tool_name` and `tool_input`. |
| `tool_execution_end`     | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`              | `Stop`                       | Includes `last_assistant_message`. Tool-only and thinking-only turns render a brief summary instead of an empty string. |
>>>>>>> origin/main
| `session_shutdown`       | `SessionEnd`                 |                                                              |

## Session grouping

`session_id` is the basename of the session file (e.g. `2026-07-03_abc` from
`/Users/me/.pi/agent/sessions/2026-07-03_abc.jsonl`). This matches the
granularity the UI expects: one bucket per real session, stable across
resumes, distinct across forks and clones.

`session_name` is the basename of the working directory so the UI shows a
useful label ("traceframe", "voicebird-app", etc.).

<<<<<<< HEAD
## Why a fetch wrapper

Every POST is fire-and-forget — Pi never waits on the network. A missing or
slow Traceframe server cannot stall the agent, and a network error is
swallowed silently (or printed to stderr with `TRACEFRAME_DEBUG=1`).
=======
`transcript_path` is the absolute path to the session JSONL. Traceframe
reads this file to derive context-window snapshots for tool rows. The path
is forwarded verbatim — for single-user local use that is fine; sharing a
remote Traceframe deployment multiplies the blast radius.

## Why a fetch wrapper

Every POST is fire-and-forget with a 2s `AbortSignal` timeout — Pi never
waits on the network. A missing or slow Traceframe server cannot stall
the agent, and a network error is swallowed silently (or printed to
stderr with `TRACEFRAME_DEBUG=1`). The timeout caps the worst-case
socket lifetime so a stuck server cannot leak undici sockets for the
full 5-minute undici default.

## Testing

Pure helpers (boundary parsers, session-name resolution, content-block
flattening) are unit-tested with `bun test`:

```bash
bun test hooks/pi/traceframe-helpers.test.ts
```

The test file imports only `traceframe-helpers.ts` (no `fetch`, no Pi
extension API), so the suite runs without installing
`@earendil-works/pi-coding-agent`.
>>>>>>> origin/main
