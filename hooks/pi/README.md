# Pi Agent Hooks for Traceframe

`traceframe.ts` is a [Pi extension](https://github.com/earendil-works/pi-coding-agent)
that forwards Pi's lifecycle events to a Traceframe hook viewer, so Pi
sessions appear in the same UI as Claude Code and Codex.

## Install

### Global (all your Pi sessions)

```bash
cp traceframe.ts ~/.pi/agent/extensions/
```

Restart Pi (or run `/reload`) and the extension is loaded.

### Project-local (only this repo)

```bash
mkdir -p .pi/extensions
cp traceframe.ts .pi/extensions/
```

The project must be trusted before Pi loads the extension — `/trust` once
and you're set.

## Configure

The endpoint is `http://localhost:4000` by default. Override with an
environment variable before starting Pi:

```bash
TRACEFRAME_ENDPOINT=http://traceframe.internal:4000 pi
```

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
| `input`                  | `UserPromptSubmit`           | Skips messages injected by other extensions. |
| `tool_execution_start`   | `PreToolUse`                 | Includes `tool_name` and `tool_input`. |
| `tool_execution_end`     | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`              | `Stop`                       | Includes `last_assistant_message`. |
| `session_shutdown`       | `SessionEnd`                 |                                                              |

## Session grouping

`session_id` is the basename of the session file (e.g. `2026-07-03_abc` from
`/Users/me/.pi/agent/sessions/2026-07-03_abc.jsonl`). This matches the
granularity the UI expects: one bucket per real session, stable across
resumes, distinct across forks and clones.

`session_name` is the basename of the working directory so the UI shows a
useful label ("traceframe", "voicebird-app", etc.).

## Why a fetch wrapper

Every POST is fire-and-forget — Pi never waits on the network. A missing or
slow Traceframe server cannot stall the agent, and a network error is
swallowed silently (or printed to stderr with `TRACEFRAME_DEBUG=1`).
