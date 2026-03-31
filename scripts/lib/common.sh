#!/usr/bin/env bash

INSTALL_ROOT="${INSTALL_ROOT:-/usr/local/agent-studio}"
INSTALL_STATE_FILE="${INSTALL_STATE_FILE:-$INSTALL_ROOT/install-state.json}"
APP_USER="${APP_USER:-agentstudio}"
APP_GROUP="${APP_GROUP:-agentstudio}"
APP_HOME="${APP_HOME:-/home/$APP_USER}"
APP_REPO_DIR="${APP_REPO_DIR:-$INSTALL_ROOT/app/agent-studio}"
APP_API_DIR="${APP_API_DIR:-$APP_REPO_DIR/agent-api}"
APP_UI_DIR="${APP_UI_DIR:-$APP_REPO_DIR/agent-ui}"
DATA_ROOT="${DATA_ROOT:-$INSTALL_ROOT/data}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$DATA_ROOT/workspaces}"
SESSION_UPLOAD_ROOT="${SESSION_UPLOAD_ROOT:-$DATA_ROOT/session-uploads}"
KNOWLEDGE_SET_ROOT="${KNOWLEDGE_SET_ROOT:-$DATA_ROOT/knowledge-sets}"
STATE_DIR="${STATE_DIR:-$INSTALL_ROOT/state}"
PM2_APP_NAME="${PM2_APP_NAME:-agent-studio-api}"
PM2_ECOSYSTEM_FILE="${PM2_ECOSYSTEM_FILE:-$INSTALL_ROOT/pm2-ecosystem.config.cjs}"
CADDY_CONFIG_FILE="${CADDY_CONFIG_FILE:-/etc/caddy/Caddyfile}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$APP_API_DIR/.env}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$APP_UI_DIR/.env.production}"

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
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return 0
  fi

  sudo -- "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}
