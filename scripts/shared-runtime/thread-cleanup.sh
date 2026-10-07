#!/bin/bash
# Remove regenerable per-thread data of idle agent-studio threads (installed by the
# deploy script as /usr/local/sbin/agent-studio-thread-tmp-cleanup, run daily by systemd):
#  - <thread>/workspace-files      idle WORKSPACE_COPY_DAYS (3): copy of the selected workspace
#    folder that the app deletes and re-copies at the start of every turn.
#  - <thread>/.agent-studio/tmp    idle TMP_IDLE_DAYS: home/cache/config; the app recreates it
#    (plus runtime symlinks) on the next request. Defaults to the "临时目录保留天数" published
#    in the admin console (STATE_DIR/cleanup-policy.json), clamped to 3-90, else 14.
# A thread counts as idle when nothing under its directory changed for the given days.
# The result of a real run is written to STATE_DIR/cleanup-last-run.json for the admin console.
# Usage: agent-studio-thread-tmp-cleanup [--dry-run]
set -uo pipefail
ROOT="${AGENT_STUDIO_DATA_ROOT:-/var/lib/agent-studio}"
STATE_DIR="${SHARED_RUNTIME_STATE_ROOT:-$ROOT/shared/state}"
WORKSPACE_COPY_DAYS=3
DRY_RUN=0; [ "${1:-}" = "--dry-run" ] && DRY_RUN=1

policy_days() {
  python3 - "$STATE_DIR/cleanup-policy.json" <<'PY' 2>/dev/null
import json, sys
try:
    days = int(json.load(open(sys.argv[1]))["tmpRetentionDays"])
except Exception:
    sys.exit(1)
print(min(90, max(3, days)))
PY
}
TMP_IDLE_DAYS="${TMP_IDLE_DAYS:-$(policy_days || echo 14)}"

OPEN=$(mktemp); trap 'rm -f "$OPEN"' EXIT
lsof -nP -Fn 2>/dev/null | sed -n 's/^n//p' | grep "^$ROOT/" > "$OPEN"
for p in /proc/[0-9]*; do readlink "$p/cwd" 2>/dev/null; done | grep "^$ROOT/" >> "$OPEN"

thread_active() {
  find "$1" -newermt "-$2 days" -print -quit 2>/dev/null | grep -q .
}

TOTAL_FREED_KB=0
TOTAL_SKIPPED=0
LAST_COUNT=0
# clean <label> <idle days> <find -path pattern> <levels from target up to the thread dir>
clean() {
  local label="$1" days="$2" pattern="$3" up="$4"
  local count=0 skipped=0 freed_kb=0 d owner kb i
  while IFS= read -r -d '' d; do
    owner="$d"
    for ((i = 0; i < up; i++)); do owner=$(dirname "$owner"); done
    thread_active "$owner" "$days" && continue
    if grep -qF -- "$d" "$OPEN"; then skipped=$((skipped+1)); echo "skip in-use: $d"; continue; fi
    kb=$(du -sk "$d" 2>/dev/null | cut -f1)
    if [ "$DRY_RUN" = 1 ]; then
      echo "would remove: $d (${kb}K)"
    else
      # Re-check right before removing so a turn that just started keeps its files.
      thread_active "$owner" "$days" && continue
      rm -rf -- "$d"
    fi
    count=$((count+1)); freed_kb=$((freed_kb+${kb:-0}))
  done < <(find "$ROOT" -path "$ROOT/shared" -prune -o -type d -path "$pattern" -prune -print0 2>/dev/null)
  echo "done $label dry_run=$DRY_RUN idle_days=$days removed=$count skipped_in_use=$skipped freed=$((freed_kb/1024))MB"
  TOTAL_FREED_KB=$((TOTAL_FREED_KB+freed_kb))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED+skipped))
  LAST_COUNT=$count
}

clean workspace-files "$WORKSPACE_COPY_DAYS" '*/thread-*/workspace-files' 1
REMOVED_WORKSPACE=$LAST_COUNT
clean thread-tmp "$TMP_IDLE_DAYS" '*/.agent-studio/tmp' 2
REMOVED_TMP=$LAST_COUNT

# Write the summary through a fresh temp file and rename it, so a link planted in the
# app-owned state directory is replaced instead of followed.
if [ "$DRY_RUN" = 0 ] && [ -d "$STATE_DIR" ]; then
  out=$(mktemp "$STATE_DIR/.cleanup-last-run.XXXXXX") && {
    printf '{"finishedAt":"%s","dryRun":%s,"tmpRetentionDays":%d,"workspaceCopyRetentionDays":%d,"removedThreadTmp":%d,"removedWorkspaceCopies":%d,"skippedInUse":%d,"freedBytes":%d}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$([ "$DRY_RUN" = 1 ] && echo true || echo false)" \
      "$TMP_IDLE_DAYS" "$WORKSPACE_COPY_DAYS" "$REMOVED_TMP" "$REMOVED_WORKSPACE" "$TOTAL_SKIPPED" \
      "$((TOTAL_FREED_KB*1024))" > "$out"
    chmod 644 "$out"
    mv -fT "$out" "$STATE_DIR/cleanup-last-run.json"
  }
fi
