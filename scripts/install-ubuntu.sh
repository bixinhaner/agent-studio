#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

# INSTALL_STATE_FILE defaults to /usr/local/agent-studio/install-state.json in scripts/lib/common.sh.

DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-}"
SKIP_CODEX_CHECK="${SKIP_CODEX_CHECK:-0}"
ASSUME_YES="${ASSUME_YES:-0}"
REPO_DIR="${REPO_DIR:-$APP_REPO_DIR}"
DEPLOY_KEY_PATH="${DEPLOY_KEY_PATH:-$HOME/.ssh/id_ed25519_agent_studio_deploy}"
STATE_FILE_OVERRIDE="${STATE_FILE_OVERRIDE:-}"
SHOW_HELP=0
RUN_CLONE=1

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
  --no-clone                Skip the clone step and stop after recording state
  -h, --help                Show this help text

This installer is intentionally resumable. Re-run it to continue from the
last recorded state after resolving skipped steps.
USAGE
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

state_bool() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|y|on) printf '%s' "true" ;;
    *) printf '%s' "false" ;;
  esac
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

resolve_state_file() {
  if [[ -n "$STATE_FILE_OVERRIDE" ]]; then
    INSTALL_STATE_FILE="$STATE_FILE_OVERRIDE"
  fi
}

load_existing_state() {
  if [[ -f "$INSTALL_STATE_FILE" ]]; then
    DOMAIN="${DOMAIN:-$(state_read domain "")}"
    REPO_URL="${REPO_URL:-$(state_read repo_url "")}"
    REPO_DIR="${REPO_DIR:-$(state_read repo_dir "$REPO_DIR")}"
    DEPLOY_KEY_PATH="${DEPLOY_KEY_PATH:-$(state_read deploy_key_path "$DEPLOY_KEY_PATH")}"
    SKIP_CODEX_CHECK="$(state_read_bool skip_codex_check "$(state_bool "$SKIP_CODEX_CHECK")")"
  fi
}

trim_value() {
  local value="${1:-}"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
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
        shift 2
        ;;
      --deploy-key-path)
        [[ $# -ge 2 ]] || die "--deploy-key-path requires a value"
        DEPLOY_KEY_PATH="$2"
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

ensure_writable_parent() {
  local path="$1"
  ensure_dir "$(dirname "$path")"
}

ensure_state_defaults() {
  record_install_state script_version "task2"
  record_install_state app_user "$APP_USER"
  record_install_state install_root "$INSTALL_ROOT"
  record_install_state repo_dir "$REPO_DIR"
  record_install_state deploy_key_path "$DEPLOY_KEY_PATH"
  record_install_state domain "$DOMAIN"
  record_install_state repo_url "$REPO_URL"
  record_install_state skip_codex_check "$(state_bool "$SKIP_CODEX_CHECK")"
  record_install_state resume_enabled "true"
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
  log_info "repo dir: $REPO_DIR"
  log_info "domain: ${DOMAIN:-<unset>}"
  log_info "repo url: $(redact_url "$REPO_URL")"
  log_info "deploy key path: $DEPLOY_KEY_PATH"
  log_info "skip codex check: $(state_bool "$SKIP_CODEX_CHECK")"
}

ensure_private_repo_access() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    record_install_state repo_clone_completed "true"
    record_install_state clone_status "present"
    return 0
  fi

  record_install_state repo_clone_completed "false"
  record_install_state clone_status "missing"
  record_install_state clone_pending_reason "repository not cloned yet"

  log_step "Private repository access"
  log_info "The repository is not present at $REPO_DIR."
  log_info "This installer can guide a deploy-key flow so you can add the key to GitHub before cloning."

  if [[ -f "$DEPLOY_KEY_PATH" ]]; then
    log_info "Using existing deploy key: $DEPLOY_KEY_PATH"
  else
    log_info "No deploy key found at $DEPLOY_KEY_PATH"
    if confirm_or_default "Generate a new SSH deploy key now?" "y"; then
      ensure_writable_parent "$DEPLOY_KEY_PATH"
      if ! command -v ssh-keygen >/dev/null 2>&1; then
        record_install_state clone_status "blocked"
        record_install_state clone_pending_reason "ssh-keygen missing"
        die "ssh-keygen is required to generate the deploy key"
      fi
      ssh-keygen -t ed25519 -f "$DEPLOY_KEY_PATH" -N "" -C "agent-studio deploy key" >/dev/null
      record_install_state deploy_key_generated "true"
      log_info "Generated deploy key: $DEPLOY_KEY_PATH"
    else
      record_install_state deploy_key_generated "false"
      record_install_state clone_status "blocked"
      record_install_state clone_pending_reason "deploy key generation skipped"
      log_warn "Deploy key generation was skipped. Re-run the installer after creating a key."
      return 0
    fi
  fi

  if [[ -f "$DEPLOY_KEY_PATH.pub" ]]; then
    log_step "Add this public key to GitHub as a deploy key"
    cat "$DEPLOY_KEY_PATH.pub"
    printf '\n'
    log_info "Add the key as a read-only deploy key for the private repository, then return here and continue."
  fi

  if ! confirm_or_default "Continue after the deploy key has been added to GitHub?" "y"; then
    record_install_state clone_status "blocked"
    record_install_state clone_pending_reason "waiting for deploy key authorization"
    log_warn "Paused safely. Re-run this installer after the key is added to GitHub."
    return 0
  fi

  if [[ -z "$REPO_URL" ]]; then
    record_install_state clone_status "blocked"
    record_install_state clone_pending_reason "missing repository URL"
    log_warn "Repository URL is still missing. Re-run with --repo-url or enter it when prompted."
    return 0
  fi

  ensure_dir "$REPO_DIR"
  record_install_state clone_status "pending"
  record_install_state clone_pending_reason "git clone not attempted in this task"
  log_info "Repository clone is intentionally not performed in this task. The installer has recorded the pending clone step."
}

ensure_codex_check_marker() {
  if [[ "$(state_bool "$SKIP_CODEX_CHECK")" == "true" ]]; then
    record_install_state codex_runtime_check "skipped"
    record_install_state codex_runtime_check_skipped "true"
    log_info "Codex runtime check marked as skipped by request."
  else
    record_install_state codex_runtime_check "pending"
    record_install_state codex_runtime_check_skipped "false"
    log_info "Codex runtime check has not been run yet; it remains pending for later tasks."
  fi
}

stop_at_safe_checkpoint() {
  record_install_state last_safe_checkpoint "installer-configuration-recorded"
  record_install_state installer_complete "false"
  log_step "Safe checkpoint"
  log_info "The installer recorded its state and stopped before privileged provisioning."
  log_info "Re-run the script to continue after the missing prerequisites are resolved."
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

  if [[ "$RUN_CLONE" == "1" ]]; then
    ensure_private_repo_access
  else
    record_install_state clone_status "skipped"
    record_install_state clone_pending_reason "clone step disabled by --no-clone"
    log_info "Clone step skipped by request."
  fi

  ensure_codex_check_marker
  stop_at_safe_checkpoint
}

main "$@"
