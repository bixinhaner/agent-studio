#!/usr/bin/env bash

INSTALL_ROOT="${INSTALL_ROOT:-/usr/local/agent-studio}"
INSTALL_STATE_FILE="${INSTALL_STATE_FILE:-$INSTALL_ROOT/install-state.json}"
APP_USER="${APP_USER:-agentstudio}"
APP_GROUP="${APP_GROUP:-agentstudio}"
APP_HOME="${APP_HOME:-/home/$APP_USER}"
APP_REPO_DIR="${APP_REPO_DIR:-$INSTALL_ROOT}"
APP_API_DIR="${APP_API_DIR:-$APP_REPO_DIR/agent-api}"
APP_UI_DIR="${APP_UI_DIR:-$APP_REPO_DIR/agent-ui}"
DATA_ROOT="${DATA_ROOT:-$INSTALL_ROOT/data}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$DATA_ROOT/workspaces}"
SESSION_UPLOAD_ROOT="${SESSION_UPLOAD_ROOT:-$DATA_ROOT/session-uploads}"
KNOWLEDGE_SET_ROOT="${KNOWLEDGE_SET_ROOT:-$DATA_ROOT/knowledge-sets}"
SHARED_RUNTIME_ROOT="${SHARED_RUNTIME_ROOT:-/var/lib/agent-studio/shared}"
SHARED_PYTHON_RUNTIME_ROOT="${SHARED_PYTHON_RUNTIME_ROOT:-$SHARED_RUNTIME_ROOT/python/runtime}"
SHARED_PYTHON_PIP_CACHE_ROOT="${SHARED_PYTHON_PIP_CACHE_ROOT:-$SHARED_RUNTIME_ROOT/python/pip-cache}"
SHARED_CODEX_RUNTIME_ROOT="${SHARED_CODEX_RUNTIME_ROOT:-$SHARED_RUNTIME_ROOT/codex/codex-primary-runtime}"
SHARED_CODEX_RUNTIME_NODE_MODULES="${SHARED_CODEX_RUNTIME_NODE_MODULES:-$SHARED_CODEX_RUNTIME_ROOT/dependencies/node/node_modules}"
SHARED_CODEX_RUNTIME_ARCHIVE="${SHARED_CODEX_RUNTIME_ARCHIVE:-$INSTALL_ROOT/runtime-bundles/codex-primary-runtime-linux-$(uname -m).tar.gz}"
SHARED_ARGOS_PACKAGE_ROOT="${SHARED_ARGOS_PACKAGE_ROOT:-$SHARED_RUNTIME_ROOT/argos/packages}"
SHARED_ARGOS_DOWNLOAD_ROOT="${SHARED_ARGOS_DOWNLOAD_ROOT:-$SHARED_RUNTIME_ROOT/argos/downloads}"
STATE_DIR="${STATE_DIR:-$INSTALL_ROOT/state}"
PM2_APP_NAME="${PM2_APP_NAME:-agent-studio-api}"
PM2_ADMIN_APP_NAME="${PM2_ADMIN_APP_NAME:-$PM2_APP_NAME}"
PM2_CHAT_APP_NAME="${PM2_CHAT_APP_NAME:-${PM2_APP_NAME%-api}-chat-api}"
PM2_ECOSYSTEM_FILE="${PM2_ECOSYSTEM_FILE:-$INSTALL_ROOT/pm2-ecosystem.config.cjs}"
CADDY_CONFIG_FILE="${CADDY_CONFIG_FILE:-/etc/caddy/Caddyfile}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$APP_API_DIR/.env}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$APP_UI_DIR/.env.production}"

refresh_app_paths() {
  if [[ "${APP_REPO_DIR_EXPLICIT:-0}" != "1" ]]; then
    APP_REPO_DIR="$REPO_DIR"
  fi
  if [[ "${APP_API_DIR_EXPLICIT:-0}" != "1" ]]; then
    APP_API_DIR="$APP_REPO_DIR/agent-api"
  fi
  if [[ "${APP_UI_DIR_EXPLICIT:-0}" != "1" ]]; then
    APP_UI_DIR="$APP_REPO_DIR/agent-ui"
  fi
  if [[ "${BACKEND_ENV_FILE_EXPLICIT:-0}" != "1" ]]; then
    BACKEND_ENV_FILE="$APP_API_DIR/.env"
  fi
  if [[ "${FRONTEND_ENV_FILE_EXPLICIT:-0}" != "1" ]]; then
    FRONTEND_ENV_FILE="$APP_UI_DIR/.env.production"
  fi
}

log_ts() {
  date "+%Y-%m-%d %H:%M:%S"
}

log_step() {
  printf '\n[%s] %s\n' "$(log_ts)" "$*"
}

log_info() {
  printf '[%s] INFO %s\n' "$(log_ts)" "$*"
}

log_warn() {
  printf '[%s] WARN %s\n' "$(log_ts)" "$*" >&2
}

log_error() {
  printf '[%s] ERROR %s\n' "$(log_ts)" "$*" >&2
}

die() {
  log_error "$*"
  exit 1
}

ensure_dir() {
  mkdir -p "$1"
}

prompt_input() {
  local __var_name="$1"
  local prompt="$2"
  local default="${3:-}"
  local reply

  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " reply || true
    reply="${reply:-$default}"
  else
    read -r -p "$prompt: " reply || true
  fi

  printf -v "$__var_name" '%s' "$reply"
}

prompt_secret() {
  local __var_name="$1"
  local prompt="$2"
  local reply

  read -r -s -p "$prompt: " reply || true
  printf '\n'
  printf -v "$__var_name" '%s' "$reply"
}

prompt_confirm() {
  local prompt="$1"
  local default="${2:-y}"
  local reply
  local hint="[y/N]"
  local normalized_default

  normalized_default="$(printf '%s' "$default" | tr '[:upper:]' '[:lower:]')"
  case "$normalized_default" in
    y|yes) hint="[Y/n]" ;;
    n|no) hint="[y/N]" ;;
  esac

  read -r -p "$prompt $hint " reply || true
  reply="${reply:-$default}"
  reply="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
  case "$reply" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_state_dir() {
  mkdir -p "$(dirname "$INSTALL_STATE_FILE")"
}

state_read() {
  local key="$1"
  local default="${2:-}"
  python3 - "$INSTALL_STATE_FILE" "$key" "$default" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
default = sys.argv[3]

if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        data = {}
else:
    data = {}

value = data.get(key, default)
if isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False))
else:
    print(value)
PY
}

state_write() {
  local key="$1"
  local value="${2:-}"
  ensure_state_dir
  python3 - "$INSTALL_STATE_FILE" "$key" "$value" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        data = {}
else:
    data = {}

data[key] = value
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY
}

state_write_json() {
  local key="$1"
  local json_value="${2:-null}"
  ensure_state_dir
  python3 - "$INSTALL_STATE_FILE" "$key" "$json_value" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
raw = sys.argv[3]

if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        data = {}
else:
    data = {}

data[key] = json.loads(raw)
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY
}

state_delete() {
  local key="$1"
  ensure_state_dir
  python3 - "$INSTALL_STATE_FILE" "$key" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]

if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        data = {}
else:
    data = {}

data.pop(key, None)
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY
}

state_has() {
  local key="$1"
  python3 - "$INSTALL_STATE_FILE" "$key" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]

if not path.exists():
    raise SystemExit(1)

try:
    data = json.loads(path.read_text())
except json.JSONDecodeError:
    raise SystemExit(1)

raise SystemExit(0 if key in data else 1)
PY
}

state_read_bool() {
  local key="$1"
  local default="${2:-false}"
  local value

  value="$(state_read "$key" "$default")"
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|y|on) printf '%s' "true" ;;
    *) printf '%s' "false" ;;
  esac
}

redact_secret() {
  local value="${1:-}"
  if [[ -z "$value" ]]; then
    printf '%s' "<empty>"
    return 0
  fi

  if (( ${#value} <= 6 )); then
    printf '%s' "******"
    return 0
  fi

  printf '%s****%s' "${value:0:2}" "${value: -2}"
}

redact_url() {
  local value="${1:-}"
  python3 - "$value" <<'PY'
from urllib.parse import urlsplit, urlunsplit
import sys

value = sys.argv[1]
if not value:
    print("<empty>")
    raise SystemExit(0)

try:
    parsed = urlsplit(value)
except ValueError:
    print(value)
    raise SystemExit(0)

netloc = parsed.netloc
if "@" in netloc and ":" in netloc.split("@", 1)[0]:
    credentials, host = netloc.split("@", 1)
    username = credentials.split(":", 1)[0]
    netloc = f"{username}:****@{host}"

print(urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment)))
PY
}

is_app_user() {
  [[ "$(id -un)" == "$APP_USER" ]]
}

is_root() {
  [[ "$(id -u)" -eq 0 ]]
}

require_root_shell() {
  is_root || die "this script must be run as root"
}

run_as_app_user() {
  if is_app_user; then
    "$@"
    return 0
  fi

  sudo -u "$APP_USER" -H -- "$@"
}

run_as_app_user_shell() {
  local command="$1"
  if is_app_user; then
    bash -lc "$command"
    return 0
  fi

  sudo -u "$APP_USER" -H -- bash -lc "$command"
}

run_as_root() {
  if is_root; then
    "$@"
    return 0
  fi

  sudo -- "$@"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  command_exists "$1" || die "missing required command: $1"
}

codex_linux_sandbox_remediation() {
  cat >&2 <<'EOF'
Install and load the Codex Linux sandbox prerequisites:
  sudo apt-get update
  sudo apt-get install -y bubblewrap apparmor-profiles apparmor-utils
  sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict
  sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
EOF
}

ensure_codex_bwrap_apparmor_profile() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  command_exists apparmor_parser || return 0

  local source_profile="/usr/share/apparmor/extra-profiles/bwrap-userns-restrict"
  local target_profile="/etc/apparmor.d/bwrap-userns-restrict"
  if [[ ! -f "$source_profile" ]]; then
    log_warn "Codex bwrap AppArmor profile source not found: $source_profile"
    return 0
  fi

  run_as_root install -m 0644 "$source_profile" "$target_profile"
  run_as_root apparmor_parser -r "$target_profile"
}

check_codex_linux_sandbox_prerequisites() {
  [[ "$(uname -s)" == "Linux" ]] || return 0

  log_step "Checking Codex Linux sandbox prerequisites"
  if ! command_exists bwrap; then
    log_error "missing required command: bwrap"
    codex_linux_sandbox_remediation
    exit 1
  fi

  local output
  if ! output="$(run_as_app_user_shell "command -v bwrap >/dev/null && bwrap --ro-bind / / --proc /proc --dev /dev -- /usr/bin/true" 2>&1)"; then
    log_error "Codex Linux sandbox basic bwrap check failed for user $APP_USER"
    [[ -z "$output" ]] || printf '%s\n' "$output" >&2
    codex_linux_sandbox_remediation
    exit 1
  fi

  if ! output="$(run_as_app_user_shell "bwrap --ro-bind / / --unshare-net --proc /proc --dev /dev -- /usr/bin/true" 2>&1)"; then
    log_error "Codex Linux sandbox network namespace check failed for user $APP_USER"
    [[ -z "$output" ]] || printf '%s\n' "$output" >&2
    codex_linux_sandbox_remediation
    exit 1
  fi

  log_info "Codex Linux sandbox prerequisites are ready"
}

current_user() {
  id -un
}

current_uid() {
  id -u
}

current_dir_is_git_checkout() {
  git -C "$(pwd -P)" rev-parse --show-toplevel >/dev/null 2>&1
}

can_own_path_as_app_user() {
  [[ "$(current_user)" == "$APP_USER" || "$(current_uid)" -eq 0 ]]
}

apply_app_user_ownership() {
  local path="$1"

  if [[ "$(current_user)" == "$APP_USER" ]]; then
    return 0
  fi

  if [[ "$(current_uid)" -eq 0 ]]; then
    chown -R "$APP_USER:$APP_GROUP" "$path"
    return 0
  fi

  return 1
}

ensure_secure_file_mode() {
  local path="$1"
  local mode="${2:-600}"

  chmod "$mode" "$path"
}

generate_random_secret() {
  local bytes="${1:-24}"
  if command_exists openssl; then
    openssl rand -hex "$bytes"
    return 0
  fi

  python3 - "$bytes" <<'PY'
import secrets
import sys

print(secrets.token_hex(int(sys.argv[1])))
PY
}

ensure_ubuntu_apt_packages() {
  local packages=("$@")

  [[ "${#packages[@]}" -gt 0 ]] || return 0
  require_root_shell
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y "${packages[@]}"
}

ensure_nodesource_nodejs() {
  require_root_shell
  if command_exists node && command_exists npm; then
    return 0
  fi

  require_command curl
  bash -lc "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
  apt-get install -y nodejs
}

ensure_global_pm2() {
  require_root_shell
  command_exists npm || die "npm is required before installing pm2"
  command_exists pm2 || npm install -g pm2
}

ensure_service_started() {
  local service_name="$1"

  require_root_shell
  if command_exists systemctl; then
    systemctl enable --now "$service_name"
    return 0
  fi

  service "$service_name" start
}

write_env_key_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"

  python3 - "$env_file" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

lines = []
found = False
if path.exists():
    lines = path.read_text().splitlines()

rendered = []
for raw_line in lines:
    stripped = raw_line.strip()
    if stripped.startswith(f"{key}="):
        rendered.append(f"{key}={value}")
        found = True
    else:
        rendered.append(raw_line)

if not found:
    rendered.append(f"{key}={value}")

path.write_text("\n".join(rendered) + "\n")
PY
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
