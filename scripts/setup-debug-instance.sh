#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

SOURCE_INSTALL_ROOT="${SOURCE_INSTALL_ROOT:-/usr/local/agent-studio}"
DEBUG_INSTALL_ROOT="${DEBUG_INSTALL_ROOT:-/usr/local/agent-studio-debug}"
DEBUG_DATABASE_NAME="${DEBUG_DATABASE_NAME:-agent_studio_debug}"
DEBUG_API_PORT="${DEBUG_API_PORT:-8789}"
DEBUG_HTTPS_PORT="${DEBUG_HTTPS_PORT:-4443}"
DEBUG_PM2_APP_NAME="${DEBUG_PM2_APP_NAME:-agent-studio-debug-api}"
DEBUG_COOKIE_NAME="${DEBUG_COOKIE_NAME:-agent_studio_debug_session}"
DEBUG_DOMAIN="${DEBUG_DOMAIN:-}"
REFRESH_DATABASE="${REFRESH_DATABASE:-0}"
SHARED_KNOWLEDGE_SET_ROOT="${SHARED_KNOWLEDGE_SET_ROOT:-$SOURCE_INSTALL_ROOT/data/knowledge-sets}"
DEBUG_DATABASE_URL="${DEBUG_DATABASE_URL:-}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Bootstrap the isolated debug instance on the production host.

Options:
  --source-root <path>       Production install root [default: $SOURCE_INSTALL_ROOT]
  --debug-root <path>        Debug install root [default: $DEBUG_INSTALL_ROOT]
  --debug-db <name>          Debug PostgreSQL database name [default: $DEBUG_DATABASE_NAME]
  --domain <name>            Public hostname for the debug entry [default: production install state domain]
  --api-port <port>          Debug API port [default: $DEBUG_API_PORT]
  --https-port <port>        Debug public HTTPS port [default: $DEBUG_HTTPS_PORT]
  --refresh-db               Rebuild the debug database from the production database
  -h, --help                 Show this help text
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      SOURCE_INSTALL_ROOT="$2"
      shift 2
      ;;
    --debug-root)
      DEBUG_INSTALL_ROOT="$2"
      shift 2
      ;;
    --debug-db)
      DEBUG_DATABASE_NAME="$2"
      shift 2
      ;;
    --domain)
      DEBUG_DOMAIN="$2"
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
    --refresh-db)
      REFRESH_DATABASE=1
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

build_debug_database_url() {
  local source_database_url="$1"

  python3 - "$source_database_url" "$DEBUG_DATABASE_NAME" <<'PY'
from urllib.parse import urlsplit, urlunsplit
import sys

source_database_url = sys.argv[1]
debug_database_name = sys.argv[2]
parts = urlsplit(source_database_url)
path = parts.path or ""
segments = path.split("/")
if len(segments) < 2 or not segments[-1]:
    raise SystemExit("DATABASE_URL does not include a database name")
segments[-1] = debug_database_name
print(urlunsplit((parts.scheme, parts.netloc, "/".join(segments), parts.query, parts.fragment)))
PY
}

normalize_postgres_cli_url() {
  local database_url="$1"

  python3 - "$database_url" <<'PY'
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import sys

database_url = sys.argv[1]
parts = urlsplit(database_url)
filtered_query = urlencode([(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key.lower() != "schema"])
print(urlunsplit((parts.scheme, parts.netloc, parts.path, filtered_query, parts.fragment)))
PY
}

ensure_debug_checkout() {
  if [[ -d "$DEBUG_INSTALL_ROOT/.git" ]]; then
    log_info "Debug checkout already exists at $DEBUG_INSTALL_ROOT"
    return 0
  fi

  log_step "Creating debug checkout"
  mkdir -p "$DEBUG_INSTALL_ROOT"
  rsync -a \
    --exclude 'data' \
    --exclude 'sessions' \
    --exclude 'temp' \
    --exclude 'state' \
    --exclude 'install-state.json' \
    --exclude 'agent-api/.env' \
    --exclude 'agent-ui/.env.production' \
    --exclude 'agent-api/node_modules' \
    --exclude 'agent-ui/node_modules' \
    --exclude 'agent-api/dist' \
    --exclude 'agent-ui/dist' \
    "$SOURCE_INSTALL_ROOT/" "$DEBUG_INSTALL_ROOT/"
  apply_app_user_ownership "$DEBUG_INSTALL_ROOT"
}

ensure_debug_directories() {
  log_step "Preparing debug data directories"
  mkdir -p \
    "$DEBUG_INSTALL_ROOT/data/session-uploads" \
    "$DEBUG_INSTALL_ROOT/data/workspaces" \
    "$DEBUG_INSTALL_ROOT/data/knowledge-sets" \
    "$DEBUG_INSTALL_ROOT/sessions" \
    "$DEBUG_INSTALL_ROOT/temp" \
    "$DEBUG_INSTALL_ROOT/state"
  apply_app_user_ownership "$DEBUG_INSTALL_ROOT/data/session-uploads"
  apply_app_user_ownership "$DEBUG_INSTALL_ROOT/data/workspaces"
  apply_app_user_ownership "$DEBUG_INSTALL_ROOT/sessions"
  apply_app_user_ownership "$DEBUG_INSTALL_ROOT/temp"
  apply_app_user_ownership "$DEBUG_INSTALL_ROOT/state"
}

ensure_readonly_knowledge_mount() {
  local debug_knowledge_root="$DEBUG_INSTALL_ROOT/data/knowledge-sets"
  local fstab_bind_line="$SHARED_KNOWLEDGE_SET_ROOT $debug_knowledge_root none bind 0 0"
  local fstab_remount_line="$SHARED_KNOWLEDGE_SET_ROOT $debug_knowledge_root none remount,bind,ro 0 0"

  [[ -d "$SHARED_KNOWLEDGE_SET_ROOT" ]] || die "shared knowledge set root does not exist: $SHARED_KNOWLEDGE_SET_ROOT"
  mkdir -p "$debug_knowledge_root"

  if mountpoint -q "$debug_knowledge_root"; then
    mount -o remount,bind,ro "$debug_knowledge_root"
  else
    mount --bind "$SHARED_KNOWLEDGE_SET_ROOT" "$debug_knowledge_root"
    mount -o remount,bind,ro "$debug_knowledge_root"
  fi

  grep -Fqx "$fstab_bind_line" /etc/fstab || printf '%s\n' "$fstab_bind_line" >> /etc/fstab
  grep -Fqx "$fstab_remount_line" /etc/fstab || printf '%s\n' "$fstab_remount_line" >> /etc/fstab
}

ensure_debug_database() {
  local source_backend_env_file="$SOURCE_INSTALL_ROOT/agent-api/.env"
  local source_database_url
  local source_cli_database_url
  local debug_database_url
  local debug_cli_database_url
  local db_exists

  source_database_url="$(read_env_value_if_exists "$source_backend_env_file" DATABASE_URL)"
  [[ -n "$source_database_url" ]] || die "DATABASE_URL is missing from $source_backend_env_file"
  debug_database_url="$(build_debug_database_url "$source_database_url")"
  source_cli_database_url="$(normalize_postgres_cli_url "$source_database_url")"
  debug_cli_database_url="$(normalize_postgres_cli_url "$debug_database_url")"

  db_exists="$(sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DEBUG_DATABASE_NAME';" postgres)"
  if [[ "$REFRESH_DATABASE" == "1" && "$db_exists" == "1" ]]; then
    log_step "Refreshing debug database"
    sudo -u postgres psql -Atqc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DEBUG_DATABASE_NAME' AND pid <> pg_backend_pid();" postgres >/dev/null
    sudo -u postgres dropdb "$DEBUG_DATABASE_NAME"
    db_exists=""
  fi

  if [[ "$db_exists" != "1" ]]; then
    log_step "Creating debug database"
    sudo -u postgres createdb --owner=agentstudio "$DEBUG_DATABASE_NAME"
    sudo -u postgres pg_dump --no-owner --no-privileges --dbname="$source_cli_database_url" | sudo -u postgres psql --dbname="$debug_cli_database_url" >/dev/null
  else
    log_info "Debug database already exists: $DEBUG_DATABASE_NAME"
  fi

  DEBUG_DATABASE_URL="$debug_database_url"
}

configure_debug_env() {
  local debug_database_url="$1"
  local source_backend_env_file="$SOURCE_INSTALL_ROOT/agent-api/.env"
  local source_frontend_env_file="$SOURCE_INSTALL_ROOT/agent-ui/.env.production"
  local debug_backend_env_file="$DEBUG_INSTALL_ROOT/agent-api/.env"
  local debug_frontend_env_file="$DEBUG_INSTALL_ROOT/agent-ui/.env.production"
  local session_cookie_secret

  [[ -f "$debug_backend_env_file" ]] || cp "$source_backend_env_file" "$debug_backend_env_file"
  [[ -f "$debug_frontend_env_file" ]] || cp "$source_frontend_env_file" "$debug_frontend_env_file"

  session_cookie_secret="$(read_env_value_if_exists "$debug_backend_env_file" SESSION_COOKIE_SECRET)"
  if [[ -z "$session_cookie_secret" ]]; then
    session_cookie_secret="$(generate_random_secret 32)"
  fi

  write_env_key_value "$debug_backend_env_file" PORT "$DEBUG_API_PORT"
  write_env_key_value "$debug_backend_env_file" HOST "127.0.0.1"
  write_env_key_value "$debug_backend_env_file" DATABASE_URL "$debug_database_url"
  write_env_key_value "$debug_backend_env_file" DEFAULT_WORKSPACE "$DEBUG_INSTALL_ROOT/data/workspaces"
  write_env_key_value "$debug_backend_env_file" SESSION_WORKSPACE_ROOT "$DEBUG_INSTALL_ROOT/sessions"
  write_env_key_value "$debug_backend_env_file" WORKSPACE_WHITELIST "$DEBUG_INSTALL_ROOT/data/workspaces"
  write_env_key_value "$debug_backend_env_file" THREAD_STORE_FILE "$DEBUG_INSTALL_ROOT/temp/agent-threads.json"
  write_env_key_value "$debug_backend_env_file" UPLOAD_TEMP_ROOT "$DEBUG_INSTALL_ROOT/data/session-uploads"
  write_env_key_value "$debug_backend_env_file" KNOWLEDGE_SET_STORAGE_ROOT "$DEBUG_INSTALL_ROOT/data/knowledge-sets"
  write_env_key_value "$debug_backend_env_file" SESSION_COOKIE_NAME "$DEBUG_COOKIE_NAME"
  write_env_key_value "$debug_backend_env_file" SESSION_COOKIE_SECRET "$session_cookie_secret"
  write_env_key_value "$debug_backend_env_file" SESSION_COOKIE_SECURE "true"
  write_env_key_value "$debug_backend_env_file" APP_BASE_URL "https://$DEBUG_DOMAIN:$DEBUG_HTTPS_PORT"
  write_env_key_value "$debug_backend_env_file" DINGTALK_REDIRECT_URI "https://$DEBUG_DOMAIN:$DEBUG_HTTPS_PORT/auth/dingtalk/callback"
  write_env_key_value "$debug_backend_env_file" ORG_SYNC_ENABLED "false"

  write_env_key_value "$debug_frontend_env_file" NODE_ENV "production"
  write_env_key_value "$debug_frontend_env_file" VITE_AGENT_API_BASE ""
  write_env_key_value "$debug_frontend_env_file" VITE_AGENT_API_TOKEN ""

  apply_app_user_ownership "$debug_backend_env_file"
  apply_app_user_ownership "$debug_frontend_env_file"
  ensure_secure_file_mode "$debug_backend_env_file" 600
  ensure_secure_file_mode "$debug_frontend_env_file" 600
}

resolve_debug_domain() {
  if [[ -n "$DEBUG_DOMAIN" ]]; then
    return 0
  fi

  local source_install_state_file="$SOURCE_INSTALL_ROOT/install-state.json"
  if [[ -f "$source_install_state_file" ]]; then
    DEBUG_DOMAIN="$(read_install_state_value "$source_install_state_file" domain "")"
  fi

  [[ -n "$DEBUG_DOMAIN" ]] || die "debug domain is required"
}

main() {
  require_root_shell
  require_command rsync
  require_command git
  require_command node
  require_command npm
  require_command pm2
  require_command caddy
  require_command psql
  require_command pg_dump
  require_command createdb
  require_command mountpoint

  [[ -d "$SOURCE_INSTALL_ROOT/.git" ]] || die "source repo is not initialized: $SOURCE_INSTALL_ROOT"
  resolve_debug_domain
  ensure_debug_checkout
  ensure_debug_directories
  ensure_readonly_knowledge_mount
  ensure_debug_database
  configure_debug_env "$DEBUG_DATABASE_URL"

  bash "$script_dir/deploy-debug-instance.sh" \
    --debug-root "$DEBUG_INSTALL_ROOT" \
    --prod-root "$SOURCE_INSTALL_ROOT" \
    --domain "$DEBUG_DOMAIN" \
    --api-port "$DEBUG_API_PORT" \
    --https-port "$DEBUG_HTTPS_PORT" \
    --skip-git-pull

  log_step "Debug bootstrap complete"
  log_info "Debug URL: https://$DEBUG_DOMAIN:$DEBUG_HTTPS_PORT"
  log_info "Debug database: $DEBUG_DATABASE_NAME"
}

main
