#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
script_path="$script_dir/$(basename "${BASH_SOURCE[0]}")"
ORIGINAL_ARGS=("$@")

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_REF="${GIT_REF:-main}"
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8787}"
ADMIN_API_PORT="${ADMIN_API_PORT:-}"
CHAT_API_PORT="${CHAT_API_PORT:-}"
CHAT_B_API_PORT="${CHAT_B_API_PORT:-}"
DEPLOY_SCOPE="${AGENT_STUDIO_DEPLOY_SCOPE:-auto}"
DOMAIN="${DOMAIN:-}"
CADDY_UPSTREAM_HOST="${CADDY_UPSTREAM_HOST:-}"
CADDY_UPSTREAM_PORT="${CADDY_UPSTREAM_PORT:-}"
CADDY_ADMIN_UPSTREAM_HOST="${CADDY_ADMIN_UPSTREAM_HOST:-}"
CADDY_ADMIN_UPSTREAM_PORT="${CADDY_ADMIN_UPSTREAM_PORT:-}"
CADDY_CHAT_UPSTREAM_HOST="${CADDY_CHAT_UPSTREAM_HOST:-}"
CADDY_CHAT_UPSTREAM_PORT="${CADDY_CHAT_UPSTREAM_PORT:-}"
CADDY_EXTRA_SNIPPET_DIR="${CADDY_EXTRA_SNIPPET_DIR:-/etc/caddy/conf.d}"
CADDY_PORTAL_DOMAINS="${CADDY_PORTAL_DOMAINS:-}"
CADDY_PORTAL_DOMAINS_EXPLICIT="$([[ -n "$CADDY_PORTAL_DOMAINS" ]] && printf '1' || printf '0')"
CADDY_LEGACY_PORTAL_SNIPPET_FILE="${CADDY_LEGACY_PORTAL_SNIPPET_FILE:-}"
CADDY_PORTAL_DOMAINS_MANAGED=0
CADDY_SITE_ADDRESSES=""
ASSET_RETENTION_DAYS="${AGENT_STUDIO_ASSET_RETENTION_DAYS:-}"
FRONTEND_BUILD_NODE_OPTIONS="${FRONTEND_BUILD_NODE_OPTIONS:---max-old-space-size=3072}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
SKIP_RBAC_SEED="${SKIP_RBAC_SEED:-0}"
SKIP_CADDY_RELOAD="${SKIP_CADDY_RELOAD:-0}"
REFRESH_CADDY="${REFRESH_CADDY:-0}"
SKIP_AGENT_DRAIN="${SKIP_AGENT_DRAIN:-0}"
AGENT_DRAIN_TIMEOUT_SECONDS="${AGENT_DRAIN_TIMEOUT_SECONDS:-900}"
AGENT_DRAIN_POLL_SECONDS="${AGENT_DRAIN_POLL_SECONDS:-5}"
AGENT_DRAIN_STATUS_URL="${AGENT_DRAIN_STATUS_URL:-}"
AGENT_ADMIN_DRAIN_STATUS_URL="${AGENT_ADMIN_DRAIN_STATUS_URL:-}"
AGENT_CHAT_DRAIN_STATUS_URL="${AGENT_CHAT_DRAIN_STATUS_URL:-}"
DEPLOY_DRAIN_FILE="${AGENT_STUDIO_DEPLOY_DRAIN_FILE:-}"
CHAT_RESTART_MODE="${AGENT_STUDIO_CHAT_RESTART_MODE:-bluegreen}"
CHAT_IDLE_TIMEOUT_SECONDS="${AGENT_CHAT_IDLE_TIMEOUT_SECONDS:-1800}"
CHAT_RETIRE_MAX_SECONDS="${AGENT_STUDIO_CHAT_RETIRE_MAX_SECONDS:-1800}"
CHAT_READY_TIMEOUT_SECONDS="${AGENT_CHAT_READY_TIMEOUT_SECONDS:-180}"
ALLOW_BREAKING_MIGRATION="${AGENT_STUDIO_ALLOW_BREAKING_MIGRATION:-0}"
RELEASE_RETENTION="${AGENT_STUDIO_RELEASE_RETENTION:-3}"
DEPLOY_LOCK_FILE="${AGENT_STUDIO_DEPLOY_LOCK_FILE:-/tmp/agent-studio-deploy.lock}"
PM2_LOG_DIR="${AGENT_STUDIO_PM2_LOG_DIR:-$APP_HOME/.pm2/logs}"
PLAN_ONLY=0
ACTIVATE_RELEASE=""
PLAN_FRONTEND=0
PLAN_ADMIN=0
PLAN_CHAT=0
PLAN_CADDY=0
PREVIOUS_HEAD=""
TARGET_COMMIT=""
RELEASE_DIR=""
CHAT_RESTART_PENDING=0
CADDY_REFRESHED=0
ACTIVE_DRAIN_FILES=()

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Deploy Agent Studio on an Ubuntu host.

Options:
  --repo-dir <path>      Repository checkout path [default: $APP_REPO_DIR]
  --remote <name>        Git remote name [default: $GIT_REMOTE]
  --ref <name>           Git branch to deploy [default: $GIT_REF]
  --domain <name>        Public domain used to render Caddy config [default: install state domain]
  --auto                 Deploy only the targets whose files changed since each target's
                         last deployed commit [default]
  --frontend-only        Build and publish frontend assets only; do not drain or restart API
  --admin-only           Build backend and restart the admin API only
  --chat-only            Build backend and restart the chat API only
  --all                  Build frontend/backend, restart both APIs and refresh Caddy
  --plan                 Fetch and print the auto deploy plan without changing anything
  --activate-release <id>
                         Switch the backend to an existing release (rollback) and restart
                         admin and chat
  --chat-restart <mode>  bluegreen: start the idle chat slot on the new release, switch new
                         traffic to it once ready and let the old slot finish its runs [default]
                         idle: wait until no conversation is running, then restart in place with
                         only a brief drain; on timeout leave the chat restart pending
                         drain: block new conversations until active runs finish (legacy)
                         skip: do not restart chat; it stays pending for a later deploy
  --chat-idle-timeout <sec>
                         Seconds to wait for chat to become idle [default: $CHAT_IDLE_TIMEOUT_SECONDS]
  --api-host <host>      Host written into PM2 env [default: $API_HOST]
  --api-port <port>      Backward-compatible admin API port [default: $API_PORT]
  --admin-api-port <port>
                         Admin API port [default: --api-port value]
  --chat-api-port <port> Chat/runtime API port of blue-green slot a [default: 8791]
                         (slot b listens on the next port)
  --caddy-upstream-host <host>
                         Backward-compatible upstream host applied to both admin and chat [default: 127.0.0.1]
  --caddy-upstream-port <port>
                         Backward-compatible admin upstream port [default: admin API port]
  --caddy-admin-upstream-host <host>
                         Admin upstream host used by Caddy reverse proxy [default: --caddy-upstream-host value]
  --caddy-admin-upstream-port <port>
                         Admin upstream port used by Caddy reverse proxy [default: --admin-api-port value]
  --caddy-chat-upstream-host <host>
                         Chat upstream host used by Caddy reverse proxy [default: --caddy-upstream-host value]
  --caddy-chat-upstream-port <port>
                         Chat upstream port used by Caddy reverse proxy [default: --chat-api-port value]
  --portal-domains <list>
                         Comma/space-separated Portal domains sharing one split API route
  --asset-retention-days <days>
                         Days to keep old frontend assets; 0 disables pruning [default: ${ASSET_RETENTION_DAYS:-30}]
  --frontend-node-options <value>
                         NODE_OPTIONS used for frontend build [default: $FRONTEND_BUILD_NODE_OPTIONS]
  --skip-git-pull        Rebuild current checkout without fetching or pulling
  --skip-rbac-seed       Skip built-in RBAC seed step
  --skip-caddy-reload    Skip rendering/reloading Caddy
  --refresh-caddy        Also refresh Caddy during an admin-only or chat-only deploy
  --skip-agent-drain     Restart immediately without deployment drain/wait
  --drain-timeout <sec>  Seconds a drained service waits for active runs before restart
                         [default: $AGENT_DRAIN_TIMEOUT_SECONDS]
  --allow-breaking-migration
                         Apply migrations that drop, rename or tighten schema the running
                         release may still use (blue-green runs old and new code together)
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
    --remote)
      GIT_REMOTE="$2"
      shift 2
      ;;
    --ref)
      GIT_REF="$2"
      shift 2
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --auto)
      DEPLOY_SCOPE="auto"
      shift
      ;;
    --plan)
      PLAN_ONLY=1
      shift
      ;;
    --activate-release)
      ACTIVATE_RELEASE="$2"
      shift 2
      ;;
    --chat-restart)
      CHAT_RESTART_MODE="$2"
      shift 2
      ;;
    --chat-idle-timeout)
      CHAT_IDLE_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --frontend-only)
      DEPLOY_SCOPE="frontend"
      shift
      ;;
    --admin-only)
      DEPLOY_SCOPE="admin"
      shift
      ;;
    --chat-only)
      DEPLOY_SCOPE="chat"
      shift
      ;;
    --all)
      DEPLOY_SCOPE="all"
      shift
      ;;
    --api-host)
      API_HOST="$2"
      shift 2
      ;;
    --api-port)
      API_PORT="$2"
      shift 2
      ;;
    --admin-api-port)
      ADMIN_API_PORT="$2"
      shift 2
      ;;
    --chat-api-port)
      CHAT_API_PORT="$2"
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
    --portal-domains)
      CADDY_PORTAL_DOMAINS="$2"
      CADDY_PORTAL_DOMAINS_EXPLICIT=1
      shift 2
      ;;
    --asset-retention-days)
      ASSET_RETENTION_DAYS="$2"
      shift 2
      ;;
    --frontend-node-options)
      FRONTEND_BUILD_NODE_OPTIONS="$2"
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
    --skip-caddy-reload)
      SKIP_CADDY_RELOAD=1
      shift
      ;;
    --refresh-caddy)
      REFRESH_CADDY=1
      shift
      ;;
    --skip-agent-drain)
      SKIP_AGENT_DRAIN=1
      shift
      ;;
    --drain-timeout)
      AGENT_DRAIN_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --allow-breaking-migration)
      ALLOW_BREAKING_MIGRATION=1
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
if [[ -z "$CADDY_LEGACY_PORTAL_SNIPPET_FILE" ]]; then
  CADDY_LEGACY_PORTAL_SNIPPET_FILE="$CADDY_EXTRA_SNIPPET_DIR/agent-studio-bailey.caddy"
fi
if [[ -z "$DEPLOY_DRAIN_FILE" ]]; then
  DEPLOY_DRAIN_FILE="$APP_API_DIR/temp/deploy-drain.json"
elif [[ "$DEPLOY_DRAIN_FILE" != /* ]]; then
  DEPLOY_DRAIN_FILE="$APP_API_DIR/$DEPLOY_DRAIN_FILE"
fi

RELEASES_DIR="$APP_REPO_DIR/releases"
DEPLOY_STATE_DIR="$RELEASES_DIR/state"

pm2_template_path="$script_dir/../templates/pm2-ecosystem.config.cjs.template"
logrotate_template_path="$script_dir/../templates/logrotate-pm2.conf.template"
caddy_template_path="$script_dir/../templates/Caddyfile.template"

case "$DEPLOY_SCOPE" in
  auto|all|frontend|admin|chat) ;;
  *) die "unknown deploy scope: $DEPLOY_SCOPE" ;;
esac

case "$CHAT_RESTART_MODE" in
  bluegreen|idle|drain|skip) ;;
  *) die "--chat-restart must be bluegreen, idle, drain or skip" ;;
esac

if [[ -n "$ACTIVATE_RELEASE" && ! "$ACTIVATE_RELEASE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  die "--activate-release must be a release directory name"
fi

if [[ -z "$ADMIN_API_PORT" ]]; then
  ADMIN_API_PORT="$API_PORT"
fi

if [[ -z "$CHAT_API_PORT" ]]; then
  CHAT_API_PORT="8791"
fi

if [[ -z "$CHAT_B_API_PORT" && "$CHAT_API_PORT" =~ ^[0-9]+$ ]]; then
  CHAT_B_API_PORT="$((CHAT_API_PORT + 1))"
fi
PM2_CHAT_B_APP_NAME="${PM2_CHAT_B_APP_NAME:-$PM2_CHAT_APP_NAME-b}"

if [[ -z "$CADDY_UPSTREAM_HOST" ]]; then
  CADDY_UPSTREAM_HOST="127.0.0.1"
fi

if [[ -z "$CADDY_UPSTREAM_PORT" ]]; then
  CADDY_UPSTREAM_PORT="$ADMIN_API_PORT"
fi

if [[ -z "$CADDY_ADMIN_UPSTREAM_HOST" ]]; then
  CADDY_ADMIN_UPSTREAM_HOST="$CADDY_UPSTREAM_HOST"
fi

if [[ -z "$CADDY_ADMIN_UPSTREAM_PORT" ]]; then
  CADDY_ADMIN_UPSTREAM_PORT="$CADDY_UPSTREAM_PORT"
fi

if [[ -z "$CADDY_CHAT_UPSTREAM_HOST" ]]; then
  CADDY_CHAT_UPSTREAM_HOST="$CADDY_UPSTREAM_HOST"
fi

if [[ -z "$CADDY_CHAT_UPSTREAM_PORT" ]]; then
  CADDY_CHAT_UPSTREAM_PORT="$CHAT_API_PORT"
fi

if [[ -n "$ASSET_RETENTION_DAYS" && ! "$ASSET_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  die "--asset-retention-days must be a non-negative integer"
fi

if [[ ! "$ADMIN_API_PORT" =~ ^[0-9]+$ || "$ADMIN_API_PORT" == "0" ]]; then
  die "--admin-api-port must be a positive integer"
fi

if [[ ! "$CHAT_API_PORT" =~ ^[0-9]+$ || "$CHAT_API_PORT" == "0" ]]; then
  die "--chat-api-port must be a positive integer"
fi

if [[ ! "$CHAT_RETIRE_MAX_SECONDS" =~ ^[0-9]+$ || ! "$CHAT_READY_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]]; then
  die "chat retire and ready timeouts must be non-negative integers"
fi

if [[ ! "$AGENT_DRAIN_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]]; then
  die "--drain-timeout must be a non-negative integer"
fi

if [[ ! "$CHAT_IDLE_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]]; then
  die "--chat-idle-timeout must be a non-negative integer"
fi

if [[ ! "$RELEASE_RETENTION" =~ ^[0-9]+$ || "$RELEASE_RETENTION" == "0" ]]; then
  die "AGENT_STUDIO_RELEASE_RETENTION must be a positive integer"
fi

if [[ ! "$AGENT_DRAIN_POLL_SECONDS" =~ ^[0-9]+$ || "$AGENT_DRAIN_POLL_SECONDS" == "0" ]]; then
  die "AGENT_DRAIN_POLL_SECONDS must be a positive integer"
fi

shell_quote() {
  printf '%q' "$1"
}

# The plan flags are filled by resolve_deploy_plan from the scope option or,
# for --auto, from the files changed since each target's last deployed commit.
deploy_builds_backend() {
  [[ -z "$ACTIVATE_RELEASE" ]] && { [[ "$PLAN_ADMIN" == "1" ]] || [[ "$PLAN_CHAT" == "1" ]]; }
}

deploy_builds_frontend() {
  [[ "$PLAN_FRONTEND" == "1" ]]
}

deploy_restarts_admin() {
  [[ "$PLAN_ADMIN" == "1" ]]
}

deploy_restarts_chat() {
  [[ "$PLAN_CHAT" == "1" ]]
}

deploy_refreshes_caddy() {
  [[ "$PLAN_CADDY" == "1" || "$REFRESH_CADDY" == "1" ]]
}

read_deploy_state() {
  local key="$1"
  local file="$DEPLOY_STATE_DIR/$key"
  [[ -f "$file" ]] || return 0
  tr -d '[:space:]' < "$file"
}

write_deploy_state() {
  local key="$1"
  local value="$2"
  run_as_app_user_shell "mkdir -p '$DEPLOY_STATE_DIR' && printf '%s\\n' '$value' > '$DEPLOY_STATE_DIR/$key.tmp' && mv -f '$DEPLOY_STATE_DIR/$key.tmp' '$DEPLOY_STATE_DIR/$key'"
}

resolve_deploy_plan() {
  case "$DEPLOY_SCOPE" in
    all) PLAN_FRONTEND=1; PLAN_ADMIN=1; PLAN_CHAT=1; PLAN_CADDY=1 ;;
    frontend) PLAN_FRONTEND=1 ;;
    admin) PLAN_ADMIN=1 ;;
    chat) PLAN_CHAT=1 ;;
    auto)
      local target base args=()
      for target in frontend admin chat caddy; do
        base="$(read_deploy_state "$target.commit")"
        # Before the first auto deploy every target runs the pre-pull checkout.
        args+=("--$target-base" "${base:-$PREVIOUS_HEAD}")
      done
      log_step "Resolving deploy plan for $TARGET_COMMIT"
      local plan_output
      plan_output="$(node "$script_dir/deploy-scope.mjs" --repo "$APP_REPO_DIR" --head "$TARGET_COMMIT" "${args[@]}")" ||
        die "failed to resolve deploy plan"
      local line
      while IFS= read -r line; do
        case "$line" in
          PLAN_FRONTEND=[01]) PLAN_FRONTEND="${line#*=}" ;;
          PLAN_ADMIN=[01]) PLAN_ADMIN="${line#*=}" ;;
          PLAN_CHAT=[01]) PLAN_CHAT="${line#*=}" ;;
          PLAN_CADDY=[01]) PLAN_CADDY="${line#*=}" ;;
          *) die "unexpected deploy plan output: $line" ;;
        esac
      done <<< "$plan_output"
      ;;
  esac
  if [[ -n "$ACTIVATE_RELEASE" ]]; then
    PLAN_FRONTEND=0; PLAN_ADMIN=1; PLAN_CHAT=1; PLAN_CADDY=0
  fi
  log_info "Deploy plan: frontend=$PLAN_FRONTEND admin=$PLAN_ADMIN chat=$PLAN_CHAT caddy=$PLAN_CADDY (scope=$DEPLOY_SCOPE, chat restart=$CHAT_RESTART_MODE)"
  if [[ "$PLAN_CHAT" == "1" && "$CHAT_RESTART_MODE" == "bluegreen" ]]; then
    local active
    active="$(active_chat_slot)"
    if [[ -z "$(read_deploy_state chat.slot)" ]]; then
      log_info "Chat: first blue-green switch; slot $(other_chat_slot "$active") starts on the new release and takes new conversations, the current chat instance finishes its runs (up to ${CHAT_RETIRE_MAX_SECONDS}s) and is then removed; Caddy is refreshed"
    else
      log_info "Chat: blue-green switch from slot $active to slot $(other_chat_slot "$active"); running conversations finish on slot $active, no conversation is blocked"
    fi
  fi
}

require_repo_checkout() {
  [[ -d "$APP_REPO_DIR" ]] || die "repository directory does not exist: $APP_REPO_DIR"
  run_as_app_user_shell "git -C '$APP_REPO_DIR' rev-parse --is-inside-work-tree >/dev/null 2>&1" || die "not a git checkout: $APP_REPO_DIR"
  [[ -f "$APP_API_DIR/package.json" ]] || die "missing agent-api/package.json under $APP_API_DIR"
  [[ -f "$APP_UI_DIR/package.json" ]] || die "missing agent-ui/package.json under $APP_UI_DIR"
  [[ -f "$BACKEND_ENV_FILE" ]] || die "missing backend env file: $BACKEND_ENV_FILE"
  [[ -f "$FRONTEND_ENV_FILE" ]] || die "missing frontend env file: $FRONTEND_ENV_FILE"
}

render_pm2_ecosystem() {
  [[ -f "$pm2_template_path" ]] || die "missing PM2 template: $pm2_template_path"
  if is_app_user; then
    ensure_dir "$PM2_LOG_DIR"
  else
    run_as_root install -d -o "$APP_USER" -g "$APP_GROUP" -m 755 "$PM2_LOG_DIR"
  fi
  local pm2_ecosystem_dir
  pm2_ecosystem_dir="$(dirname "$PM2_ECOSYSTEM_FILE")"
  if is_app_user; then
    ensure_dir "$pm2_ecosystem_dir"
  else
    run_as_root mkdir -p "$pm2_ecosystem_dir"
  fi

  local rendered_ecosystem
  rendered_ecosystem="$(mktemp)"
  local peer_urls
  peer_urls="$(chat_slot_base_url a),$(chat_slot_base_url b)"
  python3 - "$pm2_template_path" "$rendered_ecosystem" "$PM2_ADMIN_APP_NAME" "$PM2_CHAT_APP_NAME" "$APP_API_DIR" "$API_HOST" "$ADMIN_API_PORT" "$CHAT_API_PORT" "$APP_REPO_DIR" "$PM2_CHAT_B_APP_NAME" "$CHAT_B_API_PORT" "$peer_urls" "$PM2_LOG_DIR" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
rendered = (
    template
    .replace("__PM2_ADMIN_APP_NAME__", sys.argv[3])
    .replace("__PM2_CHAT_B_APP_NAME__", sys.argv[10])
    .replace("__CHAT_B_API_PORT__", sys.argv[11])
    .replace("__CHAT_PEER_URLS__", sys.argv[12])
    .replace("__PM2_LOG_DIR__", sys.argv[13])
    .replace("__PM2_CHAT_APP_NAME__", sys.argv[4])
    .replace("__APP_API_DIR__", sys.argv[5])
    .replace("__API_HOST__", sys.argv[6])
    .replace("__ADMIN_API_PORT__", sys.argv[7])
    .replace("__CHAT_API_PORT__", sys.argv[8])
    .replace("__APP_REPO_DIR__", sys.argv[9])
)
destination.write_text(rendered)
PY

  if is_app_user; then
    install -m 644 "$rendered_ecosystem" "$PM2_ECOSYSTEM_FILE"
  else
    run_as_root install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$rendered_ecosystem" "$PM2_ECOSYSTEM_FILE"
  fi
  rm -f "$rendered_ecosystem"
}

# PM2 appends to the fixed per-app log files forever; logrotate bounds them.
install_pm2_logrotate() {
  [[ -f "$logrotate_template_path" ]] || die "missing logrotate template: $logrotate_template_path"
  if ! command -v logrotate >/dev/null 2>&1; then
    log_warn "logrotate is not installed; PM2 logs in $PM2_LOG_DIR are not rotated"
    return 0
  fi
  local destination="/etc/logrotate.d/${PM2_ADMIN_APP_NAME}-pm2"
  local files="" app
  for app in "$PM2_ADMIN_APP_NAME" "$PM2_CHAT_APP_NAME" "$PM2_CHAT_B_APP_NAME"; do
    files+="$PM2_LOG_DIR/$app-out.log $PM2_LOG_DIR/$app-error.log "
  done
  local rendered
  rendered="$(mktemp)"
  python3 - "$logrotate_template_path" "$rendered" "${files% }" "$APP_USER" "$APP_GROUP" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
Path(sys.argv[2]).write_text(
    template
    .replace("__PM2_LOG_FILES__", sys.argv[3])
    .replace("__APP_USER__", sys.argv[4])
    .replace("__APP_GROUP__", sys.argv[5])
)
PY
  if run_as_root cmp -s "$rendered" "$destination" 2>/dev/null; then
    rm -f "$rendered"
    return 0
  fi
  # logrotate only accepts root-owned configs; validate a root copy before installing.
  local candidate
  candidate="$(run_as_root mktemp)"
  run_as_root install -o root -g root -m 644 "$rendered" "$candidate"
  rm -f "$rendered"
  if ! run_as_root logrotate -d "$candidate" >/dev/null 2>&1; then
    run_as_root rm -f "$candidate"
    die "rendered PM2 logrotate config failed validation"
  fi
  run_as_root mv -f "$candidate" "$destination"
  log_info "Installed PM2 log rotation: $destination"
}

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
    # Blue-green chat slot b listens on the next port.
    .replace("{$CADDY_CHAT_B_UPSTREAM_PORT}", str(int(chat_upstream_port) + 1))
)
destination.write_text(rendered)
PY
}

append_extra_caddy_snippets() {
  local destination="$1"
  local skipped_snippet="${2:-}"

  [[ -d "$CADDY_EXTRA_SNIPPET_DIR" ]] || return 0

  local snippet
  local appended=0
  while IFS= read -r -d '' snippet; do
    if [[ -n "$skipped_snippet" && "$snippet" == "$skipped_snippet" ]]; then
      continue
    fi
    appended=1
    printf '\n# Extra Caddy snippet: %s\n' "$snippet" >> "$destination"
    cat "$snippet" >> "$destination"
    printf '\n' >> "$destination"
  done < <(find "$CADDY_EXTRA_SNIPPET_DIR" -maxdepth 1 -type f -name '*.caddy' -print0 | sort -z)

  if [[ "$appended" == "1" ]]; then
    log_info "Appended extra Caddy snippets from $CADDY_EXTRA_SNIPPET_DIR"
  fi
}

reload_caddy() {
  if ! command_exists caddy; then
    log_warn "Caddy binary not found; Caddy was not reloaded"
    return 0
  fi

  if command_exists systemctl; then
    log_step "Reloading Caddy"
    local systemctl_status=0
    set +e
    run_as_root systemctl reload caddy
    systemctl_status=$?
    set -e
    if [[ "$systemctl_status" -eq 0 ]]; then
      return 0
    fi
    log_warn "systemctl reload caddy failed; falling back to direct caddy reload"
  else
    log_warn "systemctl not found; falling back to direct caddy reload"
  fi

  run_as_root caddy reload --config "$CADDY_CONFIG_FILE" --force
}

resolve_caddy_domains() {
  if [[ -z "$DOMAIN" && -f "$INSTALL_STATE_FILE" ]]; then
    DOMAIN="$(state_read domain "")"
  fi
  [[ -n "$DOMAIN" ]] || return 0
  resolve_caddy_portal_domain_config "$DOMAIN" "$CADDY_PORTAL_DOMAINS_EXPLICIT" "$CADDY_PORTAL_DOMAINS"
}

persist_caddy_portal_domains() {
  if is_root; then
    state_write caddy_portal_domains "$CADDY_PORTAL_DOMAINS"
    return 0
  fi
  run_as_root env INSTALL_STATE_FILE="$INSTALL_STATE_FILE" bash -c '
    source "$1"
    state_write "$2" "$3"
  ' _ "$script_dir/lib/common.sh" caddy_portal_domains "$CADDY_PORTAL_DOMAINS"
}

refresh_caddy_config() {
  if [[ "$SKIP_CADDY_RELOAD" == "1" ]]; then
    log_info "Skipping Caddy config refresh"
    return 0
  fi

  resolve_caddy_domains
  if [[ -z "$DOMAIN" ]]; then
    log_warn "Skipping Caddy config refresh because no domain was provided and no install state domain was found"
    return 0
  fi

  [[ -f "$caddy_template_path" ]] || die "missing Caddy template: $caddy_template_path"

  local rendered_config
  rendered_config="$(mktemp)"
  render_caddy_config \
    "$caddy_template_path" \
    "$rendered_config" \
    "$CADDY_SITE_ADDRESSES" \
    "$APP_UI_DIR/dist" \
    "$CADDY_ADMIN_UPSTREAM_HOST" \
    "$CADDY_ADMIN_UPSTREAM_PORT" \
    "$CADDY_CHAT_UPSTREAM_HOST" \
    "$CADDY_CHAT_UPSTREAM_PORT"
  if [[ "$CADDY_PORTAL_DOMAINS_MANAGED" == "1" ]]; then
    append_extra_caddy_snippets "$rendered_config" "$CADDY_LEGACY_PORTAL_SNIPPET_FILE"
  else
    append_extra_caddy_snippets "$rendered_config"
  fi

  if command_exists caddy; then
    log_step "Validating Caddy config"
    run_as_root caddy validate --config "$rendered_config" --adapter caddyfile >/dev/null
  else
    log_warn "Caddy binary not found; writing config without validation"
  fi

  log_step "Updating Caddy config"
  run_as_root mkdir -p "$(dirname "$CADDY_CONFIG_FILE")"
  run_as_root install -m 644 "$rendered_config" "$CADDY_CONFIG_FILE"

  reload_caddy
  if [[ "$CADDY_PORTAL_DOMAINS_EXPLICIT" == "1" ]]; then
    persist_caddy_portal_domains
  fi

  rm -f "$rendered_config"
}

git_head() {
  run_as_app_user_shell "git -C '$APP_REPO_DIR' rev-parse '${1:-HEAD}'"
}

git_update() {
  PREVIOUS_HEAD="${DEPLOY_PREVIOUS_HEAD:-$(git_head)}"
  if [[ "$SKIP_GIT_PULL" == "1" || -n "$ACTIVATE_RELEASE" ]]; then
    log_info "Skipping git fetch/pull"
    # After a re-exec PREVIOUS_HEAD is the pre-pull checkout; deploy what is checked out now.
    TARGET_COMMIT="$(git_head)"
    return 0
  fi

  if [[ "$PLAN_ONLY" == "1" ]]; then
    log_step "Fetching $GIT_REMOTE/$GIT_REF for deploy plan"
    run_as_app_user_shell "cd '$APP_REPO_DIR' && git fetch '$GIT_REMOTE'"
    TARGET_COMMIT="$(git_head "$GIT_REMOTE/$GIT_REF")"
    return 0
  fi

  log_step "Updating repository checkout"
  local script_before
  script_before="$(cksum <"$script_path")"
  run_as_app_user_shell "cd '$APP_REPO_DIR' && git fetch '$GIT_REMOTE' && git checkout '$GIT_REF' && git pull --ff-only '$GIT_REMOTE' '$GIT_REF'"
  TARGET_COMMIT="$(git_head)"
  if [[ "$(cksum <"$script_path")" != "$script_before" ]]; then
    # Bash has already parsed this run's functions; re-exec so the pulled
    # deploy logic applies to this deploy rather than the next one.
    log_info "Deploy script changed in $TARGET_COMMIT; re-running the updated script"
    exec 9>&-
    DEPLOY_PREVIOUS_HEAD="$PREVIOUS_HEAD" exec bash "$script_path" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"} --skip-git-pull
  fi
}

acquire_deploy_lock() {
  require_command flock
  exec 9>>"$DEPLOY_LOCK_FILE"
  flock -n 9 || die "another deploy is already running (lock: $DEPLOY_LOCK_FILE)"
}

deploy_drain_file_for_role() {
  local role="$1"
  local dir name
  dir="$(dirname "$DEPLOY_DRAIN_FILE")"
  name="$(basename "$DEPLOY_DRAIN_FILE" .json)"
  printf '%s/%s-%s.json\n' "$dir" "$name" "$role"
}

# Drain only the role being restarted: draining chat rejects new conversations,
# draining admin must not.
enable_deploy_drain() {
  local role="$1"
  if [[ "$SKIP_AGENT_DRAIN" == "1" ]]; then
    log_info "Skipping deployment drain signal for $role"
    return 0
  fi

  local drain_target
  drain_target="$(deploy_drain_file_for_role "$role")"
  if [[ "$role" == "chat" ]]; then
    # Slot-aware chat instances only read their own slot file.
    local slot_target
    slot_target="$(deploy_drain_file_for_role "chat-$(active_chat_slot)")"
    write_drain_file "$slot_target"
    ACTIVE_DRAIN_FILES+=("$slot_target")
  fi
  log_step "Enabling deployment drain for $role"
  local drain_dir
  drain_dir="$(dirname "$drain_target")"
  if is_app_user; then
    mkdir -p "$drain_dir"
  else
    run_as_root mkdir -p "$drain_dir"
    run_as_root chown "$APP_USER:$APP_GROUP" "$drain_dir"
  fi

  write_drain_file "$drain_target"
  ACTIVE_DRAIN_FILES+=("$drain_target")
  log_info "Deployment drain file: $drain_target"
}

write_drain_file() {
  local drain_target="$1"
  local drain_file
  drain_file="$(mktemp)"
  python3 - "$drain_file" <<'PY'
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

Path(sys.argv[1]).write_text(json.dumps({
    "active": True,
    "reason": "System is updating. Please retry in a few minutes.",
    "started_at": datetime.now(timezone.utc).isoformat()
}, ensure_ascii=False, indent=2) + "\n")
PY

  if is_app_user; then
    mkdir -p "$(dirname "$drain_target")"
    install -m 644 "$drain_file" "$drain_target"
  else
    run_as_root mkdir -p "$(dirname "$drain_target")"
    run_as_root install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$drain_file" "$drain_target"
  fi
  rm -f "$drain_file"
}

remove_drain_file() {
  local drain_target="$1"
  [[ -e "$drain_target" ]] || return 0
  if is_app_user; then rm -f "$drain_target"; else run_as_root rm -f "$drain_target"; fi
}

disable_deploy_drain() {
  local role="$1"
  local drain_target
  [[ "$role" != "chat" ]] || remove_drain_file "$(deploy_drain_file_for_role "chat-$(active_chat_slot)")"
  drain_target="$(deploy_drain_file_for_role "$role")"
  [[ -e "$drain_target" ]] || return 0
  log_step "Disabling deployment drain for $role"
  if is_app_user; then
    rm -f "$drain_target"
  else
    run_as_root rm -f "$drain_target"
  fi
}

cleanup_deploy_drains() {
  local drain_target
  for drain_target in "${ACTIVE_DRAIN_FILES[@]}"; do
    if [[ -e "$drain_target" ]]; then
      if is_app_user; then rm -f "$drain_target"; else run_as_root rm -f "$drain_target"; fi
    fi
  done
  # The legacy shared drain file blocks every role; never leave it behind.
  if [[ -e "$DEPLOY_DRAIN_FILE" ]]; then
    if is_app_user; then rm -f "$DEPLOY_DRAIN_FILE"; else run_as_root rm -f "$DEPLOY_DRAIN_FILE"; fi
  fi
}

pm2_app_exists() {
  local app_name="$1"
  run_as_app_user_shell "pm2 describe '$app_name' >/dev/null 2>&1"
}

pm2_app_pid() {
  local app_name="$1"
  run_as_app_user_shell "pm2 pid '$app_name' 2>/dev/null | tail -n 1" | tr -dc '0-9'
}

# Blue-green chat: slot a is the original chat app, slot b runs beside it on
# the next port. releases/state/chat.slot names the slot serving new traffic.
chat_slot_app() {
  [[ "$1" == "b" ]] && printf '%s\n' "$PM2_CHAT_B_APP_NAME" || printf '%s\n' "$PM2_CHAT_APP_NAME"
}

chat_slot_port() {
  [[ "$1" == "b" ]] && printf '%s\n' "$CHAT_B_API_PORT" || printf '%s\n' "$CHAT_API_PORT"
}

other_chat_slot() {
  [[ "$1" == "b" ]] && printf 'a\n' || printf 'b\n'
}

local_api_host() {
  case "$API_HOST" in
    0.0.0.0|"") printf '127.0.0.1\n' ;;
    ::) printf '[::1]\n' ;;
    *) printf '%s\n' "$API_HOST" ;;
  esac
}

chat_slot_base_url() {
  printf 'http://%s:%s\n' "$(local_api_host)" "$(chat_slot_port "$1")"
}

pm2_app_status() {
  run_as_app_user_shell "pm2 jlist" 2>/dev/null | python3 -c '
import json, sys
name = sys.argv[1]
for app in json.load(sys.stdin):
    if app.get("name") == name:
        print(app.get("pm2_env", {}).get("status", ""))
        break
' "$1" || true
}

pm2_app_online() {
  [[ "$(pm2_app_status "$1")" == "online" ]]
}

active_chat_slot() {
  local slot
  slot="$(read_deploy_state chat.slot)"
  [[ "$slot" == "a" || "$slot" == "b" ]] || slot="a"
  printf '%s\n' "$slot"
}

# Prints a field of the slot's local status endpoint, or nothing when it is down.
chat_slot_status_field() {
  local slot="$1" field="$2" status_json
  status_json="$(curl -fsS --max-time 3 "$(chat_slot_base_url "$slot")/internal/deploy/drain-status" 2>/dev/null || true)"
  [[ -n "$status_json" ]] || return 0
  STATUS_JSON="$status_json" python3 - "$field" <<'PY' 2>/dev/null || true
import json, os, sys
payload = json.loads(os.environ.get("STATUS_JSON", "{}"))
field = sys.argv[1]
if field == "busy":
    value = payload.get("busy_count")
    if value is None:
        value = int(payload.get("active_runtime_turns", 0)) + len(payload.get("active_threads") or [])
elif field == "phase":
    value = (payload.get("retirement") or {}).get("phase", "")
else:
    value = payload.get(field, "")
print(str(value).lower() if isinstance(value, bool) else value)
PY
}

wait_for_chat_slot_ready() {
  local slot="$1" started elapsed
  started="$(date +%s)"
  log_step "Waiting for chat slot $slot to accept traffic"
  while true; do
    if curl -fsS --max-time 3 "$(chat_slot_base_url "$slot")/internal/ready" >/dev/null 2>&1; then
      log_info "Chat slot $slot is ready"
      return 0
    fi
    elapsed=$(( $(date +%s) - started ))
    (( elapsed < CHAT_READY_TIMEOUT_SECONDS )) || return 1
    sleep 2
  done
}

# A slot left online by an earlier switch (still retiring, or both started by a
# reboot) must hand over before it can be replaced. It exits by itself once its
# runs finish; past the retire limit it is stopped, which marks remaining runs
# as interrupted by a system update.
wait_for_chat_slot_exit() {
  local slot="$1" app started elapsed last_log=-60 busy
  app="$(chat_slot_app "$slot")"
  pm2_app_online "$app" || return 0
  log_step "Chat slot $slot is still running; letting it finish before reusing it"
  write_drain_file "$(deploy_drain_file_for_role "chat-$slot")"
  started="$(date +%s)"
  while pm2_app_online "$app"; do
    elapsed=$(( $(date +%s) - started ))
    if (( elapsed >= CHAT_RETIRE_MAX_SECONDS + 120 )); then
      log_warn "Chat slot $slot did not exit within ${elapsed}s; stopping it"
      run_as_app_user_shell "pm2 stop '$app'"
      break
    fi
    if (( elapsed - last_log >= 60 )); then
      busy="$(chat_slot_status_field "$slot" busy)"
      log_info "Chat slot $slot is finishing ${busy:-?} item(s) of work (${elapsed}s elapsed)"
      last_log="$elapsed"
    fi
    sleep "$AGENT_DRAIN_POLL_SECONDS"
  done
}

# The chat instance from before blue-green cannot retire by itself: Caddy's
# readiness check already sends it no new traffic, so wait for its runs to end.
retire_legacy_chat_instance() {
  local slot="$1" app started elapsed idle=0 last_log=-60 busy
  app="$(chat_slot_app "$slot")"
  log_step "Waiting for the pre-blue-green chat instance to finish its runs (new conversations already use the new slot)"
  started="$(date +%s)"
  while pm2_app_online "$app"; do
    busy="$(chat_slot_status_field "$slot" busy)"
    if [[ "${busy:-0}" == "0" ]]; then
      idle=$((idle + 1))
      (( idle >= 2 )) && break
    else
      idle=0
    fi
    elapsed=$(( $(date +%s) - started ))
    if (( elapsed >= CHAT_RETIRE_MAX_SECONDS )); then
      log_warn "Pre-blue-green chat instance still has ${busy:-?} active item(s) after ${elapsed}s; stopping it"
      break
    fi
    if (( elapsed - last_log >= 60 )); then
      log_info "Pre-blue-green chat instance has ${busy:-?} active item(s) (${elapsed}s elapsed)"
      last_log="$elapsed"
    fi
    sleep "$AGENT_DRAIN_POLL_SECONDS"
  done
  # Removed rather than stopped so a reboot cannot resurrect its old definition;
  # the next switch starts this slot from the ecosystem file.
  run_as_app_user_shell "pm2 delete '$app'" || true
  remove_drain_file "$(deploy_drain_file_for_role chat)"
}

switch_chat_slot() {
  local active target active_app target_app legacy=0
  active="$(active_chat_slot)"
  [[ -n "$(read_deploy_state chat.slot)" ]] || legacy=1
  # Serve from whichever slot is actually up if the recorded one is not.
  if ! pm2_app_online "$(chat_slot_app "$active")" && pm2_app_online "$(chat_slot_app "$(other_chat_slot "$active")")"; then
    active="$(other_chat_slot "$active")"
    legacy=0
  fi
  target="$(other_chat_slot "$active")"
  active_app="$(chat_slot_app "$active")"
  target_app="$(chat_slot_app "$target")"
  log_step "Blue-green chat switch: slot $active -> slot $target"

  wait_for_chat_slot_exit "$target"
  remove_drain_file "$(deploy_drain_file_for_role "chat-$target")"
  if pm2_app_exists "$target_app"; then
    run_as_app_user_shell "pm2 delete '$target_app'"
  fi
  run_as_app_user_shell "pm2 start '$PM2_ECOSYSTEM_FILE' --only '$target_app' --update-env"
  if ! wait_for_chat_slot_ready "$target"; then
    run_as_app_user_shell "pm2 stop '$target_app'" || true
    die "chat slot $target did not become ready within ${CHAT_READY_TIMEOUT_SECONDS}s; slot $active keeps serving"
  fi

  # Caddy must health-check both slots before the old one stops being ready.
  if [[ "$legacy" == "1" ]] || deploy_refreshes_caddy; then
    refresh_caddy_config
    CADDY_REFRESHED=1
  fi

  write_deploy_state chat-retiring.release "$(read_deploy_state chat.release)"
  write_deploy_state chat.slot "$target"
  run_as_app_user_shell "pm2 save" || true
  if ! pm2_app_online "$active_app"; then
    log_info "Chat slot $active was not running; nothing to retire"
  elif [[ "$legacy" == "1" ]]; then
    retire_legacy_chat_instance "$active"
  else
    # The old slot sees the ready peer, stops being ready (Caddy moves new
    # requests within a second), finishes its runs and exits by itself.
    write_drain_file "$(deploy_drain_file_for_role "chat-$active")"
    local started phase
    started="$(date +%s)"
    while true; do
      phase="$(chat_slot_status_field "$active" phase)"
      if [[ -z "$phase" || "$phase" != "active" ]]; then
        log_info "Chat slot $active is retiring; it exits after its in-flight runs (limit ${CHAT_RETIRE_MAX_SECONDS}s)"
        break
      fi
      if (( $(date +%s) - started >= 30 )); then
        log_warn "Chat slot $active has not started retiring yet; it keeps its drain file and retires once it sees slot $target"
        break
      fi
      sleep 1
    done
  fi
}

check_migration_compat() {
  local base="${1:-$PREVIOUS_HEAD}"
  log_step "Checking new migrations stay compatible with the running release"
  local args=(--repo "$APP_REPO_DIR" --base "$base" --head "$TARGET_COMMIT")
  [[ "$ALLOW_BREAKING_MIGRATION" == "1" ]] && args+=(--allow-breaking)
  run_as_app_user node "$script_dir/check-migration-compat.mjs" "${args[@]}" ||
    die "migration compatibility check failed; see the BREAKING lines above"
}

drain_status_url_for_port() {
  local status_port="$1"
  local status_host="$API_HOST"
  if [[ "$status_host" == "0.0.0.0" || "$status_host" == "::" ]]; then
    status_host="127.0.0.1"
  fi
  printf 'http://%s:%s/internal/deploy/drain-status\n' "$status_host" "$status_port"
}

active_agent_run_count() {
  local api_pid="$1"
  local status_url="$2"
  [[ -n "$api_pid" && "$api_pid" != "0" ]] || {
    printf '%s\n' "0"
    return 0
  }
  local status_json
  status_json="$(curl -fsS --max-time 2 "$status_url" 2>/dev/null || true)"
  if [[ -n "$status_json" ]]; then
    local status_count
    status_count="$(STATUS_JSON="$status_json" python3 - <<'PY' 2>/dev/null || true
import json
import os
import sys

try:
    payload = json.loads(os.environ.get("STATUS_JSON", "{}"))
except Exception:
    sys.exit(1)

# Slot-aware releases report everything that keeps them busy; older ones only runtime turns.
value = payload.get("busy_count", payload.get("active_runtime_turns", 0))
try:
    value = int(value)
except Exception:
    sys.exit(1)
if value < 0:
    value = 0
print(value)
PY
)"
    if [[ "$status_count" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$status_count"
      return 0
    fi
  fi
  ps -eo ppid=,args= | awk -v api_pid="$api_pid" '
    $1 == api_pid && (index($0, "codex exec") > 0 || index($0, "codex app-server") > 0) { count++ }
    END { print count + 0 }
  '
}

pm2_app_name_for_role() {
  [[ "$1" == "chat" ]] && chat_slot_app "$(active_chat_slot)" || printf '%s\n' "$PM2_ADMIN_APP_NAME"
}

active_runs_for_role() {
  local role="$1"
  local app_name pid status_url
  app_name="$(pm2_app_name_for_role "$role")"
  pm2_app_exists "$app_name" || { printf '0\n'; return 0; }
  pid="$(pm2_app_pid "$app_name" || true)"
  if [[ "$role" == "chat" ]]; then
    status_url="${AGENT_CHAT_DRAIN_STATUS_URL:-${AGENT_DRAIN_STATUS_URL:-$(drain_status_url_for_port "$(chat_slot_port "$(active_chat_slot)")")}}"
  else
    status_url="${AGENT_ADMIN_DRAIN_STATUS_URL:-$(drain_status_url_for_port "$ADMIN_API_PORT")}"
  fi
  active_agent_run_count "$pid" "$status_url"
}

# Drained wait: new runs on this role are rejected while existing ones finish.
wait_for_role_drain() {
  local role="$1"
  if [[ "$SKIP_AGENT_DRAIN" == "1" ]]; then
    log_info "Skipping active agent run wait for $role"
    return 0
  fi
  log_step "Waiting for active $role runs to finish"
  local started elapsed active_count
  started="$(date +%s)"
  while true; do
    active_count="$(active_runs_for_role "$role")"
    if [[ "$active_count" == "0" ]]; then
      log_info "No active $role runs remain"
      return 0
    fi
    elapsed=$(( $(date +%s) - started ))
    if (( elapsed >= AGENT_DRAIN_TIMEOUT_SECONDS )); then
      log_warn "Timed out waiting for $active_count active $role run(s); deployment stopped before restart"
      return 1
    fi
    log_info "Waiting for $active_count active $role run(s) before restart (${elapsed}s elapsed)"
    sleep "$AGENT_DRAIN_POLL_SECONDS"
  done
}

restart_role_with_drain() {
  local role="$1"
  enable_deploy_drain "$role"
  wait_for_role_drain "$role" || die "$role still has active runs after ${AGENT_DRAIN_TIMEOUT_SECONDS}s"
  restart_pm2_app "$(pm2_app_name_for_role "$role")"
  disable_deploy_drain "$role"
}

# Wait without draining: conversations keep starting normally until chat is
# naturally idle, then drain only for the few seconds the restart takes.
restart_chat_when_idle() {
  log_step "Waiting for chat to become idle (no drain, up to ${CHAT_IDLE_TIMEOUT_SECONDS}s)"
  local started elapsed active_count last_log=-60
  started="$(date +%s)"
  while true; do
    active_count="$(active_runs_for_role chat)"
    if [[ "$active_count" == "0" ]]; then
      enable_deploy_drain chat
      # A run may have started between the check and the drain signal.
      active_count="$(active_runs_for_role chat)"
      if [[ "$active_count" == "0" ]]; then
        restart_pm2_app "$(pm2_app_name_for_role chat)"
        disable_deploy_drain chat
        return 0
      fi
      disable_deploy_drain chat
      log_info "A chat run started while preparing the restart; waiting again"
    fi
    elapsed=$(( $(date +%s) - started ))
    if (( elapsed >= CHAT_IDLE_TIMEOUT_SECONDS )); then
      log_warn "Chat did not become idle within ${CHAT_IDLE_TIMEOUT_SECONDS}s ($active_count active run(s)); chat restart left pending"
      return 1
    fi
    if (( elapsed - last_log >= 60 )); then
      log_info "Chat has $active_count active run(s); new conversations are still accepted (${elapsed}s elapsed)"
      last_log="$elapsed"
    fi
    sleep "$AGENT_DRAIN_POLL_SECONDS"
  done
}

sanitize_frontend_env() {
  if ! grep -Eq '^[[:space:]]*NODE_ENV[[:space:]]*=' "$FRONTEND_ENV_FILE"; then
    return 0
  fi

  log_info "Removing unsupported NODE_ENV from frontend env file: $FRONTEND_ENV_FILE"
  python3 - "$FRONTEND_ENV_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
rendered = []
changed = False

for raw_line in path.read_text().splitlines():
    stripped = raw_line.strip()
    if stripped and not stripped.startswith("#") and "=" in raw_line:
        key = raw_line.split("=", 1)[0].strip()
        if key == "NODE_ENV":
            changed = True
            continue
    rendered.append(raw_line)

if changed:
    path.write_text("\n".join(rendered).rstrip() + "\n")
PY
}

# Shared runtime ("共享运行环境"): Python packages, command-line tools, Playwright
# browsers and download caches every conversation reuses. Lists live in scripts/shared-runtime/.
shared_runtime_dir="$script_dir/shared-runtime"
SHARED_BROWSERS_ROOT="$SHARED_RUNTIME_CACHE_ROOT/ms-playwright"

ensure_shared_python_runtime_dirs() {
  log_step "Preparing shared runtime directories"
  run_as_root mkdir -p \
    "$SHARED_RUNTIME_ROOT" \
    "$SHARED_PYTHON_RUNTIME_ROOT" \
    "$SHARED_PYTHON_PIP_CACHE_ROOT" \
    "$SHARED_ARGOS_PACKAGE_ROOT" \
    "$SHARED_ARGOS_DOWNLOAD_ROOT" \
    "$SHARED_RUNTIME_STATE_ROOT" \
    "$SHARED_BROWSERS_ROOT" \
    "$SHARED_RUNTIME_CACHE_ROOT/npm" \
    "$SHARED_RUNTIME_CACHE_ROOT/uv" \
    "$SHARED_RUNTIME_CACHE_ROOT/uv-python" \
    "$SHARED_RUNTIME_CACHE_ROOT/huggingface"
  run_as_root chown "$APP_USER:$APP_GROUP" "$SHARED_RUNTIME_ROOT" "$SHARED_RUNTIME_STATE_ROOT"
  run_as_root chown -R "$APP_USER:$APP_GROUP" \
    "$(dirname "$SHARED_PYTHON_RUNTIME_ROOT")" \
    "$SHARED_ARGOS_PACKAGE_ROOT" \
    "$SHARED_ARGOS_DOWNLOAD_ROOT" \
    "$SHARED_RUNTIME_CACHE_ROOT"
}

migrate_legacy_translate_packages() {
  local legacy_path="/tmp/baicells_translate_pkgs"
  [[ -d "$legacy_path" && ! -L "$legacy_path" ]] || return 0
  [[ ! -d "$SHARED_PYTHON_RUNTIME_ROOT/argostranslate" ]] || return 0

  local runtime_has_files
  runtime_has_files="$(find "$SHARED_PYTHON_RUNTIME_ROOT" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null || true)"
  if [[ -n "$runtime_has_files" ]]; then
    log_warn "Shared Python runtime already has files; keeping legacy translate package at $legacy_path"
    return 0
  fi

  log_step "Migrating legacy translate packages into shared Python runtime"
  run_as_root rmdir "$SHARED_PYTHON_RUNTIME_ROOT"
  run_as_root mv "$legacy_path" "$SHARED_PYTHON_RUNTIME_ROOT"
  run_as_root chown -R "$APP_USER:$APP_GROUP" "$SHARED_PYTHON_RUNTIME_ROOT"
}

ensure_legacy_translate_symlink() {
  local legacy_path="/tmp/baicells_translate_pkgs"
  if [[ -e "$legacy_path" && ! -L "$legacy_path" ]]; then
    return 0
  fi
  run_as_root ln -sfn "$SHARED_PYTHON_RUNTIME_ROOT" "$legacy_path"
}

shared_python_env_prefix() {
  printf 'PYTHONPATH=%s PIP_CACHE_DIR=%s ARGOS_PACKAGE_DIR=%s ARGOS_DOWNLOAD_DIR=%s PLAYWRIGHT_BROWSERS_PATH=%s' \
    "$(shell_quote "$SHARED_PYTHON_RUNTIME_ROOT")" \
    "$(shell_quote "$SHARED_PYTHON_PIP_CACHE_ROOT")" \
    "$(shell_quote "$SHARED_ARGOS_PACKAGE_ROOT")" \
    "$(shell_quote "$SHARED_ARGOS_DOWNLOAD_ROOT")" \
    "$(shell_quote "$SHARED_BROWSERS_ROOT")"
}

check_shared_python_runtime_imports() {
  local env_prefix
  env_prefix="$(shared_python_env_prefix)"
  run_as_app_user_shell "$env_prefix python3 '$shared_runtime_dir/check-python.py'"
}

install_shared_python_runtime_packages() {
  local requirements="$shared_runtime_dir/python-requirements.txt"
  [[ -f "$requirements" ]] || die "missing shared Python runtime requirements: $requirements"
  run_as_app_user_shell "python3 -m pip --version >/dev/null 2>&1" || die "python3 pip is required for shared Python runtime"

  log_step "Installing shared Python runtime packages"
  local env_prefix
  env_prefix="$(shared_python_env_prefix)"
  run_as_app_user_shell "$env_prefix python3 -m pip install --upgrade --target '$SHARED_PYTHON_RUNTIME_ROOT' -r '$requirements'"
}

# Command-line tools agents call directly (ImageMagick, ffmpeg, zip, 7z, ...). A failed
# apt run only warns: the admin console shows the missing tools and chat still deploys.
ensure_shared_runtime_system_packages() {
  local list="$shared_runtime_dir/system-packages.txt"
  [[ -f "$list" ]] || die "missing shared runtime system package list: $list"
  command -v dpkg-query >/dev/null 2>&1 || {
    log_warn "dpkg-query not found; skipping shared runtime system packages"
    return 0
  }
  local missing=() package
  while IFS= read -r package; do
    package="${package%%#*}"
    package="${package//[[:space:]]/}"
    [[ -n "$package" ]] || continue
    dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || missing+=("$package")
  done < "$list"
  if [[ "${#missing[@]}" -eq 0 ]]; then
    log_info "Shared runtime system packages are installed"
    return 0
  fi
  log_step "Installing shared runtime system packages: $(printf '%s ' "${missing[@]}")"
  if run_as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq &&
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"; then
    log_info "Installed shared runtime system packages"
  else
    log_warn "Shared runtime system packages failed to install: $(printf '%s ' "${missing[@]}")"
  fi
}

smoke_shared_browser() {
  local env_prefix
  env_prefix="$(shared_python_env_prefix)"
  run_as_app_user_shell "cd /tmp && $env_prefix timeout 90 python3 '$shared_runtime_dir/smoke-browser.py'"
}

# Chromium for Playwright lives once in the shared cache; agents installing another
# Playwright version add their own revision next to it.
ensure_shared_browsers() {
  log_step "Checking shared Playwright Chromium"
  local env_prefix
  env_prefix="$(shared_python_env_prefix)"
  if ! run_as_app_user_shell "$env_prefix python3 -m playwright install chromium"; then
    log_warn "Playwright Chromium download failed; browser tasks fall back to per-thread installs"
    return 0
  fi
  if smoke_shared_browser; then
    return 0
  fi
  log_info "Installing Chromium system libraries"
  run_as_root env DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH="$SHARED_PYTHON_RUNTIME_ROOT" PLAYWRIGHT_BROWSERS_PATH="$SHARED_BROWSERS_ROOT" \
    python3 -m playwright install-deps chromium || true
  smoke_shared_browser || log_warn "Shared Chromium still fails to launch; check the admin console shared runtime page"
}

ensure_shared_python_runtime() {
  ensure_shared_python_runtime_dirs
  migrate_legacy_translate_packages
  ensure_shared_python_runtime_dirs
  ensure_shared_runtime_system_packages

  if check_shared_python_runtime_imports; then
    log_info "Shared Python runtime imports are ready"
  else
    install_shared_python_runtime_packages
    check_shared_python_runtime_imports || die "shared Python runtime import check failed after installation"
  fi

  ensure_shared_browsers
  ensure_legacy_translate_symlink
}

# Root-owned copies of the cleanup and gap-scan jobs plus their systemd timers. The jobs
# read and write only files under SHARED_RUNTIME_STATE_ROOT for the admin console.
install_shared_runtime_maintenance() {
  command -v systemctl >/dev/null 2>&1 || {
    log_warn "systemctl not found; shared runtime cleanup and gap scan are not scheduled"
    return 0
  }
  local data_root template_dir="$script_dir/../templates/shared-runtime" changed=0
  data_root="$(dirname "$SHARED_RUNTIME_ROOT")"
  run_as_root mkdir -p /usr/local/lib/agent-studio "$SHARED_RUNTIME_STATE_ROOT"
  run_as_root chown "$APP_USER:$APP_GROUP" "$SHARED_RUNTIME_STATE_ROOT"

  install_if_changed() {
    local source="$1" destination="$2" mode="$3"
    if run_as_root cmp -s "$source" "$destination" 2>/dev/null; then
      return 0
    fi
    run_as_root install -o root -g root -m "$mode" "$source" "$destination"
    changed=1
  }

  install_if_changed "$shared_runtime_dir/thread-cleanup.sh" /usr/local/sbin/agent-studio-thread-tmp-cleanup 755
  install_if_changed "$shared_runtime_dir/gap-scan.py" /usr/local/lib/agent-studio/runtime-gap-scan.py 755
  install_if_changed "$shared_runtime_dir/codex-home-dedupe.py" /usr/local/lib/agent-studio/codex-home-dedupe.py 755
  install_if_changed "$shared_runtime_dir/disk-usage-snapshot.py" /usr/local/lib/agent-studio/disk-usage-snapshot.py 755

  local unit rendered
  local timers=(agent-studio-thread-tmp-cleanup agent-studio-runtime-gap-scan agent-studio-codex-home-dedupe
    agent-studio-disk-usage-snapshot)
  for unit in "${timers[@]/%/.service}" "${timers[@]/%/.timer}"; do
    rendered="$(mktemp)"
    sed \
      -e "s#__DATA_ROOT__#$data_root#g" \
      -e "s#__STATE_ROOT__#$SHARED_RUNTIME_STATE_ROOT#g" \
      -e "s#__SESSIONS_ROOT__#$data_root/sessions#g" \
      -e "s#__CODEX_HOMES_ROOT__#$APP_API_DIR/temp/codex-homes#g" \
      -e "s#__SHARED_RUNTIME_ROOT__#$SHARED_RUNTIME_ROOT#g" \
      -e "s#__APP_REPO_DIR__#$APP_REPO_DIR#g" \
      -e "s#__APP_HOME__#$APP_HOME#g" \
      -e "s#__APP_USER__#$APP_USER#g" \
      -e "s#__APP_GROUP__#$APP_GROUP#g" \
      "$template_dir/$unit.template" > "$rendered"
    install_if_changed "$rendered" "/etc/systemd/system/$unit" 644
    rm -f "$rendered"
  done
  unset -f install_if_changed

  if [[ "$changed" == "1" ]]; then
    run_as_root systemctl daemon-reload
    log_info "Installed shared runtime cleanup and gap scan jobs"
  fi
  run_as_root systemctl enable --now "${timers[@]/%/.timer}" >/dev/null 2>&1 ||
    log_warn "failed to enable shared runtime maintenance timers"
  # Produce the first reports right away instead of waiting for the nightly timers.
  local state_file
  for unit in agent-studio-runtime-gap-scan:runtime-gaps.json agent-studio-codex-home-dedupe:codex-home-dedupe-last-run.json \
    agent-studio-disk-usage-snapshot:disk-usage.json; do
    state_file="$SHARED_RUNTIME_STATE_ROOT/${unit#*:}"
    if ! run_as_root test -f "$state_file"; then
      run_as_root systemctl start --no-block "${unit%%:*}.service" || true
    fi
  done
}

check_plugin_runtime() {
  local roots=(
    "$APP_HOME/.codex"
    "$APP_API_DIR/temp/codex-homes"
  )
  local runtime_path="$SHARED_CODEX_RUNTIME_ROOT/dependencies/bin/override:$SHARED_CODEX_RUNTIME_ROOT/dependencies/node/bin:$PATH:$SHARED_CODEX_RUNTIME_ROOT/dependencies/bin/fallback"
  local command=(
    env
    "PATH=$runtime_path"
    "FONTCONFIG_FILE=$SHARED_CODEX_RUNTIME_ROOT/dependencies/fontconfig/fonts.conf"
    node "$script_dir/check-plugin-runtime.mjs"
    --requirements "$script_dir/plugin-runtime-requirements.json"
    --node-modules "$SHARED_CODEX_RUNTIME_NODE_MODULES"
    --python-root "$SHARED_PYTHON_RUNTIME_ROOT"
    --all-registered
  )
  local root
  for root in "${roots[@]}"; do
    [[ -e "$root" ]] || continue
    command+=(--plugin-root "$root")
  done
  run_as_app_user "${command[@]}" &&
    run_as_app_user env \
      "PATH=$runtime_path" \
      "FONTCONFIG_FILE=$SHARED_CODEX_RUNTIME_ROOT/dependencies/fontconfig/fonts.conf" \
      node "$script_dir/smoke-shared-plugin-runtime.mjs" \
      --runtime-root "$SHARED_CODEX_RUNTIME_ROOT" \
      --python-root "$SHARED_PYTHON_RUNTIME_ROOT"
}

install_shared_codex_runtime_archive() {
  [[ -f "$SHARED_CODEX_RUNTIME_ARCHIVE" ]] ||
    die "shared Codex runtime is incomplete and archive is missing: $SHARED_CODEX_RUNTIME_ARCHIVE"

  log_step "Installing shared Codex plugin runtime"
  local runtime_parent staging previous
  runtime_parent="$(dirname "$SHARED_CODEX_RUNTIME_ROOT")"
  staging="$runtime_parent/.codex-primary-runtime.$$.staging"
  previous="$runtime_parent/.codex-primary-runtime.$$.previous"
  run_as_root mkdir -p "$runtime_parent"
  run_as_root rm -rf "$staging" "$previous"
  run_as_root mkdir -p "$staging"
  if run_as_root tar -tzf "$SHARED_CODEX_RUNTIME_ARCHIVE" |
    grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die "shared Codex runtime archive contains an unsafe path: $SHARED_CODEX_RUNTIME_ARCHIVE"
  fi
  run_as_root tar -xzf "$SHARED_CODEX_RUNTIME_ARCHIVE" -C "$staging"
  run_as_root test -d "$staging/dependencies/node/node_modules" ||
    die "shared Codex runtime archive has an invalid layout: $SHARED_CODEX_RUNTIME_ARCHIVE"
  run_as_root chown -R root:root "$staging"
  run_as_root chmod -R a+rX,a-w "$staging"
  if run_as_root test -e "$SHARED_CODEX_RUNTIME_ROOT"; then
    run_as_root mv "$SHARED_CODEX_RUNTIME_ROOT" "$previous"
  fi
  run_as_root mv "$staging" "$SHARED_CODEX_RUNTIME_ROOT"
  if check_plugin_runtime; then
    run_as_root rm -rf "$previous"
    return 0
  fi
  run_as_root rm -rf "$SHARED_CODEX_RUNTIME_ROOT"
  if run_as_root test -e "$previous"; then
    run_as_root mv "$previous" "$SHARED_CODEX_RUNTIME_ROOT"
  fi
  die "installed plugin runtime check failed after shared runtime installation"
}

ensure_shared_plugin_runtime() {
  log_step "Checking installed plugin runtime requirements"
  run_as_root mkdir -p "$SHARED_CODEX_RUNTIME_ROOT"
  if check_plugin_runtime; then
    log_info "Installed plugin runtimes are ready"
    return 0
  fi

  install_shared_codex_runtime_archive
}

# Codex plugins kept in the repo (scripts/shared-runtime/codex-plugins) are copied into the
# local marketplace and installed into the base CODEX_HOME; conversation homes link to its
# plugin cache, so new conversations use them without a chat restart. A failure only warns:
# the admin console shows the plugin as out of sync and conversations keep the old version.
sync_managed_codex_plugins() {
  local source="$shared_runtime_dir/codex-plugins"
  [[ -d "$source" ]] || return 0
  local codex_bin="$APP_API_DIR/node_modules/.bin/codex"
  run_as_app_user test -x "$codex_bin" || codex_bin="codex"
  log_step "Syncing repository-managed Codex plugins"
  run_as_root mkdir -p "$SHARED_RUNTIME_STATE_ROOT"
  run_as_root chown "$APP_USER:$APP_GROUP" "$SHARED_RUNTIME_STATE_ROOT"
  if run_as_app_user node "$shared_runtime_dir/sync-codex-plugins.mjs" \
    --source "$source" \
    --codex-home "$APP_HOME/.codex" \
    --codex-bin "$codex_bin" \
    --state "$SHARED_RUNTIME_STATE_ROOT/codex-plugins.json"; then
    log_info "Repository-managed Codex plugins are installed"
  else
    log_warn "Repository-managed Codex plugin sync failed; see the admin console shared runtime page"
  fi
}

build_backend() {
  local api_dir="$1"
  log_step "Installing backend dependencies"
  run_as_app_user_shell "cd '$api_dir' && NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_PREFER_OFFLINE=true npm ci"

  log_step "Verifying project-pinned Codex runtime"
  run_as_app_user_shell "cd '$api_dir' && expected=\$(node -p \"require('./node_modules/@openai/codex-sdk/package.json').version\") && package_version=\$(node -p \"require('./node_modules/@openai/codex/package.json').version\") && runtime_version=\$(node_modules/.bin/codex --version) && test \"\$package_version\" = \"\$expected\" && test \"\$runtime_version\" = \"codex-cli \$expected\" && printf 'Codex SDK, package and runtime verified at %s\\n' \"\$expected\""

  log_step "Generating Prisma client"
  run_as_app_user_shell "cd '$api_dir' && npm run prisma:generate"

  log_step "Applying database migrations"
  run_as_app_user_shell "cd '$api_dir' && npx prisma migrate deploy"

  log_step "Building backend"
  run_as_app_user_shell "cd '$api_dir' && npm run build"
}

release_commit() {
  local release_dir="$1"
  [[ -f "$release_dir/COMMIT" ]] || return 0
  tr -d '[:space:]' < "$release_dir/COMMIT"
}

current_release_dir() {
  local target
  target="$(readlink "$APP_API_DIR/dist" 2>/dev/null || true)"
  [[ "$target" == "$RELEASES_DIR/"*/agent-api/dist ]] || return 0
  printf '%s\n' "${target%/agent-api/dist}"
}

# Each backend build gets its own directory (code, node_modules, Prisma client),
# so building never rewrites files that running processes still load lazily.
# Releases only contain agent-api, so commits with an identical agent-api tree
# (for example deploy tooling changes) can share one build.
same_backend_tree() {
  local release="$1" target="$2" release_tree target_tree
  [[ -n "$release" ]] || return 1
  release_tree="$(run_as_app_user_shell "git -C '$APP_REPO_DIR' rev-parse --verify --quiet '$release:agent-api'" 2>/dev/null)" || return 1
  target_tree="$(run_as_app_user_shell "git -C '$APP_REPO_DIR' rev-parse --verify --quiet '$target:agent-api'" 2>/dev/null)" || return 1
  [[ "$release_tree" == "$target_tree" ]]
}

build_backend_release() {
  local current
  current="$(current_release_dir)"
  if [[ -n "$current" && -f "$current/agent-api/dist/index.js" ]] &&
    same_backend_tree "$(release_commit "$current")" "$TARGET_COMMIT"; then
    log_info "Reusing release $(basename "$current"); agent-api is unchanged at $TARGET_COMMIT"
    RELEASE_DIR="$current"
    return 0
  fi

  check_migration_compat "$(release_commit "$current")"

  local release_id
  release_id="$(date -u +%Y%m%dT%H%M%SZ)-${TARGET_COMMIT:0:12}"
  RELEASE_DIR="$RELEASES_DIR/$release_id"
  log_step "Preparing backend release $release_id"
  run_as_app_user_shell "mkdir -p '$RELEASE_DIR' && git -C '$APP_REPO_DIR' archive --format=tar '$TARGET_COMMIT' agent-api | tar -x -C '$RELEASE_DIR' && ln -s '$BACKEND_ENV_FILE' '$RELEASE_DIR/agent-api/.env'"
  build_backend "$RELEASE_DIR/agent-api"
  write_release_commit "$RELEASE_DIR" "$TARGET_COMMIT"
}

write_release_commit() {
  run_as_app_user_shell "printf '%s\\n' '$2' > '$1/COMMIT'"
}

# dist and node_modules under agent-api become symlinks to the active release so
# PM2 and ops scripts keep their paths. Node resolves the entry point to its real
# path, which keeps an already running process on the release it started with.
activate_release() {
  local release_dir="$1"
  [[ -f "$release_dir/agent-api/dist/index.js" && -d "$release_dir/agent-api/node_modules" ]] ||
    die "release is incomplete: $release_dir"
  log_step "Activating release $(basename "$release_dir")"
  local legacy_dir="" name
  for name in dist node_modules; do
    run_as_app_user_shell "ln -sfn '$release_dir/agent-api/$name' '$APP_API_DIR/.$name.next'"
    if [[ -d "$APP_API_DIR/$name" && ! -L "$APP_API_DIR/$name" ]]; then
      # First activation: keep the in-place build for processes still using it.
      if [[ -z "$legacy_dir" ]]; then
        legacy_dir="$RELEASES_DIR/legacy-$(date -u +%Y%m%dT%H%M%SZ)"
        run_as_app_user_shell "mkdir -p '$legacy_dir/agent-api'"
        write_release_commit "$legacy_dir" "$PREVIOUS_HEAD"
      fi
      run_as_app_user_shell "mv '$APP_API_DIR/$name' '$legacy_dir/agent-api/$name'"
    fi
    run_as_app_user_shell "mv -Tf '$APP_API_DIR/.$name.next' '$APP_API_DIR/$name'"
  done
  if [[ -n "$legacy_dir" ]]; then
    local role
    for role in admin chat; do
      [[ -n "$(read_deploy_state "$role.release")" ]] || write_deploy_state "$role.release" "$(basename "$legacy_dir")"
    done
  fi
}

# Keep the active release, any release a running app may still use, and the
# newest few for rollback.
prune_releases() {
  [[ -d "$RELEASES_DIR" ]] || return 0
  local keep=() current role release
  current="$(current_release_dir)"
  [[ -n "$current" ]] && keep+=("$(basename "$current")")
  for role in admin chat chat-retiring; do
    release="$(read_deploy_state "$role.release")"
    [[ -n "$release" ]] && keep+=("$release")
  done
  local candidates=() index=0 name
  while IFS= read -r name; do
    candidates+=("$name")
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d \( -name '20*' -o -name 'legacy-*' \) -printf '%f\n' | sort -r)
  for name in "${candidates[@]}"; do
    if [[ " ${keep[*]} " == *" $name "* ]]; then
      continue
    fi
    if [[ "$name" != legacy-* ]]; then
      index=$((index + 1))
      (( index <= RELEASE_RETENTION )) && continue
    fi
    log_info "Removing old release $name"
    run_as_app_user_shell "rm -rf '$RELEASES_DIR/$name'"
  done
}

migrate_portal_user_workspaces() {
  local workspace_storage_root legacy_workspace_storage_root legacy_import_marker
  workspace_storage_root="$(run_as_app_user_shell "cd '$APP_API_DIR' && NODE_ENV=production node --input-type=module -e \"import('./dist/config.js').then(({ appConfig }) => process.stdout.write(appConfig.userWorkspaceStorageRoot))\"")"
  [[ -n "$workspace_storage_root" && "$workspace_storage_root" == /* && "$workspace_storage_root" != "/" ]] ||
    die "resolved user workspace storage root is unsafe"
  log_step "Preparing persistent Portal workspace storage"
  run_as_root install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$workspace_storage_root"

  # The first rollout of persistent workspaces could resolve the development
  # fallback while the deployment shell itself had no NODE_ENV. Preserve any
  # already-migrated immutable objects by copying them once into the production
  # root; never remove or overwrite the source during recovery.
  legacy_workspace_storage_root="$APP_API_DIR/temp/user-workspaces"
  legacy_import_marker="$workspace_storage_root/.legacy-runtime-root-imported"
  if [[ "$legacy_workspace_storage_root" != "$workspace_storage_root" ]] &&
    run_as_root test -d "$legacy_workspace_storage_root" &&
    ! run_as_root test -f "$legacy_import_marker"; then
    log_step "Recovering previously migrated workspace objects into the production storage root"
    run_as_app_user_shell "cp -a '$legacy_workspace_storage_root/.' '$workspace_storage_root/'"
    run_as_app_user_shell "touch '$legacy_import_marker'"
  fi

  log_step "Adapting historical Portal tasks and files into user workspaces"
  run_as_app_user_shell "cd '$APP_API_DIR' && NODE_ENV=production npm run workspace:migrate"
}

seed_rbac() {
  if [[ "$SKIP_RBAC_SEED" == "1" ]]; then
    log_info "Skipping RBAC seed"
    return 0
  fi

  log_step "Seeding system RBAC"
  run_as_app_user_shell "cd '$APP_API_DIR' && node --input-type=module <<'EOF'
import { createDbClient } from './dist/db/client.js';
import { RoleRepository } from './dist/persistence/role-repository.js';
import { PermissionRepository } from './dist/persistence/permission-repository.js';
import { RolePermissionRepository } from './dist/persistence/role-permission-repository.js';
import { SeedSystemRbacService } from './dist/rbac/seed-system-rbac.js';

const db = createDbClient();
try {
  const service = new SeedSystemRbacService({
    roles: new RoleRepository(db),
    permissions: new PermissionRepository(db),
    rolePermissions: new RolePermissionRepository(db)
  });
  await service.run();
} finally {
  await db.\$disconnect();
}
EOF"
}

build_frontend() {
  log_step "Installing frontend dependencies"
  run_as_app_user_shell "cd '$APP_UI_DIR' && NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_PREFER_OFFLINE=true npm ci"

  log_step "Building frontend"
  sanitize_frontend_env
  local frontend_node_options
  frontend_node_options="$(shell_quote "$FRONTEND_BUILD_NODE_OPTIONS")"
  if [[ -n "$ASSET_RETENTION_DAYS" ]]; then
    local asset_retention_days
    asset_retention_days="$(shell_quote "$ASSET_RETENTION_DAYS")"
    run_as_app_user_shell "cd '$APP_UI_DIR' && unset NODE_ENV && NODE_OPTIONS=$frontend_node_options AGENT_STUDIO_ASSET_RETENTION_DAYS=$asset_retention_days npm run build"
  else
    run_as_app_user_shell "cd '$APP_UI_DIR' && unset NODE_ENV && NODE_OPTIONS=$frontend_node_options npm run build"
  fi

  [[ -f "$APP_UI_DIR/dist/index.html" ]] || die "frontend build did not produce dist/index.html"
  [[ -f "$APP_UI_DIR/dist/version.json" ]] || die "frontend build did not produce dist/version.json"
  [[ -f "$APP_UI_DIR/dist/stale-asset-reload.js" ]] || die "frontend build did not produce dist/stale-asset-reload.js"
  [[ -d "$APP_UI_DIR/dist/assets" ]] || die "frontend build did not produce dist/assets"
}

pm2_app_env_field() {
  run_as_app_user_shell "pm2 jlist" 2>/dev/null | python3 -c '
import json, sys
name, field = sys.argv[1], sys.argv[2]
for app in json.load(sys.stdin):
    if app.get("name") == name:
        print(app.get("pm2_env", {}).get(field, ""))
        break
' "$1" "$2" || true
}

restart_pm2_app() {
  local app_name="$1"
  log_step "Restarting PM2 app: $app_name"
  local expected_exec_path="$APP_API_DIR/scripts/run-active-release.mjs"
  local expected_out_log="$PM2_LOG_DIR/$app_name-out.log"
  if pm2_app_exists "$app_name" && {
    [[ "$(pm2_app_env_field "$app_name" pm_exec_path)" != "$expected_exec_path" ]] ||
      [[ "$(pm2_app_env_field "$app_name" pm_out_log_path)" != "$expected_out_log" ]]
  }; then
    # pm2 restart keeps the stored entry script and log paths, so re-create the
    # app once to apply them. Downtime matches a normal restart.
    log_info "Re-creating $app_name with entry point $expected_exec_path and logs in $PM2_LOG_DIR"
    run_as_app_user_shell "pm2 delete '$app_name' && pm2 start '$PM2_ECOSYSTEM_FILE' --only '$app_name' --update-env"
  elif pm2_app_exists "$app_name"; then
    run_as_app_user_shell "pm2 restart '$PM2_ECOSYSTEM_FILE' --only '$app_name' --update-env"
  else
    run_as_app_user_shell "pm2 start '$PM2_ECOSYSTEM_FILE' --only '$app_name' --update-env"
  fi
}

record_app_release() {
  local role="$1"
  local current
  current="$(current_release_dir)"
  [[ -n "$current" ]] || return 0
  write_deploy_state "$role.release" "$(basename "$current")"
}

restart_targets() {
  log_step "Rendering PM2 ecosystem file"
  render_pm2_ecosystem
  install_pm2_logrotate
  install_shared_runtime_maintenance

  if deploy_restarts_admin; then
    restart_role_with_drain admin
    record_app_release admin
  fi

  if deploy_restarts_chat; then
    case "$CHAT_RESTART_MODE" in
      bluegreen)
        switch_chat_slot
        record_app_release chat
        ;;
      idle)
        if restart_chat_when_idle; then
          record_app_release chat
        else
          CHAT_RESTART_PENDING=1
        fi
        ;;
      drain)
        restart_role_with_drain chat
        record_app_release chat
        ;;
      skip)
        log_info "Skipping chat restart as requested"
        CHAT_RESTART_PENDING=1
        ;;
    esac
  fi

  run_as_app_user_shell "pm2 save"
}

record_deployed_commits() {
  local target_commit="$TARGET_COMMIT"
  if [[ -n "$ACTIVATE_RELEASE" ]]; then
    target_commit="$(release_commit "$RELEASE_DIR")"
  fi
  [[ -n "$target_commit" ]] || return 0
  local target planned
  for target in frontend admin chat caddy; do
    case "$target" in
      frontend) planned="$PLAN_FRONTEND" ;;
      admin) planned="$PLAN_ADMIN" ;;
      chat) planned="$PLAN_CHAT" ;;
      caddy) planned="$PLAN_CADDY" ;;
    esac
    # A pending chat restart keeps its old commit so the next auto deploy retries it.
    if [[ "$target" == "chat" && "$CHAT_RESTART_PENDING" == "1" ]]; then
      continue
    fi
    # Auto mode found no relevant change for unplanned targets, so they are up to
    # date; explicit scopes and rollbacks only record what they actually deployed.
    if [[ "$planned" == "1" ]] || [[ "$DEPLOY_SCOPE" == "auto" && -z "$ACTIVATE_RELEASE" ]]; then
      write_deploy_state "$target.commit" "$target_commit"
    fi
  done
}

verify_api_health() {
  local health_host="$API_HOST"
  case "$health_host" in
    0.0.0.0) health_host="127.0.0.1" ;;
    ::) health_host="[::1]" ;;
  esac
  local attempt
  for attempt in {1..12}; do
    if node "$script_dir/check-api-health.mjs" \
      --admin-url "http://$health_host:$ADMIN_API_PORT/healthz" \
      --chat-url "http://$health_host:$(chat_slot_port "$(active_chat_slot)")/healthz"; then
      return 0
    fi
    sleep 2
  done
  die "Admin or chat API health check failed after restart"
}

main() {
  require_command git
  require_command npm
  require_command node
  require_command python3
  require_command curl
  require_repo_checkout
  acquire_deploy_lock
  git_update
  resolve_deploy_plan
  if [[ "$PLAN_ONLY" == "1" ]]; then
    log_step "Plan only; nothing was changed"
    return 0
  fi
  if [[ "$PLAN_FRONTEND$PLAN_ADMIN$PLAN_CHAT$PLAN_CADDY" == "0000" && "$REFRESH_CADDY" != "1" ]]; then
    record_deployed_commits
    log_step "Nothing to deploy for $TARGET_COMMIT"
    return 0
  fi

  if deploy_restarts_admin || deploy_restarts_chat; then
    require_command pm2
  fi
  if deploy_restarts_chat; then
    check_codex_linux_sandbox_prerequisites
  fi
  if deploy_restarts_admin || deploy_restarts_chat; then
    bash "$script_dir/ensure-host-memory-guard.sh" --allow-missing-service
  fi
  if deploy_restarts_chat; then
    bash "$script_dir/ensure-dws-runtime.sh"
    ensure_shared_python_runtime
    ensure_shared_plugin_runtime
  fi
  if deploy_restarts_admin || deploy_restarts_chat; then
    sync_managed_codex_plugins
  fi
  if [[ -n "$ACTIVATE_RELEASE" ]]; then
    RELEASE_DIR="$RELEASES_DIR/$ACTIVATE_RELEASE"
    [[ -d "$RELEASE_DIR" ]] || die "release not found: $RELEASE_DIR"
    activate_release "$RELEASE_DIR"
  elif deploy_builds_backend; then
    build_backend_release
    activate_release "$RELEASE_DIR"
    log_step "Skipping Portal historical workspace migration (run npm run workspace:migrate explicitly when required)"
  fi
  if deploy_restarts_admin; then
    seed_rbac
  fi
  if deploy_builds_frontend; then
    build_frontend
  fi
  trap cleanup_deploy_drains EXIT
  if deploy_restarts_admin || deploy_restarts_chat; then
    restart_targets
  fi
  if [[ "$CADDY_REFRESHED" == "1" ]]; then
    log_info "Caddy config was refreshed during the chat switch"
  elif deploy_refreshes_caddy; then
    refresh_caddy_config
  else
    log_info "Skipping Caddy config refresh"
  fi
  cleanup_deploy_drains
  trap - EXIT
  if deploy_restarts_admin || deploy_restarts_chat; then
    log_step "Checking admin and chat API health independently"
    verify_api_health
  fi
  record_deployed_commits
  prune_releases

  log_step "Deploy complete"
  log_info "Repo: $APP_REPO_DIR"
  log_info "Commit: $TARGET_COMMIT"
  log_info "Deploy plan: frontend=$PLAN_FRONTEND admin=$PLAN_ADMIN chat=$PLAN_CHAT caddy=$PLAN_CADDY"
  if [[ -n "$RELEASE_DIR" ]]; then
    log_info "Backend release: $(basename "$RELEASE_DIR")"
  fi
  log_info "PM2 admin app: $PM2_ADMIN_APP_NAME on $API_HOST:$ADMIN_API_PORT"
  log_info "PM2 chat slots: a=$PM2_CHAT_APP_NAME on $API_HOST:$CHAT_API_PORT, b=$PM2_CHAT_B_APP_NAME on $API_HOST:$CHAT_B_API_PORT (active: $(active_chat_slot))"
  log_info "PM2 ecosystem: $PM2_ECOSYSTEM_FILE"
  log_info "Caddy config: $CADDY_CONFIG_FILE"
  log_info "Public domain: ${DOMAIN:-<unset>}"
  if [[ "$CHAT_RESTART_PENDING" == "1" ]]; then
    log_warn "Chat restart is pending; it still runs its previous release. Retry later with: bash scripts/deploy-agent-studio.sh --chat-only --skip-git-pull"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi
