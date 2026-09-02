#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

PM2_SYSTEMD_SERVICE="${AGENT_STUDIO_PM2_SYSTEMD_SERVICE:-pm2-${APP_USER}.service}"
PM2_MEMORY_HIGH="${AGENT_STUDIO_PM2_MEMORY_HIGH:-24G}"
PM2_MEMORY_MAX="${AGENT_STUDIO_PM2_MEMORY_MAX:-27G}"
PM2_MEMORY_SWAP_MAX="${AGENT_STUDIO_PM2_MEMORY_SWAP_MAX:-10G}"
HOST_SWAP_TARGET="${AGENT_STUDIO_HOST_SWAP_TARGET:-16G}"
MANAGED_SWAP_FILE="${AGENT_STUDIO_MANAGED_SWAP_FILE:-/swapfile-agent-studio}"
ALLOW_MISSING_SERVICE=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--allow-missing-service]

Ensures the host has enough swap and applies persistent cgroup memory limits to
the Agent Studio PM2 systemd service.

Options:
  --allow-missing-service  Configure swap but skip PM2 limits when the generated
                           PM2 systemd service does not exist yet.
  -h, --help               Show this help text.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-missing-service)
      ALLOW_MISSING_SERVICE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

size_to_bytes() {
  local value="$1"
  if [[ "$value" =~ ^([0-9]+)([KMGTP])$ ]]; then
    local amount="${BASH_REMATCH[1]}"
    local suffix="${BASH_REMATCH[2]}"
    local power=0
    case "$suffix" in
      K) power=1 ;;
      M) power=2 ;;
      G) power=3 ;;
      T) power=4 ;;
      P) power=5 ;;
    esac
    local result="$amount"
    local index
    for ((index = 0; index < power; index++)); do
      result=$((result * 1024))
    done
    printf '%s\n' "$result"
    return 0
  fi
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
    return 0
  fi
  die "unsupported size value '$value'; use an integer byte value or K/M/G/T/P suffix"
}

active_swap_bytes() {
  local total=0
  local size
  while read -r size; do
    size="${size//[[:space:]]/}"
    [[ "$size" =~ ^[0-9]+$ ]] || continue
    total=$((total + size))
  done < <(swapon --show=SIZE --bytes --noheadings 2>/dev/null || true)
  printf '%s\n' "$total"
}

swap_file_stat_bytes() {
  local swap_file="$1"
  local column="$2"
  swapon --show="NAME,$column" --bytes --noheadings 2>/dev/null \
    | awk -v target="$swap_file" '$1 == target { print $2; found = 1 } END { if (!found) print 0 }'
}

available_memory_bytes() {
  awk '/^MemAvailable:/ { print $2 * 1024; found = 1 } END { if (!found) print 0 }' /proc/meminfo
}

ensure_swap_capacity() {
  require_command swapon
  require_command swapoff
  require_command mkswap
  require_command fallocate

  local target_bytes
  local current_bytes
  target_bytes="$(size_to_bytes "$HOST_SWAP_TARGET")"
  current_bytes="$(active_swap_bytes)"
  if ((current_bytes >= target_bytes)); then
    log_info "Host swap capacity is sufficient: $current_bytes bytes"
    return 0
  fi

  local managed_size_bytes
  local managed_used_bytes
  managed_size_bytes="$(swap_file_stat_bytes "$MANAGED_SWAP_FILE" SIZE)"
  managed_used_bytes="$(swap_file_stat_bytes "$MANAGED_SWAP_FILE" USED)"

  local unmanaged_bytes=$((current_bytes - managed_size_bytes))
  local desired_managed_bytes=$((target_bytes - unmanaged_bytes))
  local page_size
  page_size="$(getconf PAGESIZE)"
  # mkswap reserves the first page for its header, so allocate one extra page.
  desired_managed_bytes=$((desired_managed_bytes + page_size))
  desired_managed_bytes=$((((desired_managed_bytes + page_size - 1) / page_size) * page_size))

  if ((managed_size_bytes > 0)); then
    local available_bytes
    local swapoff_reserve_bytes=$((1024 * 1024 * 1024))
    available_bytes="$(available_memory_bytes)"
    if ((available_bytes < managed_used_bytes + swapoff_reserve_bytes)); then
      die "not enough available memory to resize active managed swap safely"
    fi
    log_step "Temporarily disabling managed swap for an in-place capacity increase"
    run_as_root swapoff "$MANAGED_SWAP_FILE"
  fi

  log_step "Setting managed swap capacity"
  run_as_root fallocate -l "$desired_managed_bytes" "$MANAGED_SWAP_FILE"
  run_as_root chmod 600 "$MANAGED_SWAP_FILE"
  run_as_root mkswap -f "$MANAGED_SWAP_FILE" >/dev/null
  run_as_root swapon "$MANAGED_SWAP_FILE"

  local fstab_line="$MANAGED_SWAP_FILE none swap sw 0 0"
  if ! grep -Fqx "$fstab_line" /etc/fstab; then
    local fstab_temp
    fstab_temp="$(mktemp)"
    cp /etc/fstab "$fstab_temp"
    printf '%s\n' "$fstab_line" >>"$fstab_temp"
    run_as_root install -o root -g root -m 644 "$fstab_temp" /etc/fstab
    rm -f "$fstab_temp"
  fi

  current_bytes="$(active_swap_bytes)"
  ((current_bytes >= target_bytes)) || die "failed to reach host swap target"
  log_info "Host swap target applied: $current_bytes bytes"
}

verify_systemd_property() {
  local property="$1"
  local expected="$2"
  local actual
  actual="$(systemctl show "$PM2_SYSTEMD_SERVICE" --property "$property" --value)"
  [[ "$actual" == "$expected" ]] || die "$PM2_SYSTEMD_SERVICE $property expected $expected, got $actual"
}

ensure_pm2_resource_limits() {
  require_command systemctl

  local load_state
  load_state="$(systemctl show "$PM2_SYSTEMD_SERVICE" --property LoadState --value 2>/dev/null || true)"
  if [[ "$load_state" != "loaded" ]]; then
    if [[ "$ALLOW_MISSING_SERVICE" == "1" ]]; then
      log_warn "Skipping PM2 resource limits because $PM2_SYSTEMD_SERVICE is not installed yet"
      return 0
    fi
    die "PM2 systemd service is not installed: $PM2_SYSTEMD_SERVICE"
  fi

  if systemctl is-active --quiet "$PM2_SYSTEMD_SERVICE"; then
    # Apply resource properties immediately. systemctl removes managed drop-ins
    # when setting runtime properties, so persist our drop-in afterwards.
    run_as_root systemctl set-property --runtime "$PM2_SYSTEMD_SERVICE" \
      MemoryAccounting=yes \
      MemoryHigh="$PM2_MEMORY_HIGH" \
      MemoryMax="$PM2_MEMORY_MAX" \
      MemorySwapMax="$PM2_MEMORY_SWAP_MAX"
  fi

  local drop_in_dir="/etc/systemd/system/${PM2_SYSTEMD_SERVICE}.d"
  local drop_in_file="$drop_in_dir/60-agent-studio-memory-guard.conf"
  local drop_in_temp
  drop_in_temp="$(mktemp)"
  printf '%s\n' \
    '[Service]' \
    'MemoryAccounting=yes' \
    "MemoryHigh=$PM2_MEMORY_HIGH" \
    "MemoryMax=$PM2_MEMORY_MAX" \
    "MemorySwapMax=$PM2_MEMORY_SWAP_MAX" \
    'OOMPolicy=continue' >"$drop_in_temp"

  run_as_root install -d -o root -g root -m 755 "$drop_in_dir"
  if ! run_as_root cmp -s "$drop_in_temp" "$drop_in_file"; then
    run_as_root install -o root -g root -m 644 "$drop_in_temp" "$drop_in_file"
  fi
  rm -f "$drop_in_temp"
  run_as_root systemctl daemon-reload

  verify_systemd_property MemoryAccounting yes
  verify_systemd_property MemoryHigh "$(size_to_bytes "$PM2_MEMORY_HIGH")"
  verify_systemd_property MemoryMax "$(size_to_bytes "$PM2_MEMORY_MAX")"
  verify_systemd_property MemorySwapMax "$(size_to_bytes "$PM2_MEMORY_SWAP_MAX")"
  if [[ "$(systemctl show "$PM2_SYSTEMD_SERVICE" --property OOMPolicy --value)" != "continue" ]]; then
    log_warn "OOMPolicy=continue is persistent and will become active on the next PM2 service restart"
  fi
  log_info "PM2 resource limits verified for $PM2_SYSTEMD_SERVICE"
}

main() {
  ensure_swap_capacity
  ensure_pm2_resource_limits
}

main
