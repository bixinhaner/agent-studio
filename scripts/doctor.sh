#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8787}"
HEALTH_URL="${HEALTH_URL:-http://$API_HOST:$API_PORT/healthz}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Collect common deployment diagnostics for Agent Studio.

Options:
  --repo-dir <path>      Repository checkout path [default: $APP_REPO_DIR]
  --health-url <url>     API health endpoint [default: $HEALTH_URL]
  -h, --help             Show this help text
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      APP_REPO_DIR="$2"
      APP_REPO_DIR_EXPLICIT=1
      shift 2
      ;;
    --health-url)
      HEALTH_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

REPO_DIR="$APP_REPO_DIR"
refresh_app_paths

print_section() {
  printf '\n== %s ==\n' "$1"
}

try_run() {
  local label="$1"
  shift

  print_section "$label"
  "$@" || true
}

database_url_from_env() {
  python3 - "$BACKEND_ENV_FILE" <<'PY'
from pathlib import Path
import sys

for raw_line in Path(sys.argv[1]).read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == "DATABASE_URL":
        print(value.strip())
        raise SystemExit(0)

raise SystemExit(1)
PY
}

main() {
  print_section "summary"
  printf 'repo: %s\n' "$APP_REPO_DIR"
  printf 'api dir: %s\n' "$APP_API_DIR"
  printf 'ui dir: %s\n' "$APP_UI_DIR"
  printf 'backend env: %s\n' "$BACKEND_ENV_FILE"
  printf 'frontend env: %s\n' "$FRONTEND_ENV_FILE"
  printf 'caddy config: %s\n' "$CADDY_CONFIG_FILE"
  printf 'health url: %s\n' "$HEALTH_URL"

  try_run "pm2 status" run_as_app_user_shell "pm2 status"
  try_run "pm2 logs" run_as_app_user_shell "pm2 logs '$PM2_APP_NAME' --lines 80 --nostream"
  try_run "health check" curl --fail --silent --show-error "$HEALTH_URL"
  try_run "caddy validate" caddy validate --config "$CADDY_CONFIG_FILE"

  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    local database_url
    database_url="$(database_url_from_env)" || database_url=""
    if [[ -n "$database_url" ]]; then
      try_run "postgres" psql "$database_url" -c 'select 1;'
    fi
  fi

  if [[ -f "$APP_API_DIR/dist/codex-runtime.js" ]]; then
    try_run "codex runtime" run_as_app_user_shell "cd '$APP_API_DIR' && node --input-type=module <<'EOF'
import { CodexRuntime } from './dist/codex-runtime.js';

const runtime = new CodexRuntime();
await runtime.validateProvider({
  model: 'gpt-5.4',
  reasoningEffort: 'high'
});
console.log('codex runtime ok');
EOF"
  fi

  try_run "journalctl" journalctl -u caddy -n 80 --no-pager
}

main
