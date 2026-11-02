#!/usr/bin/env bash
# Chat service watchdog (installed by the deploy script as /usr/local/sbin/agent-studio-chat-watchdog,
# run every minute by agent-studio-chat-watchdog.timer as the app user).
#
# PM2 restarts a chat slot that crashes, but not one it believes stopped on purpose, and
# not one that is alive but no longer answers. This checks the slot named by
# releases/state/chat.slot the same way Caddy does (/internal/ready). After
# CHAT_WATCHDOG_FAILURE_THRESHOLD failed checks in a row it restarts that slot and
# alerts super admins over DingTalk through the admin API; it alerts again once the
# slot answers. Checks are skipped while a deploy holds the deploy lock.
#
# Usage: agent-studio-chat-watchdog [--slot a|b] [--no-restart] [--test-alert]
#   --slot        check this slot instead of the active one (drills against the idle slot)
#   --no-restart  detect and alert only; alerts are marked as a drill
#   --test-alert  send one test alert through the admin API and exit
set -uo pipefail

DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/usr/local/agent-studio/releases/state}"
STATE_DIR="${CHAT_WATCHDOG_STATE_DIR:-/usr/local/agent-studio/data/shared-runtime/state}"
DEPLOY_LOCK_FILE="${AGENT_STUDIO_DEPLOY_LOCK_FILE:-/tmp/agent-studio-deploy.lock}"
PM2_ECOSYSTEM_FILE="${PM2_ECOSYSTEM_FILE:-/usr/local/agent-studio/pm2-ecosystem.config.cjs}"
LOCAL_HOST="${CHAT_WATCHDOG_HOST:-127.0.0.1}"
CHAT_A_PORT="${CHAT_API_PORT:-8791}"
CHAT_B_PORT="${CHAT_B_API_PORT:-8792}"
CHAT_A_APP="${PM2_CHAT_APP_NAME:-agent-studio-chat-api}"
CHAT_B_APP="${PM2_CHAT_B_APP_NAME:-agent-studio-chat-api-b}"
ADMIN_URL="${CHAT_WATCHDOG_ADMIN_URL:-http://127.0.0.1:8787}"
FAILURE_THRESHOLD="${CHAT_WATCHDOG_FAILURE_THRESHOLD:-3}"
CHECK_TIMEOUT_SECONDS="${CHAT_WATCHDOG_CHECK_TIMEOUT_SECONDS:-10}"
READY_TIMEOUT_SECONDS="${CHAT_WATCHDOG_READY_TIMEOUT_SECONDS:-180}"
READY_POLL_SECONDS="${CHAT_WATCHDOG_READY_POLL_SECONDS:-3}"
# While the slot stays down after a failed restart: retry and remind at this interval.
RETRY_INTERVAL_SECONDS="${CHAT_WATCHDOG_RETRY_INTERVAL_SECONDS:-900}"
PM2="${PM2_BIN:-pm2}"

SLOT=""
RESTART=1
TEST_ALERT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --slot) SLOT="${2:-}"; shift 2 ;;
    --no-restart) RESTART=0; shift ;;
    --test-alert) TEST_ALERT=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { printf '%s chat-watchdog: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
now_epoch() { date +%s; }
iso_from_epoch() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

# Posts an alert to the admin API, which sends it as a DingTalk work notice. When the
# admin API itself is down only the journal keeps the alert.
send_alert() {
  local event="$1" detail="${2:-}" failures="${3:-}" down_since="${4:-}" pm2_status="${5:-}"
  local body
  body="{\"service\":\"chat\",\"event\":\"$event\",\"slot\":\"$SLOT\",\"port\":$PORT,\"host\":\"$(json_escape "$(hostname)")\""
  [[ -n "$failures" ]] && body+=",\"consecutiveFailures\":$failures"
  [[ -n "$down_since" ]] && body+=",\"downSince\":\"$down_since\""
  [[ -n "$pm2_status" ]] && body+=",\"pm2Status\":\"$(json_escape "$pm2_status")\""
  [[ -n "$detail" ]] && body+=",\"detail\":\"$(json_escape "$detail")\""
  body+="}"
  if curl -fsS --max-time 20 -H 'Content-Type: application/json' -X POST \
    --data "$body" "$ADMIN_URL/internal/ops/service-health-alert" >/dev/null 2>&1; then
    log "alert sent: $event"
  else
    log "alert NOT delivered (admin API unreachable or DingTalk failed): $event $detail"
  fi
}

slot_ready() {
  curl -fsS --max-time "$CHECK_TIMEOUT_SECONDS" "http://$LOCAL_HOST:$PORT/internal/ready" >/dev/null 2>&1
}

pm2_status() {
  "$PM2" jlist 2>/dev/null | APP="$APP" node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
  try {
    const app = JSON.parse(raw).find((item) => item.name === process.env.APP);
    process.stdout.write(app ? String(app.pm2_env?.status ?? "unknown") : "missing");
  } catch {
    process.stdout.write("unknown");
  }
});' 2>/dev/null || printf 'unknown'
}

restart_slot() {
  local status="$1"
  if [[ "$status" == "missing" ]]; then
    "$PM2" start "$PM2_ECOSYSTEM_FILE" --only "$APP" --update-env >/dev/null 2>&1
  else
    # Keeps the slot's own PM2 definition; dist/index.js resolves to the current release.
    "$PM2" restart "$APP" >/dev/null 2>&1
  fi
  local rc=$?
  "$PM2" save >/dev/null 2>&1 || true
  return "$rc"
}

wait_until_ready() {
  local started elapsed
  started="$(now_epoch)"
  while true; do
    slot_ready && return 0
    elapsed=$(( $(now_epoch) - started ))
    (( elapsed < READY_TIMEOUT_SECONDS )) || return 1
    sleep "$READY_POLL_SECONDS"
  done
}

# A deploy switches slots and restarts PM2 apps itself; never fight it.
deploy_running() {
  [[ -r "$DEPLOY_LOCK_FILE" ]] || return 1
  command -v flock >/dev/null 2>&1 || return 1
  # The deploy holds an exclusive lock; a shared one is only refused while it runs.
  # Opened read-only: /tmp's protected_regular refuses O_CREAT on another user's file,
  # which `flock FILE` would use. A file that cannot be opened counts as no deploy.
  local result
  result="$({ flock -n -s 8 && echo free || echo busy; } 8<"$DEPLOY_LOCK_FILE" 2>/dev/null)"
  [[ "$result" == "busy" ]]
}

if [[ -z "$SLOT" ]]; then
  SLOT="$(tr -d '[:space:]' < "$DEPLOY_STATE_DIR/chat.slot" 2>/dev/null || true)"
  [[ "$SLOT" == "a" || "$SLOT" == "b" ]] || SLOT="a"
fi
case "$SLOT" in
  a) PORT="$CHAT_A_PORT"; APP="$CHAT_A_APP" ;;
  b) PORT="$CHAT_B_PORT"; APP="$CHAT_B_APP" ;;
  *) echo "invalid slot: $SLOT" >&2; exit 2 ;;
esac

if [[ "$TEST_ALERT" == "1" ]]; then
  send_alert test "手动触发的告警通道测试，服务本身没有异常"
  exit 0
fi

mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/chat-watchdog-$SLOT$([[ "$RESTART" == "1" ]] || printf -- '-drill').state"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_FILE.lock"
  flock -n 9 || { log "previous check still running"; exit 0; }
fi

failures=0
down_since=""
alerted=0
last_action=0
# shellcheck source=/dev/null
[[ -f "$STATE_FILE" ]] && source "$STATE_FILE"

save_state() {
  printf 'failures=%s\ndown_since=%s\nalerted=%s\nlast_action=%s\n' \
    "$failures" "$down_since" "$alerted" "$last_action" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

if deploy_running; then
  log "deploy in progress; skipping check of slot $SLOT"
  failures=0
  save_state
  exit 0
fi

if slot_ready; then
  if [[ "$alerted" == "1" ]]; then
    send_alert recovered "" "" "$down_since"
  fi
  if (( failures > 0 )); then
    log "slot $SLOT answers again after $failures failed check(s)"
  fi
  failures=0; down_since=""; alerted=0; last_action=0
  save_state
  exit 0
fi

failures=$((failures + 1))
[[ -n "$down_since" ]] || down_since="$(iso_from_epoch "$(now_epoch)")"
status="$(pm2_status)"
log "slot $SLOT (port $PORT, pm2 $status) failed readiness check $failures/$FAILURE_THRESHOLD"

if (( failures < FAILURE_THRESHOLD )); then
  save_state
  exit 0
fi

now="$(now_epoch)"
if [[ "$alerted" == "1" ]] && (( now - last_action < RETRY_INTERVAL_SECONDS )); then
  save_state
  exit 0
fi
last_action="$now"

if [[ "$RESTART" != "1" ]]; then
  if [[ "$alerted" != "1" ]]; then
    send_alert down "【演练】只检测不重启" "$failures" "$down_since" "$status"
  fi
  alerted=1
  save_state
  exit 0
fi

send_alert down "" "$failures" "$down_since" "$status"
alerted=1
save_state

log "restarting $APP (pm2 status $status)"
if restart_slot "$status" && wait_until_ready; then
  log "slot $SLOT is ready again after restart"
  send_alert restarted "" "$failures" "$down_since" "$status"
  failures=0; down_since=""; alerted=0; last_action=0
else
  log "slot $SLOT did not become ready within ${READY_TIMEOUT_SECONDS}s after restart"
  send_alert restart_failed "重启后 ${READY_TIMEOUT_SECONDS}s 内仍未就绪，$((RETRY_INTERVAL_SECONDS / 60)) 分钟后再试" \
    "$failures" "$down_since" "$(pm2_status)"
fi
save_state
exit 0
