# Traceframe

Traceframe is a minimal Claude Code hook viewer. Claude Code sends hook events to
the local API, the service stores the full JSON payload in ClickHouse, and the UI
shows the event names.

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
  -d '{"hook_event_name":"UserPromptSubmit","session_id":"demo"}'

curl http://localhost:4000/api/hooks
curl http://localhost:4000/healthz
```

The ClickHouse table is created automatically:

```sql
CREATE TABLE IF NOT EXISTS claude_hooks
(
  event_time DateTime64(3) DEFAULT now64(3),
  event_name String,
  session_id String,
  payload String
)
ENGINE = MergeTree
ORDER BY (event_time, event_name);
```

`payload` stores the complete hook JSON body unchanged. The UI only displays
`hook_event_name`.

## Claude Code Hooks

Claude Code HTTP hooks use `type: "http"` and send the hook JSON as the POST
body with `Content-Type: application/json`. The common input field
`hook_event_name` contains the lifecycle event name.

Create or update `.claude/settings.local.json` in the project where you run
Claude Code:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4000/api/hooks",
            "timeout": 5
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

Codex hooks are command hooks. Codex sends the hook payload to the command on
stdin, so use a small Rust forwarder to add the event name and post that JSON to
Traceframe.

Create and build the forwarder:

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
use std::env;
use std::io::{self, Read};
use std::process;

use serde_json::{json, Value};

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        process::exit(1);
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

cargo build --manifest-path ~/.codex/hooks/traceframe-forward/Cargo.toml --release
```

Create `~/.codex/hooks.json` for user-wide logging, or `.codex/hooks.json` in a
trusted project for project-local logging:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward SessionStart",
            "timeout": 5,
            "statusMessage": "Logging SessionStart"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward UserPromptSubmit",
            "timeout": 5,
            "statusMessage": "Logging UserPromptSubmit"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PreToolUse",
            "timeout": 5,
            "statusMessage": "Logging PreToolUse"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PostToolUse",
            "timeout": 5,
            "statusMessage": "Logging PostToolUse"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PermissionRequest",
            "timeout": 5,
            "statusMessage": "Logging PermissionRequest"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PreCompact",
            "timeout": 5,
            "statusMessage": "Logging PreCompact"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward PostCompact",
            "timeout": 5,
            "statusMessage": "Logging PostCompact"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.codex/hooks/traceframe-forward/target/release/traceframe-forward Stop",
            "timeout": 5,
            "statusMessage": "Logging Stop"
          }
        ]
      }
    ]
  }
}
```

Codex will ask you to review and trust non-managed command hooks before they
run. Use `/hooks` in Codex to inspect loaded hooks.

Codex also supports inline TOML hooks in `~/.codex/config.toml` or
`.codex/config.toml`; prefer one representation per config layer to avoid
duplicate hook runs.

Reference: https://developers.openai.com/codex/hooks
