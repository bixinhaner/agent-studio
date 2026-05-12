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

normalize_postgres_cli_url() {
  local database_url="$1"

  python3 - "$database_url" <<'PY'
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import sys

database_url = sys.argv[1]
parts = urlsplit(database_url)
filtered_query = urlencode(
    [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key.lower() != "schema"]
)
print(urlunsplit((parts.scheme, parts.netloc, parts.path, filtered_query, parts.fragment)))
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
  [[ -f "$APP_UI_DIR/dist/version.json" ]] || die "missing frontend build metadata: $APP_UI_DIR/dist/version.json"
  [[ -f "$APP_UI_DIR/dist/stale-asset-reload.js" ]] || die "missing stale asset fallback module: $APP_UI_DIR/dist/stale-asset-reload.js"
  [[ -d "$APP_UI_DIR/dist/assets" ]] || die "missing frontend assets directory: $APP_UI_DIR/dist/assets"
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
  require_command soffice
  require_command pdftoppm
  require_command pdfinfo
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
  local cli_database_url
  cli_database_url="$(normalize_postgres_cli_url "$DATABASE_URL")"
  psql "$cli_database_url" -tAc 'select 1;' >/dev/null
  psql "$cli_database_url" -tAc 'select current_database(), current_user;' >/dev/null
  print_ok "postgresql connection is healthy"
}

check_pm2() {
  run_as_app_user_shell "pm2 status '$PM2_APP_NAME' >/dev/null"
  print_ok "pm2 status is available for $PM2_APP_NAME"
}

check_caddy() {
  caddy validate --config "$CADDY_CONFIG_FILE" --adapter caddyfile >/dev/null
  grep -Fq "handle /version.json" "$CADDY_CONFIG_FILE" || die "Caddy config is missing /version.json no-store route"
  grep -Fq "@missing_js_asset" "$CADDY_CONFIG_FILE" || die "Caddy config is missing stale JS asset fallback route"
  grep -Fq "handle /assets/*" "$CADDY_CONFIG_FILE" || die "Caddy config is missing explicit /assets/* route"
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
import { getDbClient } from './dist/db/client.js';
import { ManagedCodexProviderResolver } from './dist/managed-codex-provider.js';
import { SystemSettingsRepository } from './dist/system-settings/repository.js';

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

const db = getDbClient();
const resolver = new ManagedCodexProviderResolver({
  integrations: {
    async listOpenAICodexInstances() {
      const rows = await db.integrationInstance.findMany({
        where: { type: 'openai_codex' },
        orderBy: { createdAt: 'asc' }
      });
      return await Promise.all(
        rows.map(async (row) => {
          const [configRow, secretRow] = await Promise.all([
            db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: row.id } }),
            db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: row.id } })
          ]);
          return {
            id: row.id,
            slug: row.slug,
            status: row.status,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? ''),
            config: asRecord(configRow?.config),
            secretState: asRecord(secretRow?.secretState)
          };
        })
      );
    }
  },
  systemSettings: new SystemSettingsRepository(db)
});
const snapshot = await resolver.resolveActiveProviderSnapshot();
const runtime = new CodexRuntime(snapshot.runtimeOptions);
await runtime.validateProvider({
  model: snapshot.config.defaultModel,
  reasoningEffort: snapshot.config.defaultReasoningEffort
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
