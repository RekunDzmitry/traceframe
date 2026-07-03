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

Codex tool rows also show a context-window bar. Traceframe reads the
`token_count` snapshots from the Codex transcript named by each hook's
`transcript_path`; Docker Compose mounts both `~/.codex/sessions` and
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
