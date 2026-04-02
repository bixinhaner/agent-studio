#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

APP_REPO_DIR_EXPLICIT="${APP_REPO_DIR_EXPLICIT:-0}"
APP_API_DIR_EXPLICIT="${APP_API_DIR_EXPLICIT:-0}"
APP_UI_DIR_EXPLICIT="${APP_UI_DIR_EXPLICIT:-0}"
BACKEND_ENV_FILE_EXPLICIT="${BACKEND_ENV_FILE_EXPLICIT:-0}"
FRONTEND_ENV_FILE_EXPLICIT="${FRONTEND_ENV_FILE_EXPLICIT:-0}"
REPO_DIR_EXPLICIT="${REPO_DIR_EXPLICIT:-0}"
DEPLOY_KEY_PATH_EXPLICIT="${DEPLOY_KEY_PATH_EXPLICIT:-0}"

if [[ -n "${APP_REPO_DIR+x}" ]]; then APP_REPO_DIR_EXPLICIT=1; fi
if [[ -n "${APP_API_DIR+x}" ]]; then APP_API_DIR_EXPLICIT=1; fi
if [[ -n "${APP_UI_DIR+x}" ]]; then APP_UI_DIR_EXPLICIT=1; fi
if [[ -n "${BACKEND_ENV_FILE+x}" ]]; then BACKEND_ENV_FILE_EXPLICIT=1; fi
if [[ -n "${FRONTEND_ENV_FILE+x}" ]]; then FRONTEND_ENV_FILE_EXPLICIT=1; fi
if [[ -n "${REPO_DIR+x}" ]]; then REPO_DIR_EXPLICIT=1; fi
if [[ -n "${DEPLOY_KEY_PATH+x}" ]]; then DEPLOY_KEY_PATH_EXPLICIT=1; fi

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-}"
REPO_DIR="${REPO_DIR:-}"
DEPLOY_KEY_PATH="${DEPLOY_KEY_PATH:-$APP_HOME/.ssh/id_ed25519_agent_studio_deploy}"
SKIP_CODEX_CHECK="${SKIP_CODEX_CHECK:-0}"
ASSUME_YES="${ASSUME_YES:-0}"
STATE_FILE_OVERRIDE="${STATE_FILE_OVERRIDE:-}"
RUN_CLONE=1
SHOW_HELP=0
FORCE_ALL=0
declare -a FORCE_PHASES=()
POSTGRES_DB_NAME="${POSTGRES_DB_NAME:-agent_studio}"
POSTGRES_DB_USER="${POSTGRES_DB_USER:-agentstudio}"
POSTGRES_DB_PASSWORD="${POSTGRES_DB_PASSWORD:-}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
DEFAULT_MODEL="${DEFAULT_MODEL:-gpt-5.4}"
DEFAULT_REASONING_EFFORT="${DEFAULT_REASONING_EFFORT:-high}"
SESSION_COOKIE_SECRET="${SESSION_COOKIE_SECRET:-}"
DINGTALK_CLIENT_ID="${DINGTALK_CLIENT_ID:-}"
DINGTALK_CLIENT_SECRET="${DINGTALK_CLIENT_SECRET:-}"
DINGTALK_REDIRECT_URI="${DINGTALK_REDIRECT_URI:-}"
DINGTALK_SCOPE="${DINGTALK_SCOPE:-openid}"
DEPLOY_KEY_SAFE_CHECKPOINT=0
DEPLOY_KEY_CONTINUE_TO_CLONE=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Root-only Ubuntu installer for Agent Studio.

Default behavior:
  - if the current working directory is a git checkout, it is used as the repo
  - otherwise the repo defaults to $INSTALL_ROOT
  - if no local checkout exists, the installer can clone into $INSTALL_ROOT

Options:
  --domain <name>           Public domain to configure for Caddy
  --repo-url <url>          Git repository clone URL (used when clone is needed)
  --repo-dir <path>         Repository directory override
  --deploy-key-path <path>  SSH deploy key path [default: $APP_HOME/.ssh/id_ed25519_agent_studio_deploy]
  --skip-codex-check        Skip Codex runtime verification
  --yes                     Accept defaults for prompts where possible
  --state-file <path>       Override install state file path
  --no-clone                Skip clone if no local checkout exists
  --force-phase <name>      Force a completed phase to run again (repeatable)
  --force-all               Force all completed phases to run again
  -h, --help                Show this help text
USAGE
}

state_bool() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|y|on) printf '%s' "true" ;;
    *) printf '%s' "false" ;;
  esac
}

phase_forced() {
  local phase="$1"
  local forced

  if [[ "$FORCE_ALL" == "1" ]]; then
    return 0
  fi
  for forced in "${FORCE_PHASES[@]:-}"; do
    if [[ "$forced" == "$phase" ]]; then
      return 0
    fi
  done
  return 1
}

maybe_mark_phase_forced() {
  local phase="$1"
  phase_forced "$phase" && record_install_state "${phase}_forced" "true"
  return 0
}

record_install_state() {
  local key="$1"
  local value="${2:-}"
  state_write "$key" "$value"
}

record_step_status() {
  local step="$1"
  local status="$2"
  local reason="${3:-}"

  state_write "${step}_status" "$status"
  if [[ -n "$reason" ]]; then
    state_write "${step}_reason" "$reason"
  else
    state_delete "${step}_reason"
  fi
  if [[ "$status" == "skipped" ]]; then
    state_write "${step}_skipped" "true"
  else
    state_delete "${step}_skipped"
  fi
}

step_status() {
  state_read "${1}_status" ""
}

step_is_complete() {
  [[ "$(step_status "$1")" == "complete" ]]
}

resolve_state_file() {
  if [[ -n "$STATE_FILE_OVERRIDE" ]]; then
    INSTALL_STATE_FILE="$STATE_FILE_OVERRIDE"
  fi
}

load_existing_state() {
  if [[ ! -f "$INSTALL_STATE_FILE" ]]; then
    return 0
  fi

  if [[ -z "$DOMAIN" ]]; then
    DOMAIN="$(state_read domain "")"
  fi
  if [[ -z "$REPO_URL" ]]; then
    REPO_URL="$(state_read repo_url "")"
  fi
  if [[ -z "$REPO_DIR" ]]; then
    REPO_DIR="$(state_read repo_dir "")"
  fi
  if [[ -z "$DEPLOY_KEY_PATH" || "$DEPLOY_KEY_PATH_EXPLICIT" == "0" ]]; then
    DEPLOY_KEY_PATH="$(state_read deploy_key_path "$DEPLOY_KEY_PATH")"
  fi
  if [[ -z "$POSTGRES_DB_PASSWORD" ]]; then
    POSTGRES_DB_PASSWORD="$(state_read postgres_db_password "")"
  fi
  if [[ -z "$SESSION_COOKIE_SECRET" ]]; then
    SESSION_COOKIE_SECRET="$(state_read session_cookie_secret "")"
  fi
  if [[ -z "$DINGTALK_CLIENT_ID" ]]; then
    DINGTALK_CLIENT_ID="$(state_read dingtalk_client_id "")"
  fi
  if [[ -z "$DINGTALK_REDIRECT_URI" ]]; then
    DINGTALK_REDIRECT_URI="$(state_read dingtalk_redirect_uri "")"
  fi
  if [[ -z "$DINGTALK_SCOPE" ]]; then
    DINGTALK_SCOPE="$(state_read dingtalk_scope "openid")"
  fi
}

normalize_legacy_state_defaults() {
  local legacy_repo_dir="$INSTALL_ROOT/app/agent-studio"
  local preferred_deploy_key_path="$APP_HOME/.ssh/id_ed25519_agent_studio_deploy"
  local legacy_root_key_path="/root/.ssh/id_ed25519_agent_studio_deploy"

  if [[ "$REPO_DIR_EXPLICIT" != "1" && "$REPO_DIR" == "$legacy_repo_dir" ]]; then
    if current_dir_is_git_checkout; then
      REPO_DIR="$(pwd -P)"
      record_install_state repo_resolution "migrated_from_legacy_state_to_current_directory_checkout"
    else
      REPO_DIR="$INSTALL_ROOT"
      record_install_state repo_resolution "migrated_from_legacy_state_to_install_root_default"
    fi
  fi

  if [[ "$DEPLOY_KEY_PATH_EXPLICIT" != "1" && "$DEPLOY_KEY_PATH" == "$legacy_root_key_path" ]]; then
    DEPLOY_KEY_PATH="$preferred_deploy_key_path"
    record_install_state deploy_key_path_migrated "true"
  fi
}

detect_default_repo_dir() {
  if [[ "$REPO_DIR_EXPLICIT" == "1" && -n "$REPO_DIR" ]]; then
    return 0
  fi

  if [[ -n "$REPO_DIR" ]]; then
    return 0
  fi

  if current_dir_is_git_checkout; then
    REPO_DIR="$(pwd -P)"
    record_install_state repo_resolution "current_directory_checkout"
  else
    REPO_DIR="$INSTALL_ROOT"
    record_install_state repo_resolution "install_root_default"
  fi
}

refresh_paths_from_repo_dir() {
  refresh_app_paths
}

repo_checkout_is_usable() {
  [[ -d "$REPO_DIR" ]] || return 1
  git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  [[ -f "$REPO_DIR/agent-api/package.json" ]] || return 1
  [[ -f "$REPO_DIR/agent-ui/package.json" ]] || return 1
  return 0
}

repo_dir_has_entries() {
  if [[ ! -d "$1" ]]; then
    return 1
  fi
  [[ -n "$(find "$1" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]]
}

prompt_with_default() {
  local __var_name="$1"
  local prompt="$2"
  local default="$3"
  if [[ "$ASSUME_YES" == "1" ]]; then
    printf -v "$__var_name" '%s' "$default"
    return 0
  fi
  prompt_input "$__var_name" "$prompt" "$default"
}

prompt_optional() {
  local __var_name="$1"
  local prompt="$2"
  local default="${3:-}"
  if [[ "$ASSUME_YES" == "1" ]]; then
    printf -v "$__var_name" '%s' "$default"
    return 0
  fi
  prompt_input "$__var_name" "$prompt" "$default"
}

confirm_or_default() {
  local prompt="$1"
  local default="${2:-y}"
  if [[ "$ASSUME_YES" == "1" ]]; then
    [[ "$(printf '%s' "$default" | tr '[:upper:]' '[:lower:]')" =~ ^(y|yes)$ ]]
    return
  fi
  prompt_confirm "$prompt" "$default"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        DOMAIN="$2"
        shift 2
        ;;
      --repo-url)
        REPO_URL="$2"
        shift 2
        ;;
      --repo-dir)
        REPO_DIR="$2"
        REPO_DIR_EXPLICIT=1
        shift 2
        ;;
      --deploy-key-path)
        DEPLOY_KEY_PATH="$2"
        DEPLOY_KEY_PATH_EXPLICIT=1
        shift 2
        ;;
      --skip-codex-check)
        SKIP_CODEX_CHECK=1
        shift
        ;;
      --yes)
        ASSUME_YES=1
        shift
        ;;
      --state-file)
        STATE_FILE_OVERRIDE="$2"
        shift 2
        ;;
      --no-clone)
        RUN_CLONE=0
        shift
        ;;
      --force-phase)
        FORCE_PHASES+=("$2")
        shift 2
        ;;
      --force-all)
        FORCE_ALL=1
        shift
        ;;
      -h|--help)
        SHOW_HELP=1
        shift
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

prompt_for_missing_values() {
  if [[ -z "$DOMAIN" ]]; then
    prompt_with_default DOMAIN "Enter the public domain for Caddy" ""
  fi

  if ! repo_checkout_is_usable && [[ -z "$REPO_URL" ]]; then
    prompt_optional REPO_URL "Enter the Git repository URL only if clone is needed" ""
  fi

  record_install_state domain "$DOMAIN"
  record_install_state repo_url "$REPO_URL"
}

summarize_configuration() {
  log_step "Installer configuration"
  log_info "install root: $INSTALL_ROOT"
  log_info "state file: $INSTALL_STATE_FILE"
  log_info "app user: $APP_USER"
  log_info "app home: $APP_HOME"
  log_info "repo dir: $REPO_DIR"
  log_info "domain: ${DOMAIN:-<unset>}"
  log_info "repo url: $(redact_url "$REPO_URL")"
  log_info "deploy key path: $DEPLOY_KEY_PATH"
  log_info "skip codex check: $(state_bool "$SKIP_CODEX_CHECK")"
}

bootstrap_status_value() {
  local key="$1"
  local default="${2:-pending}"
  local value

  value="$(state_read "$key" "$default")"
  printf '%s' "${value:-$default}"
}

read_env_value_if_exists() {
  local env_file="$1"
  local key="$2"

  [[ -f "$env_file" ]] || return 0
  python3 - "$env_file" "$key" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]

for raw_line in path.read_text().splitlines():
    stripped = raw_line.strip()
    if not stripped or stripped.startswith("#") or "=" not in raw_line:
        continue
    current_key, value = raw_line.split("=", 1)
    if current_key.strip() == key:
        print(value.strip())
        break
PY
}

ensure_state_defaults() {
  record_install_state install_root "$INSTALL_ROOT"
  record_install_state install_state_file "$INSTALL_STATE_FILE"
  record_install_state app_user "$APP_USER"
  record_install_state app_home "$APP_HOME"
  record_install_state repo_dir "$REPO_DIR"
  record_install_state app_repo_dir "$APP_REPO_DIR"
  record_install_state app_api_dir "$APP_API_DIR"
  record_install_state app_ui_dir "$APP_UI_DIR"
  record_install_state backend_env_file "$BACKEND_ENV_FILE"
  record_install_state frontend_env_file "$FRONTEND_ENV_FILE"
  record_install_state deploy_key_path "$DEPLOY_KEY_PATH"
  record_install_state postgres_db_name "$POSTGRES_DB_NAME"
  record_install_state postgres_db_user "$POSTGRES_DB_USER"
  record_install_state postgres_host "$POSTGRES_HOST"
  record_install_state postgres_port "$POSTGRES_PORT"
}

ensure_owned_path() {
  local path="$1"
  local label="$2"
  if apply_app_user_ownership "$path"; then
    record_install_state "${label}_ownership_status" "complete"
    return 0
  fi
  record_install_state "${label}_ownership_status" "pending"
  return 1
}

ensure_app_user() {
  if step_is_complete app_user && ! phase_forced app_user; then
    return 0
  fi
  maybe_mark_phase_forced app_user

  if id "$APP_USER" >/dev/null 2>&1; then
    record_step_status app_user complete "app user already exists"
    return 0
  fi

  useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
  record_step_status app_user complete "created app user"
}

ensure_base_directories() {
  if step_is_complete base_directories && ! phase_forced base_directories; then
    return 0
  fi
  maybe_mark_phase_forced base_directories

  local dirs=(
    "$INSTALL_ROOT"
    "$STATE_DIR"
    "$DATA_ROOT"
    "$WORKSPACE_ROOT"
    "$SESSION_UPLOAD_ROOT"
    "$KNOWLEDGE_SET_ROOT"
    "$(dirname "$INSTALL_STATE_FILE")"
    "$(dirname "$PM2_ECOSYSTEM_FILE")"
  )
  local dir

  for dir in "${dirs[@]}"; do
    ensure_dir "$dir"
  done

  ensure_owned_path "$INSTALL_ROOT" install_root || true
  ensure_owned_path "$DATA_ROOT" data_root || true
  ensure_owned_path "$WORKSPACE_ROOT" workspace_root || true
  ensure_owned_path "$SESSION_UPLOAD_ROOT" session_upload_root || true
  ensure_owned_path "$KNOWLEDGE_SET_ROOT" knowledge_set_root || true
  ensure_owned_path "$APP_HOME" app_home || true

  record_step_status base_directories complete "base directories exist"
}

ensure_system_dependencies() {
  if step_is_complete system_dependencies && ! phase_forced system_dependencies; then
    return 0
  fi
  maybe_mark_phase_forced system_dependencies

  if [[ ! -f /etc/os-release ]] || ! grep -qi 'ubuntu' /etc/os-release; then
    record_step_status system_dependencies pending "automatic dependency installation currently targets Ubuntu"
    return 0
  fi

  ensure_ubuntu_apt_packages \
    sudo git curl ca-certificates build-essential python3 openssl unzip \
    gnupg debian-keyring debian-archive-keyring apt-transport-https \
    postgresql postgresql-contrib

  if ! command_exists caddy; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi

  ensure_nodesource_nodejs
  ensure_global_pm2

  command_exists git || die "git install failed"
  command_exists sudo || die "sudo install failed"
  command_exists curl || die "curl install failed"
  command_exists python3 || die "python3 install failed"
  command_exists psql || die "postgresql client install failed"
  command_exists caddy || die "caddy install failed"
  command_exists node || die "node install failed"
  command_exists npm || die "npm install failed"
  command_exists pm2 || die "pm2 install failed"

  record_step_status system_dependencies complete "system dependencies are installed"
}

ensure_deploy_key() {
  DEPLOY_KEY_SAFE_CHECKPOINT=0
  DEPLOY_KEY_CONTINUE_TO_CLONE=0

  if repo_checkout_is_usable; then
    record_step_status deploy_key complete "local repository checkout already exists"
    return 0
  fi

  if step_is_complete deploy_key && ! phase_forced deploy_key; then
    if [[ "$(state_read_bool deploy_key_guidance_shown false)" == "true" ]]; then
      if confirm_or_default "Deploy key guidance was already shown. Continue to repository clone now?" "y"; then
        DEPLOY_KEY_CONTINUE_TO_CLONE=1
      else
        DEPLOY_KEY_SAFE_CHECKPOINT=1
      fi
    fi
    return 0
  fi
  maybe_mark_phase_forced deploy_key

  if [[ -f "$DEPLOY_KEY_PATH" && -f "$DEPLOY_KEY_PATH.pub" ]]; then
    record_step_status deploy_key complete "deploy key already present"
    if [[ "$(state_read_bool deploy_key_guidance_shown false)" == "true" ]]; then
      DEPLOY_KEY_CONTINUE_TO_CLONE=1
    fi
    return 0
  fi

  if ! confirm_or_default "Generate an SSH deploy key for private repo access now?" "n"; then
    record_step_status deploy_key skipped "operator skipped deploy key generation"
    return 0
  fi

  ensure_dir "$(dirname "$DEPLOY_KEY_PATH")"
  ssh-keygen -t ed25519 -f "$DEPLOY_KEY_PATH" -N "" -C "agent-studio deploy key" >/dev/null
  ensure_secure_file_mode "$DEPLOY_KEY_PATH" 600
  ensure_secure_file_mode "$DEPLOY_KEY_PATH.pub" 644
  record_step_status deploy_key complete "generated deploy key"
  record_install_state deploy_key_guidance_shown "true"
  log_step "Add this public key to GitHub as a read-only deploy key"
  log_info "Public key path: $DEPLOY_KEY_PATH.pub"
  cat "$DEPLOY_KEY_PATH.pub"
  printf '\n'
  DEPLOY_KEY_SAFE_CHECKPOINT=1
}

backup_existing_repo_dir() {
  local backup_dir="$REPO_DIR.forced-backup-$(date '+%Y%m%d%H%M%S')"
  [[ -e "$REPO_DIR" ]] || return 0
  mv "$REPO_DIR" "$backup_dir"
  record_install_state repo_clone_backup "$backup_dir"
}

attempt_clone() {
  if repo_checkout_is_usable && ! phase_forced repo_clone; then
    record_step_status repo_clone complete "repository already available locally"
    return 0
  fi
  maybe_mark_phase_forced repo_clone

  if repo_checkout_is_usable; then
    record_step_status repo_clone complete "repository already available locally"
    return 0
  fi

  if [[ "$RUN_CLONE" != "1" ]]; then
    record_step_status repo_clone skipped "clone disabled and no local checkout exists"
    return 0
  fi

  if [[ -z "$REPO_URL" ]]; then
    record_step_status repo_clone pending "repository URL is missing"
    return 0
  fi

  if ! confirm_or_default "Attempt to clone the repository now?" "y"; then
    record_step_status repo_clone skipped "operator deferred clone"
    return 0
  fi

  if repo_dir_has_entries "$REPO_DIR"; then
    if phase_forced repo_clone; then
      backup_existing_repo_dir
    else
      record_step_status repo_clone pending "target directory exists and is not empty"
      return 0
    fi
  fi

  ensure_dir "$(dirname "$REPO_DIR")"
  if [[ -f "$DEPLOY_KEY_PATH" ]]; then
    GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY_PATH -o IdentitiesOnly=yes" git clone "$REPO_URL" "$REPO_DIR"
  else
    git clone "$REPO_URL" "$REPO_DIR"
  fi
  ensure_owned_path "$REPO_DIR" repo_clone || true
  refresh_paths_from_repo_dir
  record_step_status repo_clone complete "repository cloned"
}

ensure_postgres_setup() {
  if step_is_complete postgres && ! phase_forced postgres; then
    return 0
  fi
  maybe_mark_phase_forced postgres

  ensure_service_started postgresql
  require_command psql

  [[ -n "$POSTGRES_DB_PASSWORD" ]] || POSTGRES_DB_PASSWORD="$(generate_random_secret 24)"
  record_install_state postgres_db_password "$POSTGRES_DB_PASSWORD"

  if [[ ! "$POSTGRES_DB_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    record_step_status postgres pending "invalid PostgreSQL role name"
    return 0
  fi
  if [[ ! "$POSTGRES_DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    record_step_status postgres pending "invalid PostgreSQL database name"
    return 0
  fi

  local escaped_password
  escaped_password="${POSTGRES_DB_PASSWORD//\'/\'\'}"

  sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$POSTGRES_DB_USER') THEN
    CREATE ROLE $POSTGRES_DB_USER LOGIN PASSWORD '$escaped_password';
  ELSE
    ALTER ROLE $POSTGRES_DB_USER WITH LOGIN PASSWORD '$escaped_password';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE $POSTGRES_DB_NAME OWNER $POSTGRES_DB_USER'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB_NAME')\gexec
ALTER DATABASE $POSTGRES_DB_NAME OWNER TO $POSTGRES_DB_USER;
SQL

  record_install_state postgres_user_status complete
  record_install_state postgres_db_status complete
  record_install_state postgres_database_url "postgresql://$POSTGRES_DB_USER:$POSTGRES_DB_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB_NAME?schema=public"
  record_step_status postgres complete "PostgreSQL role and database are ready"
}

copy_template_file() {
  local template="$1"
  local destination="$2"
  ensure_dir "$(dirname "$destination")"
  cp "$template" "$destination"
  ensure_secure_file_mode "$destination" 600
}

render_caddy_config() {
  local template="$1"
  local destination="$2"
  local domain="$3"
  local ui_root="$4"
  local upstream_host="${5:-127.0.0.1}"
  local upstream_port="${6:-8787}"

  ensure_dir "$(dirname "$destination")"
  python3 - "$template" "$destination" "$domain" "$ui_root" "$upstream_host" "$upstream_port" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
domain = sys.argv[3]
ui_root = sys.argv[4]
upstream_host = sys.argv[5]
upstream_port = sys.argv[6]
destination.write_text(
    template
    .replace("{$DOMAIN}", domain)
    .replace("{$UI_DIST_ROOT}", ui_root)
    .replace("{$CADDY_UPSTREAM_HOST}", upstream_host)
    .replace("{$CADDY_UPSTREAM_PORT}", upstream_port)
)
PY
}

ensure_env_files() {
  if step_is_complete env_files && ! phase_forced env_files; then
    return 0
  fi
  maybe_mark_phase_forced env_files

  if ! repo_checkout_is_usable; then
    record_step_status env_files pending "repository checkout is not ready yet"
    record_install_state backend_env_status pending
    record_install_state frontend_env_status pending
    return 0
  fi

  local backend_template="$script_dir/../templates/agent-api.env.template"
  local frontend_template="$script_dir/../templates/agent-ui.env.production.template"
  [[ -f "$backend_template" ]] || { record_step_status env_files pending "backend env template is missing"; return 0; }
  [[ -f "$frontend_template" ]] || { record_step_status env_files pending "frontend env template is missing"; return 0; }

  if phase_forced env_files || [[ ! -f "$BACKEND_ENV_FILE" ]]; then
    copy_template_file "$backend_template" "$BACKEND_ENV_FILE"
  fi
  if phase_forced env_files || [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
    copy_template_file "$frontend_template" "$FRONTEND_ENV_FILE"
  fi

  [[ -n "$SESSION_COOKIE_SECRET" ]] || SESSION_COOKIE_SECRET="$(generate_random_secret 32)"
  record_install_state session_cookie_secret "$SESSION_COOKIE_SECRET"

  local database_url="postgresql://$POSTGRES_DB_USER:$POSTGRES_DB_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB_NAME?schema=public"
  write_env_key_value "$BACKEND_ENV_FILE" DATABASE_URL "$database_url"
  write_env_key_value "$BACKEND_ENV_FILE" DEFAULT_MODEL "$DEFAULT_MODEL"
  write_env_key_value "$BACKEND_ENV_FILE" DEFAULT_REASONING_EFFORT "$DEFAULT_REASONING_EFFORT"
  write_env_key_value "$BACKEND_ENV_FILE" DEFAULT_WORKSPACE "$WORKSPACE_ROOT"
  write_env_key_value "$BACKEND_ENV_FILE" WORKSPACE_WHITELIST "$WORKSPACE_ROOT"
  write_env_key_value "$BACKEND_ENV_FILE" UPLOAD_TEMP_ROOT "$SESSION_UPLOAD_ROOT"
  write_env_key_value "$BACKEND_ENV_FILE" KNOWLEDGE_SET_STORAGE_ROOT "$KNOWLEDGE_SET_ROOT"
  write_env_key_value "$BACKEND_ENV_FILE" SESSION_COOKIE_SECRET "$SESSION_COOKIE_SECRET"
  write_env_key_value "$BACKEND_ENV_FILE" SESSION_COOKIE_SECURE true
  if [[ -n "$DINGTALK_REDIRECT_URI" ]]; then
    write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_REDIRECT_URI "$DINGTALK_REDIRECT_URI"
  elif [[ -n "$DOMAIN" ]]; then
    write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_REDIRECT_URI "https://$DOMAIN/auth/dingtalk/callback"
  fi

  write_env_key_value "$FRONTEND_ENV_FILE" VITE_AGENT_API_BASE ""
  write_env_key_value "$FRONTEND_ENV_FILE" VITE_AGENT_API_TOKEN ""

  ensure_owned_path "$BACKEND_ENV_FILE" backend_env || true
  ensure_owned_path "$FRONTEND_ENV_FILE" frontend_env || true
  ensure_secure_file_mode "$BACKEND_ENV_FILE" 600
  ensure_secure_file_mode "$FRONTEND_ENV_FILE" 600

  record_install_state backend_env_mode 600
  record_install_state frontend_env_mode 600
  record_install_state backend_env_status complete
  record_install_state frontend_env_status complete
  record_step_status env_files complete "environment files rendered and populated"
}

ensure_integration_bootstrap() {
  if step_is_complete integration_bootstrap && ! phase_forced integration_bootstrap; then
    return 0
  fi
  maybe_mark_phase_forced integration_bootstrap

  if ! step_is_complete env_files; then
    record_step_status integration_bootstrap pending "environment files are not ready yet"
    return 0
  fi

  local default_redirect_uri=""
  local input_value=""
  local dingtalk_status="skipped"
  local codex_status="local_auth"
  local zendesk_status="skipped"
  local existing_dingtalk_client_id=""
  local existing_dingtalk_client_secret=""
  local existing_dingtalk_redirect_uri=""
  local existing_dingtalk_scope=""

  if [[ -n "$DOMAIN" ]]; then
    default_redirect_uri="https://$DOMAIN/auth/dingtalk/callback"
  fi
  existing_dingtalk_client_id="$(read_env_value_if_exists "$BACKEND_ENV_FILE" DINGTALK_CLIENT_ID)"
  existing_dingtalk_client_secret="$(read_env_value_if_exists "$BACKEND_ENV_FILE" DINGTALK_CLIENT_SECRET)"
  existing_dingtalk_redirect_uri="$(read_env_value_if_exists "$BACKEND_ENV_FILE" DINGTALK_REDIRECT_URI)"
  existing_dingtalk_scope="$(read_env_value_if_exists "$BACKEND_ENV_FILE" DINGTALK_SCOPE)"

  if [[ -z "$DINGTALK_CLIENT_ID" ]]; then
    DINGTALK_CLIENT_ID="$existing_dingtalk_client_id"
  fi
  if [[ -z "$DINGTALK_CLIENT_SECRET" ]]; then
    DINGTALK_CLIENT_SECRET="$existing_dingtalk_client_secret"
  fi
  if [[ -z "$DINGTALK_REDIRECT_URI" ]]; then
    DINGTALK_REDIRECT_URI="$existing_dingtalk_redirect_uri"
  fi
  if [[ -z "$DINGTALK_SCOPE" ]]; then
    DINGTALK_SCOPE="${existing_dingtalk_scope:-openid}"
  fi

  if [[ -z "$DINGTALK_REDIRECT_URI" && -n "$default_redirect_uri" ]]; then
    DINGTALK_REDIRECT_URI="$default_redirect_uri"
  fi

  if [[ -n "$DINGTALK_CLIENT_ID" && -n "$DINGTALK_CLIENT_SECRET" ]]; then
    write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_CLIENT_ID "$DINGTALK_CLIENT_ID"
    write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_CLIENT_SECRET "$DINGTALK_CLIENT_SECRET"
    if [[ -n "$DINGTALK_REDIRECT_URI" ]]; then
      write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_REDIRECT_URI "$DINGTALK_REDIRECT_URI"
    fi
    if [[ -n "$DINGTALK_SCOPE" ]]; then
      write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_SCOPE "$DINGTALK_SCOPE"
    fi
    dingtalk_status="configured"
  else
    if confirm_or_default "Configure DingTalk OAuth now?" "y"; then
      prompt_optional DINGTALK_CLIENT_ID "Enter DINGTALK_CLIENT_ID" "$DINGTALK_CLIENT_ID"
      if [[ -n "$DINGTALK_CLIENT_ID" ]]; then
        prompt_secret DINGTALK_CLIENT_SECRET "Enter DINGTALK_CLIENT_SECRET"
        if [[ -z "$DINGTALK_CLIENT_SECRET" ]]; then
          DINGTALK_CLIENT_SECRET="$existing_dingtalk_client_secret"
        fi
      fi
      prompt_optional DINGTALK_REDIRECT_URI "Enter DINGTALK_REDIRECT_URI" "${DINGTALK_REDIRECT_URI:-$default_redirect_uri}"
      prompt_optional DINGTALK_SCOPE "Enter DINGTALK_SCOPE" "${DINGTALK_SCOPE:-openid}"

      if [[ -n "$DINGTALK_CLIENT_ID" && -n "$DINGTALK_CLIENT_SECRET" ]]; then
        write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_CLIENT_ID "$DINGTALK_CLIENT_ID"
        write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_CLIENT_SECRET "$DINGTALK_CLIENT_SECRET"
        write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_REDIRECT_URI "$DINGTALK_REDIRECT_URI"
        write_env_key_value "$BACKEND_ENV_FILE" DINGTALK_SCOPE "$DINGTALK_SCOPE"
        dingtalk_status="configured"
      else
        dingtalk_status="skipped"
      fi
    fi
  fi
  record_install_state dingtalk_client_id "$DINGTALK_CLIENT_ID"
  record_install_state dingtalk_redirect_uri "$DINGTALK_REDIRECT_URI"
  record_install_state dingtalk_scope "$DINGTALK_SCOPE"
  record_install_state dingtalk_bootstrap_status "$dingtalk_status"

  if confirm_or_default "Record OpenAI/Codex install hints now? (runtime still prefers the server user's local Codex auth)" "n"; then
    input_value="$(state_read openai_codex_provider "openai_codex")"
    prompt_optional input_value "Enter the OpenAI/Codex provider label (informational)" "$input_value"
    record_install_state openai_codex_provider "$input_value"

    input_value="$(state_read openai_codex_base_url "")"
    prompt_optional input_value "Enter the OpenAI/Codex base URL (informational)" "$input_value"
    record_install_state openai_codex_base_url "$input_value"

    input_value="$(state_read openai_codex_default_model "$DEFAULT_MODEL")"
    prompt_optional input_value "Enter the default model to persist" "$input_value"
    if [[ -n "$input_value" ]]; then
      DEFAULT_MODEL="$input_value"
      write_env_key_value "$BACKEND_ENV_FILE" DEFAULT_MODEL "$DEFAULT_MODEL"
    fi
    record_install_state openai_codex_default_model "$input_value"
    codex_status="noted"
  fi
  record_install_state openai_codex_bootstrap_status "$codex_status"

  if confirm_or_default "Record a Zendesk site URL now? (email/token remain configurable later in the admin UI)" "n"; then
    input_value="$(state_read zendesk_site_url "")"
    prompt_optional input_value "Enter the Zendesk site URL" "$input_value"
    if [[ -n "$input_value" ]]; then
      record_install_state zendesk_site_url "$input_value"
      zendesk_status="site_recorded"
    fi
  fi
  record_install_state zendesk_bootstrap_status "$zendesk_status"

  record_step_status integration_bootstrap complete "integration bootstrap prompts completed"
}

ensure_caddy_config() {
  if step_is_complete caddy_config && ! phase_forced caddy_config; then
    return 0
  fi
  maybe_mark_phase_forced caddy_config

  local template="$script_dir/../templates/Caddyfile.template"
  [[ -f "$template" ]] || { record_step_status caddy_config pending "Caddy template is missing"; return 0; }
  if [[ -z "$DOMAIN" ]]; then
    record_step_status caddy_config pending "domain is missing"
    return 0
  fi

  render_caddy_config "$template" "$CADDY_CONFIG_FILE" "$DOMAIN" "$APP_UI_DIR/dist" "127.0.0.1" "8787"
  if command_exists caddy; then
    caddy validate --config "$CADDY_CONFIG_FILE" >/dev/null 2>&1 || true
    if command_exists systemctl; then
      systemctl reload caddy >/dev/null 2>&1 || true
    fi
  fi
  record_step_status caddy_config complete "Caddy config rendered"
}

run_first_deploy() {
  if step_is_complete first_deploy && ! phase_forced first_deploy; then
    return 0
  fi
  maybe_mark_phase_forced first_deploy

  if ! repo_checkout_is_usable; then
    record_step_status first_deploy pending "repository checkout is not ready yet"
    return 0
  fi
  if ! step_is_complete env_files; then
    record_step_status first_deploy pending "environment files are not ready yet"
    return 0
  fi
  if ! step_is_complete system_dependencies; then
    record_step_status first_deploy pending "system dependencies are not ready yet"
    return 0
  fi
  if ! step_is_complete postgres; then
    record_step_status first_deploy pending "PostgreSQL is not ready yet"
    return 0
  fi

  bash "$script_dir/deploy-agent-studio.sh" --repo-dir "$REPO_DIR" --skip-git-pull

  if [[ -f "$APP_API_DIR/dist/index.js" && -f "$APP_UI_DIR/dist/index.html" ]]; then
    record_step_status first_deploy complete "initial deploy completed"
  else
    record_step_status first_deploy pending "deploy finished without expected build artifacts"
  fi
}

ensure_pm2_start() {
  if step_is_complete pm2_start && ! phase_forced pm2_start; then
    return 0
  fi
  maybe_mark_phase_forced pm2_start

  if ! step_is_complete first_deploy; then
    record_step_status pm2_start pending "first deploy is not complete yet"
    return 0
  fi

  env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/tmp/agent-studio-pm2-startup.log 2>&1 || true
  run_as_app_user_shell "pm2 save"
  if run_as_app_user_shell "pm2 status '$PM2_APP_NAME' >/dev/null 2>&1"; then
    record_step_status pm2_start complete "PM2 app is running"
  else
    record_step_status pm2_start pending "PM2 app is not running yet"
  fi
}

ensure_codex_verification() {
  if step_is_complete codex_runtime_check && ! phase_forced codex_runtime_check; then
    return 0
  fi
  maybe_mark_phase_forced codex_runtime_check

  if [[ "$(state_bool "$SKIP_CODEX_CHECK")" == "true" ]]; then
    record_step_status codex_runtime_check skipped "operator requested skip-codex-check"
    return 0
  fi

  if ! step_is_complete first_deploy; then
    record_step_status codex_runtime_check pending "first deploy is not complete yet"
    return 0
  fi

  if run_as_app_user_shell "cd '$APP_API_DIR' && node --input-type=module <<'EON'
import { CodexRuntime } from './dist/codex-runtime.js';
const runtime = new CodexRuntime();
await runtime.validateProvider({ model: 'gpt-5.4', reasoningEffort: 'high' });
console.log('codex runtime ok');
EON"; then
    record_step_status codex_runtime_check complete "Codex runtime validation passed"
  else
    record_step_status codex_runtime_check pending "Codex runtime validation failed"
  fi
}

render_phase_summary() {
  log_step "Install state summary"
  log_info "app user: $(step_status app_user)"
  log_info "base directories: $(step_status base_directories)"
  log_info "system dependencies: $(step_status system_dependencies)"
  log_info "repo clone: $(step_status repo_clone)"
  log_info "postgres: $(step_status postgres)"
  log_info "backend env: $(state_read backend_env_status pending)"
  log_info "frontend env: $(state_read frontend_env_status pending)"
  log_info "integration bootstrap: $(step_status integration_bootstrap)"
  log_info "dingtalk auth: $(bootstrap_status_value dingtalk_bootstrap_status)"
  log_info "openai/codex install hint: $(bootstrap_status_value openai_codex_bootstrap_status)"
  log_info "zendesk site hint: $(bootstrap_status_value zendesk_bootstrap_status)"
  log_info "caddy config: $(step_status caddy_config)"
  log_info "first deploy: $(step_status first_deploy)"
  log_info "pm2 start: $(step_status pm2_start)"
  log_info "codex runtime: $(step_status codex_runtime_check)"
}

follow_up_message_for_step() {
  case "$1" in
    system_dependencies)
      printf '%s' "Ensure the host is Ubuntu and rerun as root so the installer can install git, nodejs, pm2, postgresql, and caddy."
      ;;
    repo_clone)
      printf '%s' "If the current directory already contains the repository, rerun from that checkout; otherwise provide a valid repo URL and rerun."
      ;;
    postgres)
      printf '%s' "Check PostgreSQL service health and rerun; the installer will create the app role and database automatically."
      ;;
    env_files)
      printf '%s' "Ensure the repository checkout is available, then rerun so the installer can render env files."
      ;;
    integration_bootstrap)
      printf '%s' "Rerun after env files are rendered if you want the installer to prompt for DingTalk, OpenAI/Codex hints, and Zendesk site metadata."
      ;;
    caddy_config)
      printf '%s' "Provide a public domain, then rerun so the installer can render the Caddy config."
      ;;
    first_deploy)
      printf '%s' "Rerun after dependencies, PostgreSQL, and env files are ready so the installer can run the first deployment."
      ;;
    pm2_start)
      printf '%s' "Rerun after the first deployment succeeds so the installer can register PM2 startup and verify the app is running."
      ;;
    codex_runtime_check)
      printf '%s' "Prepare the server user's default Codex authentication context and rerun, or pass --skip-codex-check."
      ;;
    *)
      printf '%s' "Rerun after resolving the recorded prerequisite."
      ;;
  esac
}

print_follow_up_actions() {
  local phases=(app_user base_directories system_dependencies deploy_key repo_clone postgres env_files integration_bootstrap caddy_config first_deploy pm2_start codex_runtime_check)
  local phase status message printed=0

  log_step "Operator follow-up actions"
  for phase in "${phases[@]}"; do
    status="$(step_status "$phase")"
    case "$status" in
      complete|"") continue ;;
    esac
    message="$(follow_up_message_for_step "$phase")"
    printf '[%s] FOLLOW-UP %s: %s\n' "$(log_ts)" "$phase" "$message"
    if [[ -n "$(state_read "${phase}_reason" "")" ]]; then
      printf '[%s] DETAIL %s: %s\n' "$(log_ts)" "$phase" "$(state_read "${phase}_reason" "")"
    fi
    printed=1
  done
  if [[ "$printed" -eq 0 ]]; then
    log_info "No pending or skipped phases remain."
  fi
}

finalize_installation() {
  local required_steps=(app_user base_directories system_dependencies repo_clone postgres env_files integration_bootstrap caddy_config first_deploy pm2_start codex_runtime_check)
  local step
  for step in "${required_steps[@]}"; do
    if [[ "$(step_status "$step")" != "complete" ]]; then
      record_install_state installer_complete false
      return 0
    fi
  done
  record_install_state installer_complete true
}

main() {
  parse_args "$@"
  resolve_state_file

  if [[ "$SHOW_HELP" == "1" ]]; then
    usage
    exit 0
  fi

  require_root_shell
  load_existing_state
  normalize_legacy_state_defaults
  detect_default_repo_dir
  refresh_paths_from_repo_dir
  prompt_for_missing_values
  ensure_state_defaults
  summarize_configuration

  ensure_app_user
  ensure_base_directories
  ensure_system_dependencies
  ensure_deploy_key

  if [[ "$DEPLOY_KEY_SAFE_CHECKPOINT" == "1" && "$DEPLOY_KEY_CONTINUE_TO_CLONE" != "1" ]] && ! repo_checkout_is_usable; then
    record_step_status repo_clone pending "deploy key guidance shown; rerun to continue clone"
    render_phase_summary
    print_follow_up_actions
    finalize_installation
    exit 0
  fi

  attempt_clone
  refresh_paths_from_repo_dir
  ensure_postgres_setup
  ensure_env_files
  ensure_integration_bootstrap
  ensure_caddy_config
  run_first_deploy
  ensure_pm2_start
  ensure_codex_verification
  render_phase_summary
  print_follow_up_actions
  finalize_installation
}

main "$@"
