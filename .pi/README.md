# `.pi/` — project-local Pi configuration

This directory configures Pi (the coding agent) for the traceframe repo. The
settings are loaded only when you run `pi` from this directory, so they
override your global `~/.pi/agent/settings.json` without affecting other
projects.

## What's in here

### `settings.json`

- **`extensions: ["../hooks/pi/traceframe.ts"]`** — auto-loads the
  traceframe hook extension when you start `pi` here. Single source of
  truth: the extension lives in `hooks/pi/`, the project config points at
  it. No copy, no symlink.
  - Pi resolves this path **relative to the settings file's directory**
    (not the current working directory), so `../hooks/pi/traceframe.ts`
    is the same path whether you launch `pi` from the repo root or any
    subdirectory. Don't change the prefix.

## What is NOT set here

We intentionally do not pin `transport` or `httpIdleTimeoutMs` so the
project-local config respects whatever your global `~/.pi/agent/settings.json`
already chose. The two reasons you might want to override per-project:

- `transport: "sse"` — forces SSE for LLM streaming (overrides the default
  `auto`). Use this if a provider picks the wrong transport for traceframe.
- `httpIdleTimeoutMs: 600000` — 10 min, double the 5 min default, to keep
  long agent runs from being cut off on slow reasoning pauses.

Add either or both to this file if you need them; otherwise leave them out
so they inherit from your global config.

`defaultProvider` / `defaultModel` / `defaultThinkingLevel` are personal
preferences and stay in `~/.pi/agent/settings.json`. API keys come from the
environment or your global config.

## Trust

The first time you start `pi` in this directory, it will ask whether to
trust the project's `.pi/` config. Answer "yes" (or run `/trust` once
after startup). Without trust, the settings and extension are ignored.

## Verifying the wiring

After starting `pi`, you should see a notification: `Traceframe →
http://localhost:4000`. That confirms the extension loaded and the
endpoint is set. Then run a prompt — every tool call and message will
appear in the traceframe UI at <http://localhost:4000>.
