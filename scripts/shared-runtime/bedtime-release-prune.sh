#!/bin/bash
# Prune old releases of the Bedtime app that shares this server (installed by the agent-studio
# deploy script as /usr/local/sbin/bedtime-release-prune, run daily by systemd). Bedtime deploys
# upload a full release into BEDTIME_ROOT/releases/<commit> (~350MB each) and switch the
# BEDTIME_ROOT/app symlink, but never remove old releases.
# Keeps: the release that app (or any other symlink in BEDTIME_ROOT) points to, the newest
# KEEP_PREVIOUS other releases by creation time (rollback targets), and releases created within
# the last day (a deploy may be staging one). Does nothing when app does not resolve to a release.
# Usage: bedtime-release-prune [--dry-run]
set -uo pipefail
BEDTIME_ROOT="${BEDTIME_ROOT:-/opt/bedtime}"
KEEP_PREVIOUS="${KEEP_PREVIOUS:-1}"
DRY_RUN=0; [ "${1:-}" = "--dry-run" ] && DRY_RUN=1
RELEASES="$BEDTIME_ROOT/releases"

[ -d "$RELEASES" ] || { echo "no $RELEASES; nothing to do"; exit 0; }
current=$(readlink -f "$BEDTIME_ROOT/app" 2>/dev/null || true)
case "$current" in
  "$RELEASES"/?*) ;;
  *) echo "app does not point into $RELEASES ($current); refusing to prune"; exit 0 ;;
esac

declare -A keep=()
for link in "$BEDTIME_ROOT"/*; do
  [ -L "$link" ] || continue
  target=$(readlink -f "$link" 2>/dev/null) || continue
  [ "$(dirname "$target")" = "$RELEASES" ] && keep["$target"]=1
done

now=$(date +%s)
previous=0
removed=0
freed_kb=0
# Newest first by birth time (falls back to mtime where the filesystem has no birth time).
while read -r born dir; do
  [ -d "$dir" ] && [ ! -L "$dir" ] || continue
  if [ -n "${keep[$dir]:-}" ]; then continue; fi
  if [ $((now - born)) -lt 86400 ]; then echo "keep recent: $dir"; continue; fi
  if [ "$previous" -lt "$KEEP_PREVIOUS" ]; then previous=$((previous+1)); echo "keep previous: $dir"; continue; fi
  kb=$(du -sk "$dir" 2>/dev/null | cut -f1)
  if [ "$DRY_RUN" = 1 ]; then
    echo "would remove: $dir (${kb}K)"
  else
    rm -rf -- "$dir"
  fi
  removed=$((removed+1)); freed_kb=$((freed_kb+${kb:-0}))
done < <(for dir in "$RELEASES"/*/; do
  dir="${dir%/}"
  born=$(stat -c %W "$dir" 2>/dev/null)
  if [ -z "$born" ] || [ "$born" = "0" ] || [ "$born" = "-" ]; then born=$(stat -c %Y "$dir"); fi
  echo "$born $dir"
done | sort -rn)

echo "done bedtime-release-prune dry_run=$DRY_RUN current=$(basename "$current") removed=$removed freed=$((freed_kb/1024))MB"
