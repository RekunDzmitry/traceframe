# Traceframe

Traceframe is a minimal hook viewer for coding agents. Hooks are posted to a Go API, stored in a single ClickHouse table with the full JSON payload, and shown in a small UI grouped by session.

## Run

```bash
docker compose up --build
```

Open:

```text
http://localhost:4000
```

The app listens on port `4000`. ClickHouse is exposed on port `8123`.

## API

```bash
curl -X POST http://localhost:4000/api/hooks \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"UserPromptSubmit","session_id":"demo-session","session_name":"Demo session"}'

# Lightweight summary list (Pre/Post tool events are merged).
curl 'http://localhost:4000/api/hooks?limit=300'

# Full per-session timeline grouped into turns (prompt → tools → assistant).
curl http://localhost:4000/api/sessions/demo-session/timeline

# Raw payload for a single event (used by the drawer's "View raw").
curl http://localhost:4000/api/hooks/<event_id>

# Delete a session and all of its rows.
curl -X DELETE http://localhost:4000/api/sessions/demo-session

curl http://localhost:4000/healthz
```

The UI displays hook events grouped by session with three levels of detail:

1. **Compact row** — one-line summary, tool name, status, and duration.
2. **Expanded details** — tool input/output, Edit diff, Read line range, Bash
   command + stdout/stderr, markdown-rendered prompts and assistant replies,
   permission mode and effort chips.
3. **Raw JSON drawer** — full original payload, searchable, copy-to-clipboard.

Tool rows show a context-window bar sourced from each hook's
`transcript_path`. For Codex the `token_count` snapshots are read directly;
for Claude, usage is read from the assistant messages that issued the tool
call. Docker Compose mounts both `~/.codex/sessions` and
`~/.claude/projects` read-only for this purpose. Set
`TRACEFRAME_TRANSCRIPT_ROOT` or `TRACEFRAME_CLAUDE_TRANSCRIPT_ROOT` when the
transcripts live elsewhere. Claude usage defaults to a 200,000-token window;
Opus 4.8 sessions are derived as 1,000,000 tokens from the transcript model.
Override the fallback for other models with `TRACEFRAME_CLAUDE_CONTEXT_WINDOW`
when needed.

Pre/Post tool events are paired on the server by `tool_use_id`, collapsing the
raw event stream into a single timeline entry per tool call. Sessions are
shown in chronological order (oldest first) and the "All sessions" view keeps
the newest-first ordering for at-a-glance scanning.

The API stores the complete hook payload unchanged in ClickHouse and assigns
each row a stable `event_id` (UUID) used to look up the raw payload. Legacy
rows without an `event_id` get a deterministic fallback identifier derived
from their natural key.

Traceframe uses these fields when present:

- `hook_event_name`: hook lifecycle name, such as `SessionStart` or `UserPromptSubmit`.
- `session_id`: stable session identifier.
- `session_name`: optional human-friendly label.
- `transcript_path` or `cwd`: fallback fields used to identify or label a session when explicit session fields are missing.
- `tool_use_id`, `tool_name`, `tool_input`, `tool_response`: tool event details.
- `last_assistant_message`: rendered as the assistant reply in `Stop` events.
- `permission_mode`, `effort`: surfaced as secondary chips.

## ClickHouse

The ClickHouse table is created automatically:

```sql
CREATE TABLE IF NOT EXISTS claude_hooks (
  event_time DateTime64(3) DEFAULT now64(3),
  event_id String DEFAULT generateUUIDv4(),
  event_name String,
  session_id String,
  session_name String,
  payload String
) ENGINE = MergeTree
ORDER BY (event_time, session_id, event_name);
```

Existing deployments are migrated with:

```sql
ALTER TABLE claude_hooks
ADD COLUMN IF NOT EXISTS event_id String DEFAULT generateUUIDv4();

ALTER TABLE claude_hooks
ADD COLUMN IF NOT EXISTS session_name String AFTER session_id;
```

The `event_id` column is a stable identifier for each row, used by the
`/api/hooks/{event_id}` endpoint. New rows get a fresh UUID; legacy rows are
backfilled once on startup with `SETTINGS mutations_sync = 1`. The backfill is
skipped on subsequent startups once the table is fully populated.

`payload` stores the complete hook JSON body unchanged.

## Claude Code Hooks

Claude Code HTTP hooks use `type: "http"` and send the hook JSON as the POST body with `Content-Type: application/json`. Claude payloads include fields such as `hook_event_name`, `session_id`, `transcript_path`, and `cwd`, which Traceframe uses for the session view.

Create or update `.claude/settings.local.json` in your Claude Code project:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks"
          }
        ]
      }
    ]
  }
}
```

Restart Claude Code or use `/hooks` to verify the hooks were loaded.

Reference: https://code.claude.com/docs/en/hooks

## Codex Hooks

Codex hooks are command hooks. Codex sends the hook payload to the command on stdin, so use a small Rust forwarder to add the event name and post that JSON to Traceframe. The forwarder also adds `cwd` when Codex did not include it, so the UI still has a useful session label.

```bash
mkdir -p ~/.codex/hooks/traceframe-forward/src

cat > ~/.codex/hooks/traceframe-forward/Cargo.toml <<'EOF'
[package]
name = "traceframe-forward"
version = "0.1.0"
edition = "2021"

[dependencies]
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
serde_json = "1"
EOF

cat > ~/.codex/hooks/traceframe-forward/src/main.rs <<'EOF'
use serde_json::{json, Value};
use std::{env, io::{self, Read}};

fn main() {
    if let Err(err) = run() {
        eprintln!("traceframe-forward: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let event_name = env::args()
        .nth(1)
        .unwrap_or_else(|| "Unknown".to_string());

    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw)?;

    let mut payload = if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(&raw)?
    };

    if !payload.is_object() {
        payload = json!({ "payload": payload });
    }

    if let Value::Object(map) = &mut payload {
        map.entry("hook_event_name".to_string())
            .or_insert(Value::String(event_name));

        if let Ok(cwd) = env::current_dir() {
            map.entry("cwd".to_string())
                .or_insert(Value::String(cwd.display().to_string()));
        }
    }

    let response = reqwest::blocking::Client::new()
        .post("http://localhost:4000/api/hooks")
        .json(&payload)
        .send()?;

    if !response.status().is_success() {
        return Err(format!(
            "Traceframe returned {}: {}",
            response.status(),
            response.text().unwrap_or_default()
        )
        .into());
    }

    Ok(())
}
EOF

cd ~/.codex/hooks/traceframe-forward
cargo build --release
```

Create `~/.codex/hooks.json` for user-wide logging, or `.codex/hooks.json` in a trusted project for project-local logging:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward SessionStart",
        "timeout": 5,
        "statusMessage": "Logging SessionStart"
      }
    ],
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward UserPromptSubmit",
        "timeout": 5,
        "statusMessage": "Logging UserPromptSubmit"
      }
    ],
    "PreToolUse": [
      {
        "type": "command",
        "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PreToolUse",
        "timeout": 5,
        "statusMessage": "Logging PreToolUse"
      }
    ],
    "PostToolUse": [
      {
        "type": "command",
        "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PostToolUse",
        "timeout": 5,
        "statusMessage": "Logging PostToolUse"
      }
    ],
    "PermissionRequest": [
      {
        "type": "command",
        "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PermissionRequest",
        "timeout": 5,
        "statusMessage": "Logging PermissionRequest"
      }
    ],
    "PreCompact": [
      {
        "type": "command",
        "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PreCompact",
        "timeout": 5,
        "statusMessage": "Logging PreCompact"
      }
    ]
  }
}
```

Codex will ask you to review and trust non-managed command hooks before they run. Use `/hooks` in Codex to inspect loaded hooks.

Reference: https://developers.openai.com/codex/hooks

## Pi Agent Hooks

Pi is an in-process coding agent whose lifecycle hooks are exposed as
[TypeScript extensions](https://github.com/earendil-works/pi-coding-agent)
rather than external commands. Traceframe ships a small extension
([hooks/pi/traceframe.ts](./hooks/pi/traceframe.ts)) that subscribes to the
relevant Pi events and posts them to the same `/api/hooks` endpoint used by
Claude and Codex.

Install (project-local — recommended for this repo):

This repo already ships [.pi/settings.json](./.pi/settings.json) that
auto-loads the extension. Run `pi` from the repo root, answer "yes" to the
trust prompt (or `/trust` once), and the extension is wired up.

Install (global — applies to every Pi session on this machine):

```bash
cp hooks/pi/traceframe.ts ~/.pi/agent/extensions/
```

### Configuration

The endpoint defaults to `http://localhost:4000`. Override before starting
Pi:

```bash
TRACEFRAME_ENDPOINT=http://traceframe.internal:4000 pi
```

> **Warning:** tool arguments, working-directory paths, and echoed
> environment values are sent in the POST body in cleartext. Use
> `https://` for any host that is not `localhost` or `127.0.0.1`, and never
> point at a Traceframe deployment you do not trust.

Optional environment variables:

| Variable               | Effect                                                     |
|------------------------|------------------------------------------------------------|
| `TRACEFRAME_ENDPOINT`  | Base URL (default `http://localhost:4000`)                 |
| `TRACEFRAME_DISABLED`  | `1` to no-op the extension                                 |
| `TRACEFRAME_DEBUG`     | `1` to log failed posts to stderr                          |

### Event mapping

| Pi event                 | Traceframe `hook_event_name` | Notes |
|--------------------------|------------------------------|-------|
| `session_start`          | `SessionStart`               | Startup, `/new`, `/resume`, `/fork`, `/clone`. |
| `input`                  | `UserPromptSubmit`           | Skips messages injected by other extensions, slash commands, automation, and voice input. |
| `tool_execution_start`   | `PreToolUse`                 | Includes `tool_name` and `tool_input`. |
| `tool_execution_end`     | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`              | `Stop`                       | Includes `last_assistant_message`. Tool-only and thinking-only turns render a brief summary instead of an empty string. |
| `session_shutdown`       | `SessionEnd`                 |                                                              |

### Session grouping

`session_id` is the basename of Pi's session file (e.g. `2026-07-03_abc` from
`/Users/me/.pi/agent/sessions/2026-07-03_abc.jsonl`), stable across resumes
and distinct across forks. `session_name` is the basename of the working
directory so the UI shows a useful label.

`transcript_path` is the absolute path to the session JSONL file (typically
under `~/.pi/agent/sessions/`). It is forwarded verbatim to Traceframe so
context features can read the transcript. For single-user local use this
is fine; sharing a remote Traceframe deployment multiplies the blast
radius — use a self-hosted instance behind a trusted network boundary.

### Safety

The extension never blocks Pi. Every POST is fire-and-forget with a 2s
timeout; a missing or slow Traceframe server cannot stall the agent, and
a network error is silently swallowed (or logged when `TRACEFRAME_DEBUG=1`).

### Project-local config (this repo)

The traceframe repo ships its own project-local Pi config at
[.pi/settings.json](./.pi/settings.json) so `pi` picks up the extension
automatically when run here. Only the extension pointer is set — transport
and timeout settings are left to your global `~/.pi/agent/settings.json` so
the per-project config does not silently override your usual choices.

The first time you start `pi` in this directory it will ask whether to
trust the project. Answer yes (or `/trust` once after startup) and the
config takes effect on every subsequent run. See [.pi/README.md](./.pi/README.md)
for the rationale and the path-resolution rule for the extension entry.

Reference: https://github.com/earendil-works/pi-coding-agent/blob/main/docs/extensions.md

## Omp Hooks

Omp (Oh My Pi) is a fork of Pi that targets
`@oh-my-pi/pi-coding-agent` and ships its own extension runtime. Traceframe
ships a parallel extension
([hooks/omp/traceframe.ts](./hooks/omp/traceframe.ts)) that posts the same
events to the same `/api/hooks` endpoint, with `source: "omp"` so the UI
can tell Omp and Pi events apart.

### Install

Pick one of two layouts. Both reference the same file —
`hooks/omp/traceframe.ts` is the single source of truth; do not edit one
copy without updating the other.

**Project-local (preferred in this repo)** — drop a `.omp/settings.json`
at the repo root that points at the extension:

```json
{
  "extensions": ["../hooks/omp/traceframe.ts"]
}
```

Trust the project once (`/trust`) and the extension loads on every
`omp` invocation here.

**Global (every Omp session for the current user)** — copy the extension
file into your global extensions folder:

```bash
cp hooks/omp/traceframe.ts ~/.omp/agent/extensions/
```

### Configure

The endpoint defaults to `http://localhost:4000`. Override before
starting Omp:

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

### Event mapping

| Omp event               | Traceframe `hook_event_name` | Notes |
|-------------------------|------------------------------|-------|
| `session_start`         | `SessionStart`               | Startup, `/new`, `/resume`, `/fork`, `/clone`. |
| `input`                 | `UserPromptSubmit`           | Skips messages injected by other extensions, slash commands, automation, and voice input. |
| `tool_execution_start`  | `PreToolUse`                 | Includes `tool_name` and `tool_input`. |
| `tool_execution_end`    | `PostToolUse`                | Pairs with Pre via `tool_use_id`; includes `tool_response`. |
| `agent_end`             | `Stop`                       | Includes `last_assistant_message`. Tool-only and thinking-only turns render a brief summary instead of an empty string. |
| `session_shutdown`      | `SessionEnd`                 |                                                              |

### Session grouping

`session_id` is the basename of Omp's session file (e.g. `2026-07-03_abc`
from `/Users/me/.omp/agent/sessions/2026-07-03_abc.jsonl`), stable
across `/resume` and distinct across `/fork` / `/clone`. `session_name`
is the basename of the working directory so the UI shows a useful
label.

`transcript_path` is forwarded verbatim — single-user local is fine;
sharing a remote Traceframe deployment multiplies the blast radius.

### Safety

The extension never blocks Omp. Every POST is fire-and-forget with a 2s
`AbortSignal` timeout. A missing or slow Traceframe server cannot stall
the agent, and a network error is silently swallowed (or logged when
`TRACEFRAME_DEBUG=1`).

Helper coverage, design notes, and the rationale for inlining the
helpers into the entry file live in
[hooks/omp/README.md](./hooks/omp/README.md).

Reference: https://github.com/oh-my-pi/pi-coding-agent/blob/main/docs/extensions.md
