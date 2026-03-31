#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

# INSTALL_STATE_FILE defaults to /usr/local/agent-studio/install-state.json in scripts/lib/common.sh.

DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-}"
REPO_DIR="${REPO_DIR:-$APP_REPO_DIR}"
DEPLOY_KEY_PATH="${DEPLOY_KEY_PATH:-$HOME/.ssh/id_ed25519_agent_studio_deploy}"
SKIP_CODEX_CHECK="${SKIP_CODEX_CHECK:-0}"
ASSUME_YES="${ASSUME_YES:-0}"
STATE_FILE_OVERRIDE="${STATE_FILE_OVERRIDE:-}"
REPO_DIR_EXPLICIT=0
DEPLOY_KEY_PATH_EXPLICIT=0
RUN_CLONE=1
SHOW_HELP=0
FORCE_ALL=0
DEPLOY_KEY_SAFE_CHECKPOINT=0
DEPLOY_KEY_CONTINUE_TO_CLONE=0
declare -a FORCE_PHASES=()
POSTGRES_DB_NAME="${POSTGRES_DB_NAME:-agent_studio}"
POSTGRES_DB_USER="${POSTGRES_DB_USER:-agentstudio}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Resumable Ubuntu installer for Agent Studio.

Options:
  --domain <name>           Public domain to configure for Caddy
  --repo-url <url>          Private Git repository clone URL
  --repo-dir <path>         Target repository directory [default: $APP_REPO_DIR]
  --deploy-key-path <path>  SSH deploy key path [default: $HOME/.ssh/id_ed25519_agent_studio_deploy]
  --skip-codex-check        Mark Codex runtime verification as skipped
  --yes                     Use defaults for prompts where possible
  --state-file <path>       Override install state file path
  --no-clone                Skip the clone attempt and record it as skipped
  --force-phase <name>      Force a completed phase to run again (repeatable)
  --force-all               Force all completed phases to run again
  -h, --help                Show this help text

This installer is resumable. Re-run it to continue from the last recorded state
after resolving any skipped or pending prerequisites.
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
  if phase_forced "$phase"; then
    record_install_state "${phase}_forced" "true"
  fi
}

follow_up_message_for_step() {
  case "$1" in
    app_user)
      printf '%s' "Create or confirm the $APP_USER user, then rerun with root privileges if creation is still needed."
      ;;
    base_directories)
      printf '%s' "Create the install directories under $INSTALL_ROOT, or rerun as a user allowed to create them."
      ;;
    deploy_key)
      printf '%s' "Generate the deploy key at $DEPLOY_KEY_PATH, add the public key to GitHub, then rerun."
      ;;
    repo_clone)
      printf '%s' "Provide a valid repository URL and rerun; use --force-phase repo_clone to overwrite an existing target directory intentionally."
      ;;
    postgres)
      printf '%s' "Install PostgreSQL, create the $POSTGRES_DB_USER role and $POSTGRES_DB_NAME database, then rerun."
      ;;
    env_files)
      printf '%s' "Ensure the repository is present, then rerun; use --force-phase env_files to overwrite existing env files intentionally."
      ;;
    caddy_config)
      printf '%s' "Provide --domain and rerun; use --force-phase caddy_config to rewrite the Caddy config intentionally."
      ;;
    first_deploy)
      printf '%s' "Install the build toolchain and rerun after the deploy command can actually produce build artifacts; use --force-phase first_deploy to retry intentionally."
      ;;
    pm2_start)
      printf '%s' "Install pm2 and ensure first deploy is complete, then rerun; use --force-phase pm2_start to retry intentionally."
      ;;
    codex_runtime_check)
      printf '%s' "Install the codex CLI or pass --skip-codex-check, then rerun."
      ;;
    *)
      printf '%s' "Rerun after resolving the recorded prerequisite."
      ;;
  esac
}

ensure_owned_path() {
  local path="$1"
  local label="$2"

  if apply_app_user_ownership "$path"; then
    record_install_state "${label}_owner" "$APP_USER"
    record_install_state "${label}_ownership_status" "complete"
    return 0
  fi

  record_install_state "${label}_ownership_status" "pending"
  record_install_state "${label}_ownership_reason" "ownership should be applied by $APP_USER or root"
  return 1
}

record_install_state() {
  local key="$1"
  local value="${2:-}"
  state_write "$key" "$value"
}

record_install_json() {
  local key="$1"
  local value="${2:-null}"
  state_write_json "$key" "$value"
}

record_step_status() {
  local step="$1"
  local status="$2"
  local reason="${3:-}"

  state_write "${step}_status" "$status"
  if [[ -n "$reason" ]]; then
    state_write "${step}_reason" "$reason"
  fi
  if [[ "$status" == "skipped" ]]; then
    state_write "${step}_skipped" "true"
  fi
}

step_status() {
  state_read "${1}_status" ""
}

step_is_complete() {
  [[ "$(step_status "$1")" == "complete" ]]
}

ensure_state_defaults() {
  record_install_state script_version "task2-resumable-installer"
  record_install_state install_root "$INSTALL_ROOT"
  record_install_state install_state_file "$INSTALL_STATE_FILE"
  record_install_state resume_enabled "true"
  record_install_state app_user "$APP_USER"
  record_install_state app_home "$APP_HOME"
  record_install_state repo_dir "$REPO_DIR"
  record_install_state deploy_key_path "$DEPLOY_KEY_PATH"
  record_install_state domain "$DOMAIN"
  record_install_state repo_url "$REPO_URL"
  record_install_state skip_codex_check "$(state_bool "$SKIP_CODEX_CHECK")"
  record_install_state postgres_db_name "$POSTGRES_DB_NAME"
  record_install_state postgres_db_user "$POSTGRES_DB_USER"
  record_install_state postgres_host "$POSTGRES_HOST"
  record_install_state postgres_port "$POSTGRES_PORT"
}

resolve_state_file() {
  if [[ -n "$STATE_FILE_OVERRIDE" ]]; then
    INSTALL_STATE_FILE="$STATE_FILE_OVERRIDE"
  fi
}

load_existing_state() {
  [[ -f "$INSTALL_STATE_FILE" ]] || return 0

  if [[ -z "$DOMAIN" ]]; then
    DOMAIN="$(state_read domain "")"
  fi
  if [[ -z "$REPO_URL" ]]; then
    REPO_URL="$(state_read repo_url "")"
  fi
  if [[ "$REPO_DIR_EXPLICIT" == "0" ]] && state_has repo_dir; then
    REPO_DIR="$(state_read repo_dir "$REPO_DIR")"
  fi
  if [[ "$DEPLOY_KEY_PATH_EXPLICIT" == "0" ]] && state_has deploy_key_path; then
    DEPLOY_KEY_PATH="$(state_read deploy_key_path "$DEPLOY_KEY_PATH")"
  fi
  if state_has skip_codex_check; then
    SKIP_CODEX_CHECK="$(state_read_bool skip_codex_check "$SKIP_CODEX_CHECK")"
  fi
  if state_has postgres_db_name; then
    POSTGRES_DB_NAME="$(state_read postgres_db_name "$POSTGRES_DB_NAME")"
  fi
  if state_has postgres_db_user; then
    POSTGRES_DB_USER="$(state_read postgres_db_user "$POSTGRES_DB_USER")"
  fi
  if state_has postgres_host; then
    POSTGRES_HOST="$(state_read postgres_host "$POSTGRES_HOST")"
  fi
  if state_has postgres_port; then
    POSTGRES_PORT="$(state_read postgres_port "$POSTGRES_PORT")"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        [[ $# -ge 2 ]] || die "--domain requires a value"
        DOMAIN="$2"
        shift 2
        ;;
      --repo-url)
        [[ $# -ge 2 ]] || die "--repo-url requires a value"
        REPO_URL="$2"
        shift 2
        ;;
      --repo-dir)
        [[ $# -ge 2 ]] || die "--repo-dir requires a value"
        REPO_DIR="$2"
        REPO_DIR_EXPLICIT=1
        shift 2
        ;;
      --deploy-key-path)
        [[ $# -ge 2 ]] || die "--deploy-key-path requires a value"
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
        [[ $# -ge 2 ]] || die "--state-file requires a value"
        STATE_FILE_OVERRIDE="$2"
        INSTALL_STATE_FILE="$2"
        shift 2
        ;;
      --no-clone)
        RUN_CLONE=0
        shift
        ;;
      --force-phase)
        [[ $# -ge 2 ]] || die "--force-phase requires a phase name"
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

  if [[ -n "$default" ]]; then
    prompt_input "$__var_name" "$prompt" "$default"
  else
    prompt_input "$__var_name" "$prompt"
  fi
}

confirm_or_default() {
  local prompt="$1"
  local default="${2:-y}"

  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi

  prompt_confirm "$prompt" "$default"
}

ensure_writable_parent() {
  local path="$1"
  ensure_dir "$(dirname "$path")"
}

prompt_for_missing_values() {
  if [[ -z "$DOMAIN" ]]; then
    prompt_with_default DOMAIN "Enter the public domain for Caddy" ""
  fi
  if [[ -z "$REPO_URL" ]]; then
    prompt_optional REPO_URL "Enter the private Git repository URL" ""
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

ensure_app_user() {
  if step_is_complete app_user && ! phase_forced app_user; then
    log_info "App user already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced app_user

  if [[ "$(id -un)" == "$APP_USER" ]]; then
    record_step_status app_user complete "current shell user already matches app user"
    return 0
  fi

  if id "$APP_USER" >/dev/null 2>&1; then
    record_step_status app_user complete "app user already exists"
    return 0
  fi

  if [[ "$(id -u)" -ne 0 ]]; then
    record_step_status app_user pending "root privileges are required to create $APP_USER"
    log_warn "App user $APP_USER does not exist and this shell is not root; recorded pending status"
    return 0
  fi

  if ! command -v useradd >/dev/null 2>&1; then
    record_step_status app_user pending "useradd is not available"
    log_warn "useradd is unavailable; recorded pending app-user status"
    return 0
  fi

  if ! confirm_or_default "Create the $APP_USER system user now?" "y"; then
    record_step_status app_user skipped "operator skipped user creation"
    return 0
  fi

  if useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"; then
    record_step_status app_user complete "created $APP_USER system user"
  else
    record_step_status app_user failed "useradd failed"
  fi
}

ensure_base_directories() {
  if step_is_complete base_directories && ! phase_forced base_directories; then
    log_info "Base directories already recorded as complete"
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
    "$(dirname "$PM2_ECOSYSTEM_FILE")"
    "$APP_HOME"
    "$(dirname "$INSTALL_STATE_FILE")"
  )
  local dir

  for dir in "${dirs[@]}"; do
    if ! ensure_dir "$dir"; then
      record_step_status base_directories pending "failed to create $dir"
      return 0
    fi
  done

  if ensure_owned_path "$INSTALL_ROOT" "install_root"; then
    record_install_state base_directories_owner "$APP_USER"
  fi
  ensure_owned_path "$DATA_ROOT" "data_root" || true
  ensure_owned_path "$WORKSPACE_ROOT" "workspace_root" || true
  ensure_owned_path "$SESSION_UPLOAD_ROOT" "session_upload_root" || true
  ensure_owned_path "$KNOWLEDGE_SET_ROOT" "knowledge_set_root" || true
  ensure_owned_path "$APP_HOME" "app_home" || true

  record_step_status base_directories complete "base directories exist"
}

ensure_deploy_key() {
  DEPLOY_KEY_SAFE_CHECKPOINT=0
  DEPLOY_KEY_CONTINUE_TO_CLONE=0

  if step_is_complete deploy_key && ! phase_forced deploy_key; then
    if state_read_bool deploy_key_guidance_shown "false"; then
      if confirm_or_default "Deploy key guidance was already shown. Continue to repository clone now?" "y"; then
        DEPLOY_KEY_CONTINUE_TO_CLONE=1
      else
        record_step_status repo_clone skipped "operator deferred after deploy key guidance"
        DEPLOY_KEY_SAFE_CHECKPOINT=1
      fi
    else
      log_info "Deploy key already recorded as complete"
    fi
    return 0
  fi
  maybe_mark_phase_forced deploy_key

  if [[ -f "$DEPLOY_KEY_PATH" && -f "$DEPLOY_KEY_PATH.pub" ]]; then
    record_step_status deploy_key complete "deploy key already present"
    record_install_state deploy_key_generated "false"
  elif ! command -v ssh-keygen >/dev/null 2>&1; then
    record_step_status deploy_key pending "ssh-keygen is not available"
    return 0
  elif ! confirm_or_default "Generate an SSH deploy key for private repo access now?" "y"; then
    record_step_status deploy_key skipped "operator skipped deploy key generation"
    return 0
  else
    ensure_writable_parent "$DEPLOY_KEY_PATH"
    if ssh-keygen -t ed25519 -f "$DEPLOY_KEY_PATH" -N "" -C "agent-studio deploy key" >/dev/null; then
      record_step_status deploy_key complete "generated deploy key"
      record_install_state deploy_key_generated "true"
    else
      record_step_status deploy_key failed "ssh-keygen failed"
      return 0
    fi
  fi

  if [[ -f "$DEPLOY_KEY_PATH.pub" ]]; then
    log_step "Add this public key to GitHub as a deploy key"
    log_info "Public key path: $DEPLOY_KEY_PATH.pub"
    cat "$DEPLOY_KEY_PATH.pub"
    printf '\n'
    log_info "Add the key as a read-only deploy key, then continue here."
    record_install_state deploy_key_guidance_shown "true"
    DEPLOY_KEY_SAFE_CHECKPOINT=1
  else
    record_step_status deploy_key pending "public key file is missing"
  fi
}

repo_dir_has_entries() {
  [[ -d "$1" ]] && [[ -n "$(find "$1" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]]
}

backup_existing_repo_dir() {
  local backup_dir="$REPO_DIR.forced-backup-$(date '+%Y%m%d%H%M%S')"

  if [[ ! -e "$REPO_DIR" ]]; then
    return 0
  fi

  if mv "$REPO_DIR" "$backup_dir"; then
    record_install_state repo_clone_backup "$backup_dir"
    log_info "Moved existing repository directory to $backup_dir before forced clone"
    return 0
  fi

  return 1
}

attempt_clone() {
  if [[ -d "$REPO_DIR/.git" ]] && ! phase_forced repo_clone; then
    record_step_status repo_clone complete "repository already cloned"
    return 0
  fi
  maybe_mark_phase_forced repo_clone

  if [[ "$RUN_CLONE" != "1" ]]; then
    record_step_status repo_clone skipped "clone disabled by --no-clone"
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
      if ! backup_existing_repo_dir; then
        record_step_status repo_clone pending "unable to move existing target directory before forced clone"
        return 0
      fi
    else
      record_step_status repo_clone pending "target directory exists and is not empty"
      return 0
    fi
  fi

  ensure_dir "$(dirname "$REPO_DIR")"

  local git_clone_env=()
  if [[ -f "$DEPLOY_KEY_PATH" ]]; then
    git_clone_env=(GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY_PATH -o IdentitiesOnly=yes")
  fi

  log_step "Cloning repository"
  if env "${git_clone_env[@]}" git clone "$REPO_URL" "$REPO_DIR"; then
    ensure_owned_path "$REPO_DIR" "repo_clone" || true
    record_step_status repo_clone complete "repository cloned"
  else
    record_step_status repo_clone failed "git clone failed"
  fi
}

ensure_postgres_setup() {
  if step_is_complete postgres && ! phase_forced postgres; then
    log_info "PostgreSQL setup already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced postgres

  if ! command -v psql >/dev/null 2>&1; then
    record_step_status postgres pending "psql is not available"
    record_install_state postgres_user_status "pending"
    record_install_state postgres_db_status "pending"
    return 0
  fi

  if ! confirm_or_default "Probe PostgreSQL connectivity now?" "y"; then
    record_step_status postgres skipped "operator deferred PostgreSQL probe"
    record_install_state postgres_user_status "skipped"
    record_install_state postgres_db_status "skipped"
    return 0
  fi

  local role_exists=""
  local db_exists=""

  if ! psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    record_step_status postgres pending "PostgreSQL probe failed or server not ready"
    record_install_state postgres_user_status "pending"
    record_install_state postgres_db_status "pending"
    return 0
  fi

  role_exists="$(
    psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -d postgres -Atqc "select 1 from pg_roles where rolname = :'role' limit 1" -v role="$POSTGRES_DB_USER" 2>/dev/null || true
  )"
  db_exists="$(
    psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -d postgres -Atqc "select 1 from pg_database where datname = :'dbname' limit 1" -v dbname="$POSTGRES_DB_NAME" 2>/dev/null || true
  )"

  if [[ "$role_exists" == "1" ]]; then
    record_install_state postgres_user_status "complete"
  else
    record_install_state postgres_user_status "pending"
    record_install_state postgres_user_reason "PostgreSQL role $POSTGRES_DB_USER is missing"
  fi

  if [[ "$db_exists" == "1" ]]; then
    record_install_state postgres_db_status "complete"
  else
    record_install_state postgres_db_status "pending"
    record_install_state postgres_db_reason "PostgreSQL database $POSTGRES_DB_NAME is missing"
  fi

  if [[ "$role_exists" == "1" && "$db_exists" == "1" ]]; then
    record_step_status postgres complete "PostgreSQL role and database exist"
  else
    record_step_status postgres pending "PostgreSQL connectivity succeeded but the app role/database are missing"
  fi
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

  ensure_dir "$(dirname "$destination")"
  python3 - "$template" "$destination" "$domain" "$ui_root" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
domain = sys.argv[3]
ui_root = sys.argv[4]
rendered = template.replace("{$DOMAIN}", domain).replace("{$UI_DIST_ROOT}", ui_root)
destination.write_text(rendered)
PY
}

ensure_env_files() {
  if step_is_complete env_files && ! phase_forced env_files; then
    log_info "Environment files already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced env_files

  if [[ ! -d "$REPO_DIR" ]]; then
    record_step_status env_files pending "repository directory does not exist yet"
    record_install_state backend_env_status "pending"
    record_install_state frontend_env_status "pending"
    return 0
  fi

  local backend_template="$script_dir/../templates/agent-api.env.template"
  local frontend_template="$script_dir/../templates/agent-ui.env.production.template"

  if [[ ! -f "$backend_template" || ! -f "$frontend_template" ]]; then
    record_step_status env_files pending "environment templates are missing"
    record_install_state backend_env_status "pending"
    record_install_state frontend_env_status "pending"
    return 0
  fi

  if phase_forced env_files || [[ ! -f "$BACKEND_ENV_FILE" ]]; then
    copy_template_file "$backend_template" "$BACKEND_ENV_FILE"
  fi
  if phase_forced env_files || [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
    copy_template_file "$frontend_template" "$FRONTEND_ENV_FILE"
  fi

  ensure_owned_path "$BACKEND_ENV_FILE" "backend_env" || true
  ensure_owned_path "$FRONTEND_ENV_FILE" "frontend_env" || true
  ensure_secure_file_mode "$BACKEND_ENV_FILE" 600
  ensure_secure_file_mode "$FRONTEND_ENV_FILE" 600
  record_install_state backend_env_mode "600"
  record_install_state frontend_env_mode "600"

  if [[ -f "$BACKEND_ENV_FILE" && -f "$FRONTEND_ENV_FILE" ]]; then
    record_step_status env_files complete "backend and frontend env files are present"
    record_install_state backend_env_status "complete"
    record_install_state frontend_env_status "complete"
  else
    record_step_status env_files pending "failed to write one or more env files"
    record_install_state backend_env_status "pending"
    record_install_state frontend_env_status "pending"
  fi
}

ensure_caddy_config() {
  if step_is_complete caddy_config && ! phase_forced caddy_config; then
    log_info "Caddy config already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced caddy_config

  local template="$script_dir/../templates/Caddyfile.template"
  if [[ ! -f "$template" ]]; then
    record_step_status caddy_config pending "Caddy template is missing"
    return 0
  fi

  if [[ -z "$DOMAIN" ]]; then
    record_step_status caddy_config pending "domain is missing"
    return 0
  fi

  if ! confirm_or_default "Render the Caddy config now?" "y"; then
    record_step_status caddy_config skipped "operator deferred Caddy config render"
    return 0
  fi

  if render_caddy_config "$template" "$CADDY_CONFIG_FILE" "$DOMAIN" "$APP_UI_DIR/dist"; then
    record_step_status caddy_config complete "Caddy config rendered"
  else
    record_step_status caddy_config pending "failed to render Caddy config"
  fi
}

run_first_deploy() {
  if step_is_complete first_deploy && ! phase_forced first_deploy; then
    log_info "First deploy already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced first_deploy

  if ! step_is_complete repo_clone; then
    record_step_status first_deploy pending "repository has not been cloned yet"
    return 0
  fi

  if ! step_is_complete env_files; then
    record_step_status first_deploy pending "environment files are not ready yet"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    record_step_status first_deploy pending "npm is not available"
    return 0
  fi

  if ! confirm_or_default "Run the initial deploy preflight now?" "y"; then
    record_step_status first_deploy skipped "operator deferred first deploy"
    return 0
  fi

  if [[ ! -f "$REPO_DIR/agent-api/package.json" ]]; then
    record_step_status first_deploy pending "agent-api package manifest is missing"
    return 0
  fi

  record_step_status first_deploy attempted "actual deploy execution started"
  if run_as_app_user_shell "cd '$REPO_DIR/agent-api' && npm run build"; then
    local backend_artifact="$REPO_DIR/agent-api/dist/index.js"
    local frontend_artifact="$REPO_DIR/agent-ui/dist/index.html"

    if [[ -f "$REPO_DIR/agent-ui/package.json" ]]; then
      if ! run_as_app_user_shell "cd '$REPO_DIR/agent-ui' && npm run build"; then
        record_step_status first_deploy pending "frontend build failed during actual deploy execution"
        return 0
      fi
    fi

    if [[ -f "$backend_artifact" && ( ! -f "$REPO_DIR/agent-ui/package.json" || -f "$frontend_artifact" ) ]]; then
      record_step_status first_deploy complete "actual deploy execution completed"
    else
      record_step_status first_deploy pending "deploy command ran but required build artifacts are missing"
    fi
  else
    record_step_status first_deploy pending "actual deploy execution failed or is unavailable in this environment"
  fi
}

ensure_pm2_start() {
  if step_is_complete pm2_start && ! phase_forced pm2_start; then
    log_info "PM2 status already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced pm2_start

  if ! step_is_complete first_deploy; then
    record_step_status pm2_start pending "first deploy is not ready yet"
    return 0
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    record_step_status pm2_start pending "pm2 is not available"
    return 0
  fi

  if ! confirm_or_default "Attempt to start or refresh the PM2 app state now?" "y"; then
    record_step_status pm2_start skipped "operator deferred PM2 start"
    return 0
  fi

  if [[ -f "$PM2_ECOSYSTEM_FILE" ]]; then
    record_step_status pm2_start attempted "pm2 ecosystem file is present"
    if run_as_app_user_shell "pm2 start '$PM2_ECOSYSTEM_FILE' --only '$PM2_APP_NAME' --update-env"; then
      record_step_status pm2_start complete "PM2 app start attempted successfully"
    else
      record_step_status pm2_start pending "pm2 start failed"
    fi
  else
    record_step_status pm2_start pending "pm2 ecosystem file is missing"
  fi
}

ensure_codex_verification() {
  if step_is_complete codex_runtime_check && ! phase_forced codex_runtime_check; then
    log_info "Codex verification already recorded as complete"
    return 0
  fi
  maybe_mark_phase_forced codex_runtime_check

  if [[ "$(state_bool "$SKIP_CODEX_CHECK")" == "true" ]]; then
    record_step_status codex_runtime_check skipped "operator requested skip-codex-check"
    record_install_state codex_runtime_check_skipped "true"
    return 0
  fi

  if ! command -v codex >/dev/null 2>&1; then
    record_step_status codex_runtime_check pending "codex binary is not available"
    record_install_state codex_runtime_check_skipped "false"
    return 0
  fi

  if ! confirm_or_default "Run a Codex runtime verification now?" "y"; then
    record_step_status codex_runtime_check skipped "operator deferred Codex verification"
    record_install_state codex_runtime_check_skipped "true"
    return 0
  fi

  if codex --version >/dev/null 2>&1; then
    record_step_status codex_runtime_check complete "codex runtime probe succeeded"
    record_install_state codex_runtime_check_skipped "false"
  else
    record_step_status codex_runtime_check pending "codex runtime probe failed"
    record_install_state codex_runtime_check_skipped "false"
  fi
}

render_phase_summary() {
  log_step "Install state summary"
  log_info "app user: $(step_status app_user)"
  log_info "base directories: $(step_status base_directories)"
  log_info "repo clone: $(step_status repo_clone)"
  log_info "postgres: $(step_status postgres)"
  log_info "backend env: $(state_read backend_env_status pending)"
  log_info "frontend env: $(state_read frontend_env_status pending)"
  log_info "caddy config: $(step_status caddy_config)"
  log_info "first deploy: $(step_status first_deploy)"
  log_info "pm2 start: $(step_status pm2_start)"
  log_info "codex runtime: $(step_status codex_runtime_check)"
}

print_follow_up_actions() {
  local phases=(
    app_user
    base_directories
    deploy_key
    repo_clone
    postgres
    env_files
    caddy_config
    first_deploy
    pm2_start
    codex_runtime_check
  )
  local phase
  local status
  local message
  local printed=0

  log_step "Operator follow-up actions"
  for phase in "${phases[@]}"; do
    status="$(step_status "$phase")"
    case "$status" in
      complete)
        continue
        ;;
      "")
        continue
        ;;
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
  local required_steps=(
    app_user
    base_directories
    repo_clone
    postgres
    env_files
    caddy_config
    first_deploy
    pm2_start
    codex_runtime_check
  )
  local all_complete=1
  local step

  for step in "${required_steps[@]}"; do
    if [[ "$(step_status "$step")" != "complete" ]]; then
      all_complete=0
      break
    fi
  done

  if [[ "$all_complete" -eq 1 ]]; then
    record_install_state installer_complete "true"
    record_install_state last_safe_checkpoint "all-resumable-phases-complete"
  else
    record_install_state installer_complete "false"
    record_install_state last_safe_checkpoint "resumable-phases-recorded"
  fi
}

main() {
  parse_args "$@"
  resolve_state_file

  if [[ "$SHOW_HELP" == "1" ]]; then
    usage
    exit 0
  fi

  load_existing_state
  prompt_for_missing_values
  ensure_state_defaults
  summarize_configuration

  ensure_app_user
  ensure_base_directories
  if [[ "$RUN_CLONE" == "1" ]]; then
    ensure_deploy_key
    if [[ "$DEPLOY_KEY_SAFE_CHECKPOINT" == "1" && "$DEPLOY_KEY_CONTINUE_TO_CLONE" != "1" ]]; then
      record_step_status repo_clone pending "deploy key guidance shown; rerun to continue clone"
      render_phase_summary
      print_follow_up_actions
      finalize_installation
      exit 0
    fi
    attempt_clone
  else
    record_step_status deploy_key skipped "clone disabled by --no-clone"
    record_step_status repo_clone skipped "clone disabled by --no-clone"
    record_install_state deploy_key_skipped "true"
  fi
  ensure_postgres_setup
  ensure_env_files
  ensure_caddy_config
  run_first_deploy
  ensure_pm2_start
  ensure_codex_verification
  render_phase_summary
  print_follow_up_actions
  finalize_installation
}

main "$@"
