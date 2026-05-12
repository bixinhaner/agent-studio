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
    current_key, value = line.split("=", 1)
    if current_key.strip() == key:
        print(value.strip())
        raise SystemExit(0)

raise SystemExit(1)
PY
}

check_env_parseability() {
  local env_file="$1"
  python3 - "$env_file" <<'PY'
from pathlib import Path
import sys

for lineno, raw_line in enumerate(Path(sys.argv[1]).read_text().splitlines(), start=1):
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        raise SystemExit(f"{sys.argv[1]} line {lineno} is not KEY=VALUE")
PY
}

print_same_origin_hints() {
  local redirect_uri=""
  local session_cookie_secure=""
  local api_base=""

  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    redirect_uri="$(read_env_value "$BACKEND_ENV_FILE" "DINGTALK_REDIRECT_URI" 2>/dev/null || true)"
    session_cookie_secure="$(read_env_value "$BACKEND_ENV_FILE" "SESSION_COOKIE_SECURE" 2>/dev/null || true)"
  fi

  if [[ -f "$FRONTEND_ENV_FILE" ]]; then
    api_base="$(read_env_value "$FRONTEND_ENV_FILE" "VITE_AGENT_API_BASE" 2>/dev/null || true)"
  fi

  if [[ -n "$redirect_uri" ]]; then
    printf 'DINGTALK_REDIRECT_URI=%s\n' "$(redact_url "$redirect_uri")"
  else
    printf 'DINGTALK_REDIRECT_URI=<unset>\n'
  fi
  printf 'SESSION_COOKIE_SECURE=%s\n' "${session_cookie_secure:-<unset>}"
  printf 'VITE_AGENT_API_BASE=%s\n' "${api_base:-<empty>}"

  if [[ -n "$redirect_uri" && "$redirect_uri" != https://* ]]; then
    printf 'hint: DingTalk callback should normally use https in production.\n'
  fi
  if [[ "${session_cookie_secure,,}" == "true" && "$redirect_uri" == http://* ]]; then
    printf 'hint: SESSION_COOKIE_SECURE=true with an http callback will break cookie delivery.\n'
  fi
  if [[ -n "$api_base" && "$api_base" != /* ]]; then
    printf 'hint: VITE_AGENT_API_BASE is cross-origin; current deployment automation assumes same-origin /api.\n'
  fi
}

check_required_commands() {
  command -v node
  command -v npm
  command -v python3
  command -v curl
  command -v psql
  command -v pm2
  command -v caddy
  command -v soffice
  command -v pdftoppm
  command -v pdfinfo
}

check_document_render_runtime() {
  soffice --version
  pdftoppm -v 2>&1 | head -n 1
  pdfinfo -v 2>&1 | head -n 1
  fc-match Calibri | head -n 1
  fc-match "Noto Sans CJK SC" | head -n 1
}

check_build_outputs() {
  test -f "$APP_API_DIR/dist/codex-runtime.js"
  test -f "$APP_UI_DIR/dist/index.html"
}

check_env_files() {
  check_env_parseability "$BACKEND_ENV_FILE"
  check_env_parseability "$FRONTEND_ENV_FILE"
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

  try_run "required commands" check_required_commands
  try_run "env parseability" check_env_files
  try_run "build outputs" check_build_outputs
  try_run "pm2 status" run_as_app_user_shell "pm2 status"
  try_run "pm2 logs" run_as_app_user_shell "pm2 logs '$PM2_APP_NAME' --lines 80 --nostream"
  try_run "health check" curl --fail --silent --show-error "$HEALTH_URL"
  try_run "caddy validate" caddy validate --config "$CADDY_CONFIG_FILE" --adapter caddyfile
  try_run "document render runtime" check_document_render_runtime
  try_run "prisma migrate status" run_as_app_user_shell "cd '$APP_API_DIR' && npx prisma migrate status"

  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    local database_url
    database_url="$(read_env_value "$BACKEND_ENV_FILE" "DATABASE_URL" 2>/dev/null || true)"
    if [[ -n "$database_url" ]]; then
      try_run "postgres" psql "$database_url" -c 'select 1;'
    fi
  fi

  if [[ -f "$APP_API_DIR/dist/codex-runtime.js" ]]; then
    try_run "codex runtime" run_as_app_user_shell "cd '$APP_API_DIR' && node --input-type=module <<'EOF'
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
  fi

  print_section "same-origin hints"
  print_same_origin_hints

  try_run "journalctl" journalctl -u caddy -n 80 --no-pager
}

main
