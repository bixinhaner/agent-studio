#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8787}"
HEALTH_URL="${HEALTH_URL:-http://$API_HOST:$API_PORT/healthz}"
SKIP_CODEX_CHECK="${SKIP_CODEX_CHECK:-0}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Validate a deployed Agent Studio environment.

Options:
  --repo-dir <path>      Repository checkout path [default: $APP_REPO_DIR]
  --api-host <host>      API host to probe [default: $API_HOST]
  --api-port <port>      API port to probe [default: $API_PORT]
  --health-url <url>     Full health endpoint override [default: $HEALTH_URL]
  --skip-codex-check     Skip Codex runtime validation
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
    --api-host)
      API_HOST="$2"
      shift 2
      ;;
    --api-port)
      API_PORT="$2"
      shift 2
      ;;
    --health-url)
      HEALTH_URL="$2"
      shift 2
      ;;
    --skip-codex-check)
      SKIP_CODEX_CHECK=1
      shift
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

print_ok() {
  printf '[OK] %s\n' "$1"
}

read_env_value() {
  local env_file="$1"
  local key="$2"

  python3 - "$env_file" "$key" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]

for raw_line in path.read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    current_key, current_value = line.split("=", 1)
    if current_key.strip() == key:
        print(current_value.strip())
        raise SystemExit(0)

raise SystemExit(1)
PY
}

check_required_files() {
  [[ -d "$APP_REPO_DIR" ]] || die "repository directory does not exist: $APP_REPO_DIR"
  [[ -f "$APP_API_DIR/package.json" ]] || die "missing agent-api/package.json under $APP_API_DIR"
  [[ -f "$APP_UI_DIR/package.json" ]] || die "missing agent-ui/package.json under $APP_UI_DIR"
  [[ -f "$BACKEND_ENV_FILE" ]] || die "missing backend env file: $BACKEND_ENV_FILE"
  [[ -f "$FRONTEND_ENV_FILE" ]] || die "missing frontend env file: $FRONTEND_ENV_FILE"
  [[ -f "$CADDY_CONFIG_FILE" ]] || die "missing Caddy config: $CADDY_CONFIG_FILE"
  [[ -f "$APP_API_DIR/dist/codex-runtime.js" ]] || die "missing backend build output: $APP_API_DIR/dist/codex-runtime.js"
  [[ -f "$APP_UI_DIR/dist/index.html" ]] || die "missing frontend build output: $APP_UI_DIR/dist/index.html"
  print_ok "required files are present"
}

check_commands() {
  require_command node
  require_command npm
  require_command python3
  require_command curl
  require_command psql
  require_command caddy
  require_command pm2
  print_ok "required commands are available"
}

check_backend_env() {
  local database_url
  database_url="$(read_env_value "$BACKEND_ENV_FILE" "DATABASE_URL")" || die "DATABASE_URL is missing from $BACKEND_ENV_FILE"
  [[ -n "$database_url" ]] || die "DATABASE_URL is empty in $BACKEND_ENV_FILE"
  DATABASE_URL="$database_url"
  print_ok "backend env includes DATABASE_URL"
}

check_frontend_env() {
  python3 - "$FRONTEND_ENV_FILE" <<'PY'
from pathlib import Path
import sys

for lineno, raw_line in enumerate(Path(sys.argv[1]).read_text().splitlines(), start=1):
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        raise SystemExit(f"frontend env line {lineno} is not KEY=VALUE")
PY
  print_ok "frontend env is parseable"
}

check_postgres() {
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is unavailable for PostgreSQL validation"
  psql "$DATABASE_URL" -tAc 'select 1;' >/dev/null
  psql "$DATABASE_URL" -tAc 'select current_database(), current_user;' >/dev/null
  print_ok "postgresql connection is healthy"
}

check_pm2() {
  run_as_app_user_shell "pm2 status '$PM2_APP_NAME' >/dev/null"
  print_ok "pm2 status is available for $PM2_APP_NAME"
}

check_caddy() {
  caddy validate --config "$CADDY_CONFIG_FILE" >/dev/null
  print_ok "caddy configuration validates"
}

check_http() {
  curl --fail --silent --show-error "$HEALTH_URL" >/dev/null
  print_ok "health endpoint is reachable at $HEALTH_URL"
}

check_codex_runtime() {
  if [[ "$SKIP_CODEX_CHECK" == "1" ]]; then
    log_info "Skipping Codex runtime validation"
    return 0
  fi

  run_as_app_user_shell "cd '$APP_API_DIR' && node --input-type=module <<'EOF'
import { CodexRuntime } from './dist/codex-runtime.js';

const runtime = new CodexRuntime();
await runtime.validateProvider({
  model: 'gpt-5.4',
  reasoningEffort: 'high'
});
console.log('codex runtime ok');
EOF"
  print_ok "Codex runtime validation passed"
}

main() {
  HEALTH_URL="${HEALTH_URL:-http://$API_HOST:$API_PORT/healthz}"

  check_commands
  check_required_files
  check_backend_env
  check_frontend_env
  check_postgres
  check_pm2
  check_caddy
  check_http
  check_codex_runtime
}

main
