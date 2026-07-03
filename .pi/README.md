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
- **`transport: "sse"`** — forces SSE transport for LLM provider streaming
  (instead of `auto`, which may pick WebSocket). SSE is the most
  debuggable and behaves consistently across providers.
- **`httpIdleTimeoutMs: 600000`** — 10 minutes, double the 5-minute
  default. Generous enough for long agent runs with many tool calls and
  slow reasoning, while still surfacing genuinely stuck streams.

## What is NOT set here

- `defaultProvider` / `defaultModel` / `defaultThinkingLevel` — these are
  personal preferences and stay in `~/.pi/agent/settings.json`.
- API keys — those come from the environment or your global config.

## Trust

The first time you start `pi` in this directory, it will ask whether to
trust the project's `.pi/` config. Answer "yes" (or run `/trust` once
after startup). Without trust, the settings and extension are ignored.

## Verifying the wiring

After starting `pi`, you should see a notification: `Traceframe →
http://localhost:4000`. That confirms the extension loaded and the
endpoint is set. Then run a prompt — every tool call and message will
appear in the traceframe UI at <http://localhost:4000>.
