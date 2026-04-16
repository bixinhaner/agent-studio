#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

PROD_INSTALL_ROOT="${PROD_INSTALL_ROOT:-/usr/local/agent-studio}"
DEBUG_INSTALL_ROOT="${DEBUG_INSTALL_ROOT:-/usr/local/agent-studio-debug}"
DEBUG_PM2_APP_NAME="${DEBUG_PM2_APP_NAME:-agent-studio-debug-api}"
DEBUG_API_HOST="${DEBUG_API_HOST:-127.0.0.1}"
DEBUG_API_PORT="${DEBUG_API_PORT:-8789}"
DEBUG_HTTPS_PORT="${DEBUG_HTTPS_PORT:-4443}"
DEBUG_DOMAIN="${DEBUG_DOMAIN:-}"
DEBUG_CADDY_SNIPPET_FILE="${DEBUG_CADDY_SNIPPET_FILE:-/etc/caddy/conf.d/agent-studio-debug.caddy}"
DEBUG_CADDY_TEMPLATE_FILE="${DEBUG_CADDY_TEMPLATE_FILE:-$script_dir/../templates/Caddyfile.debug.template}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
SKIP_RBAC_SEED="${SKIP_RBAC_SEED:-0}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Deploy the isolated debug instance without touching the production PM2 app.

Options:
  --debug-root <path>      Debug repository root [default: $DEBUG_INSTALL_ROOT]
  --prod-root <path>       Production install root used for the main Caddy config [default: $PROD_INSTALL_ROOT]
  --domain <name>          Public hostname for the debug entry [default: production install state domain]
  --api-host <host>        Debug API bind host [default: $DEBUG_API_HOST]
  --api-port <port>        Debug API port [default: $DEBUG_API_PORT]
  --https-port <port>      Debug public HTTPS port [default: $DEBUG_HTTPS_PORT]
  --skip-git-pull          Rebuild current checkout without fetching or pulling
  --skip-rbac-seed         Skip built-in RBAC seed step
  -h, --help               Show this help text
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug-root)
      DEBUG_INSTALL_ROOT="$2"
      shift 2
      ;;
    --prod-root)
      PROD_INSTALL_ROOT="$2"
      shift 2
      ;;
    --domain)
      DEBUG_DOMAIN="$2"
      shift 2
      ;;
    --api-host)
      DEBUG_API_HOST="$2"
      shift 2
      ;;
    --api-port)
      DEBUG_API_PORT="$2"
      shift 2
      ;;
    --https-port)
      DEBUG_HTTPS_PORT="$2"
      shift 2
      ;;
    --skip-git-pull)
      SKIP_GIT_PULL=1
      shift
      ;;
    --skip-rbac-seed)
      SKIP_RBAC_SEED=1
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

read_install_state_value() {
  local install_state_file="$1"
  local key="$2"
  local default_value="${3:-}"

  python3 - "$install_state_file" "$key" "$default_value" <<'PY'
import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
default_value = sys.argv[3]

if path.exists():
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        payload = {}
else:
    payload = {}

value = payload.get(key, default_value)
if isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False))
else:
    print(value)
PY
}

render_debug_caddy_snippet() {
  local destination="$1"

  python3 - "$DEBUG_CADDY_TEMPLATE_FILE" "$destination" "$DEBUG_DOMAIN" "$DEBUG_HTTPS_PORT" "$DEBUG_INSTALL_ROOT/agent-ui/dist" "$DEBUG_API_HOST" "$DEBUG_API_PORT" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
rendered = (
    template
    .replace("{$DEBUG_DOMAIN}", sys.argv[3])
    .replace("{$DEBUG_HTTPS_PORT}", sys.argv[4])
    .replace("{$DEBUG_UI_DIST_ROOT}", sys.argv[5])
    .replace("{$DEBUG_UPSTREAM_HOST}", sys.argv[6])
    .replace("{$DEBUG_UPSTREAM_PORT}", sys.argv[7])
)
destination.write_text(rendered)
PY
}

resolve_debug_domain() {
  if [[ -n "$DEBUG_DOMAIN" ]]; then
    return 0
  fi

  local prod_install_state_file="$PROD_INSTALL_ROOT/install-state.json"
  if [[ -f "$prod_install_state_file" ]]; then
    DEBUG_DOMAIN="$(read_install_state_value "$prod_install_state_file" domain "")"
  fi

  [[ -n "$DEBUG_DOMAIN" ]] || die "debug domain is required"
}

install_debug_caddy_snippet() {
  [[ -f "$DEBUG_CADDY_TEMPLATE_FILE" ]] || die "missing debug Caddy template: $DEBUG_CADDY_TEMPLATE_FILE"

  local rendered_snippet
  rendered_snippet="$(mktemp)"
  render_debug_caddy_snippet "$rendered_snippet"

  mkdir -p "$(dirname "$DEBUG_CADDY_SNIPPET_FILE")"
  install -m 644 "$rendered_snippet" "$DEBUG_CADDY_SNIPPET_FILE"
  rm -f "$rendered_snippet"
}

deploy_debug_app() {
  local args=(
    --repo-dir "$DEBUG_INSTALL_ROOT"
    --api-host "$DEBUG_API_HOST"
    --api-port "$DEBUG_API_PORT"
    --skip-caddy-reload
  )

  if [[ "$SKIP_GIT_PULL" == "1" ]]; then
    args+=(--skip-git-pull)
  fi
  if [[ "$SKIP_RBAC_SEED" == "1" ]]; then
    args+=(--skip-rbac-seed)
  fi

  INSTALL_ROOT="$DEBUG_INSTALL_ROOT" \
  APP_REPO_DIR="$DEBUG_INSTALL_ROOT" \
  APP_REPO_DIR_EXPLICIT=1 \
  PM2_APP_NAME="$DEBUG_PM2_APP_NAME" \
  PM2_ECOSYSTEM_FILE="$DEBUG_INSTALL_ROOT/pm2-ecosystem.config.cjs" \
  BACKEND_ENV_FILE="$DEBUG_INSTALL_ROOT/agent-api/.env" \
  BACKEND_ENV_FILE_EXPLICIT=1 \
  FRONTEND_ENV_FILE="$DEBUG_INSTALL_ROOT/agent-ui/.env.production" \
  FRONTEND_ENV_FILE_EXPLICIT=1 \
  bash "$script_dir/deploy-agent-studio.sh" "${args[@]}"
}

refresh_main_caddy_config() {
  INSTALL_ROOT="$PROD_INSTALL_ROOT" bash "$script_dir/refresh-caddy-config.sh" --repo-dir "$PROD_INSTALL_ROOT"
}

main() {
  require_root_shell
  require_command git
  require_command node
  require_command npm
  require_command pm2
  require_command caddy

  [[ -d "$DEBUG_INSTALL_ROOT/.git" ]] || die "debug repo is not initialized: $DEBUG_INSTALL_ROOT"
  [[ -d "$PROD_INSTALL_ROOT" ]] || die "production install root does not exist: $PROD_INSTALL_ROOT"

  resolve_debug_domain
  deploy_debug_app
  install_debug_caddy_snippet
  refresh_main_caddy_config

  log_step "Debug deploy complete"
  log_info "Debug repo: $DEBUG_INSTALL_ROOT"
  log_info "Debug PM2 app: $DEBUG_PM2_APP_NAME"
  log_info "Debug URL: https://$DEBUG_DOMAIN:$DEBUG_HTTPS_PORT"
}

main
