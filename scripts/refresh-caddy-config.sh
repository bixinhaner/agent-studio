#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

REPO_DIR="${REPO_DIR:-$APP_REPO_DIR}"
DOMAIN="${DOMAIN:-}"
CADDY_UPSTREAM_HOST="${CADDY_UPSTREAM_HOST:-127.0.0.1}"
CADDY_UPSTREAM_PORT="${CADDY_UPSTREAM_PORT:-8787}"
CADDY_ADMIN_UPSTREAM_HOST="${CADDY_ADMIN_UPSTREAM_HOST:-}"
CADDY_ADMIN_UPSTREAM_PORT="${CADDY_ADMIN_UPSTREAM_PORT:-}"
CADDY_CHAT_UPSTREAM_HOST="${CADDY_CHAT_UPSTREAM_HOST:-}"
CADDY_CHAT_UPSTREAM_PORT="${CADDY_CHAT_UPSTREAM_PORT:-8788}"
CADDY_TEMPLATE_FILE="${CADDY_TEMPLATE_FILE:-$script_dir/../templates/Caddyfile.template}"
CADDY_EXTRA_SNIPPET_DIR="${CADDY_EXTRA_SNIPPET_DIR:-/etc/caddy/conf.d}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Render and reload the main Caddy config for Agent Studio.

Options:
  --repo-dir <path>             Repository checkout path [default: $REPO_DIR]
  --domain <name>               Public domain used to render Caddy config [default: install state domain]
  --caddy-upstream-host <host>  Backend host used by Caddy reverse proxy [default: $CADDY_UPSTREAM_HOST]
  --caddy-upstream-port <port>  Backward-compatible admin upstream port [default: $CADDY_UPSTREAM_PORT]
  --caddy-admin-upstream-host <host>
                               Admin upstream host [default: --caddy-upstream-host value]
  --caddy-admin-upstream-port <port>
                               Admin upstream port [default: --caddy-upstream-port value]
  --caddy-chat-upstream-host <host>
                               Chat upstream host [default: --caddy-upstream-host value]
  --caddy-chat-upstream-port <port>
                               Chat upstream port [default: $CADDY_CHAT_UPSTREAM_PORT]
  --caddy-config-file <path>    Output Caddy config path [default: $CADDY_CONFIG_FILE]
  --extra-snippet-dir <path>    Directory with extra *.caddy snippets [default: $CADDY_EXTRA_SNIPPET_DIR]
  -h, --help                    Show this help text
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      APP_REPO_DIR="$2"
      APP_REPO_DIR_EXPLICIT=1
      REPO_DIR="$2"
      shift 2
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --caddy-upstream-host)
      CADDY_UPSTREAM_HOST="$2"
      shift 2
      ;;
    --caddy-upstream-port)
      CADDY_UPSTREAM_PORT="$2"
      shift 2
      ;;
    --caddy-admin-upstream-host)
      CADDY_ADMIN_UPSTREAM_HOST="$2"
      shift 2
      ;;
    --caddy-admin-upstream-port)
      CADDY_ADMIN_UPSTREAM_PORT="$2"
      shift 2
      ;;
    --caddy-chat-upstream-host)
      CADDY_CHAT_UPSTREAM_HOST="$2"
      shift 2
      ;;
    --caddy-chat-upstream-port)
      CADDY_CHAT_UPSTREAM_PORT="$2"
      shift 2
      ;;
    --caddy-config-file)
      CADDY_CONFIG_FILE="$2"
      shift 2
      ;;
    --extra-snippet-dir)
      CADDY_EXTRA_SNIPPET_DIR="$2"
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

refresh_app_paths

if [[ -z "$CADDY_ADMIN_UPSTREAM_HOST" ]]; then
  CADDY_ADMIN_UPSTREAM_HOST="$CADDY_UPSTREAM_HOST"
fi

if [[ -z "$CADDY_ADMIN_UPSTREAM_PORT" ]]; then
  CADDY_ADMIN_UPSTREAM_PORT="$CADDY_UPSTREAM_PORT"
fi

if [[ -z "$CADDY_CHAT_UPSTREAM_HOST" ]]; then
  CADDY_CHAT_UPSTREAM_HOST="$CADDY_UPSTREAM_HOST"
fi

render_caddy_config() {
  local template="$1"
  local destination="$2"
  local domain="$3"
  local ui_root="$4"
  local admin_upstream_host="$5"
  local admin_upstream_port="$6"
  local chat_upstream_host="$7"
  local chat_upstream_port="$8"

  python3 - "$template" "$destination" "$domain" "$ui_root" "$admin_upstream_host" "$admin_upstream_port" "$chat_upstream_host" "$chat_upstream_port" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
domain = sys.argv[3]
ui_root = sys.argv[4]
admin_upstream_host = sys.argv[5]
admin_upstream_port = sys.argv[6]
chat_upstream_host = sys.argv[7]
chat_upstream_port = sys.argv[8]
rendered = (
    template
    .replace("{$DOMAIN}", domain)
    .replace("{$UI_DIST_ROOT}", ui_root)
    .replace("{$CADDY_ADMIN_UPSTREAM_HOST}", admin_upstream_host)
    .replace("{$CADDY_ADMIN_UPSTREAM_PORT}", admin_upstream_port)
    .replace("{$CADDY_CHAT_UPSTREAM_HOST}", chat_upstream_host)
    .replace("{$CADDY_CHAT_UPSTREAM_PORT}", chat_upstream_port)
)
destination.write_text(rendered)
PY
}

append_extra_caddy_snippets() {
  local destination="$1"

  [[ -d "$CADDY_EXTRA_SNIPPET_DIR" ]] || return 0

  local snippet
  local appended=0
  while IFS= read -r -d '' snippet; do
    appended=1
    printf '\n# Extra Caddy snippet: %s\n' "$snippet" >> "$destination"
    cat "$snippet" >> "$destination"
    printf '\n' >> "$destination"
  done < <(find "$CADDY_EXTRA_SNIPPET_DIR" -maxdepth 1 -type f -name '*.caddy' -print0 | sort -z)

  if [[ "$appended" == "1" ]]; then
    log_info "Appended extra Caddy snippets from $CADDY_EXTRA_SNIPPET_DIR"
  fi
}

resolve_caddy_domain() {
  if [[ -n "$DOMAIN" ]]; then
    return 0
  fi
  if [[ -f "$INSTALL_STATE_FILE" ]]; then
    DOMAIN="$(state_read domain "")"
  fi
}

main() {
  require_root_shell
  require_command caddy

  [[ -d "$APP_REPO_DIR" ]] || die "repository directory does not exist: $APP_REPO_DIR"
  [[ -f "$CADDY_TEMPLATE_FILE" ]] || die "missing Caddy template: $CADDY_TEMPLATE_FILE"
  [[ -d "$APP_UI_DIR/dist" ]] || die "missing frontend build output: $APP_UI_DIR/dist"

  resolve_caddy_domain
  [[ -n "$DOMAIN" ]] || die "domain is required to render Caddy config"

  local rendered_config
  rendered_config="$(mktemp)"
  render_caddy_config \
    "$CADDY_TEMPLATE_FILE" \
    "$rendered_config" \
    "$DOMAIN" \
    "$APP_UI_DIR/dist" \
    "$CADDY_ADMIN_UPSTREAM_HOST" \
    "$CADDY_ADMIN_UPSTREAM_PORT" \
    "$CADDY_CHAT_UPSTREAM_HOST" \
    "$CADDY_CHAT_UPSTREAM_PORT"
  append_extra_caddy_snippets "$rendered_config"

  log_step "Validating Caddy config"
  caddy validate --config "$rendered_config" --adapter caddyfile >/dev/null

  log_step "Updating Caddy config"
  mkdir -p "$(dirname "$CADDY_CONFIG_FILE")"
  install -m 644 "$rendered_config" "$CADDY_CONFIG_FILE"
  rm -f "$rendered_config"

  log_step "Reloading Caddy"
  systemctl reload caddy

  log_step "Caddy refresh complete"
  log_info "Caddy config: $CADDY_CONFIG_FILE"
}

main
