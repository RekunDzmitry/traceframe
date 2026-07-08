#!/usr/bin/env bash
# CI helper: fail the build if `.pi/settings.json` is not valid JSON or the
# extension pointer does not resolve to a file. Cheap to run anywhere with
# `bash` + `jq`; no test framework needed.
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "scripts/check-pi-settings.sh: jq is required (https://jqlang.org/)" >&2
  exit 2
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
settings="$repo_root/.pi/settings.json"

if [[ ! -f "$settings" ]]; then
  echo ".pi/settings.json not found at $settings" >&2
  exit 1
fi

if ! jq -e . "$settings" >/dev/null 2>&1; then
  echo ".pi/settings.json is not valid JSON" >&2
  jq . "$settings" >&2 || true
  exit 1
fi

extensions=$(jq -r '.extensions // [] | .[]' "$settings")
if [[ -z "$extensions" ]]; then
  echo ".pi/settings.json must declare at least one entry under .extensions" >&2
  exit 1
fi

bad=0
while IFS= read -r ext; do
  if [[ -z "$ext" ]]; then continue; fi
  resolved="$repo_root/.pi/$ext"
  if [[ ! -f "$resolved" ]]; then
    echo "Extension entry '$ext' (resolved to $resolved) does not exist" >&2
    bad=1
  fi
done <<< "$extensions"

if [[ "$bad" -ne 0 ]]; then
  exit 1
fi

echo "scripts/check-pi-settings.sh: .pi/settings.json is valid; all extension pointers resolve"
