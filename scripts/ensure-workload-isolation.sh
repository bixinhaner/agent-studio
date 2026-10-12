#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$script_dir/lib/common.sh"
[[ "$APP_USER" == agentstudio ]] || die "Workload isolation currently requires APP_USER=agentstudio"
require_command systemctl
require_command python3
[[ -e /sys/fs/cgroup/cgroup.controllers ]] || die "Workload isolation requires cgroup v2"
run_as_root install -d -o root -g root -m 755 /usr/local/libexec
run_as_root install -o root -g root -m 755 "$script_dir/agent-studio-workload-guard.py" /usr/local/libexec/agent-studio-workload-guard
run_as_root install -o root -g root -m 755 "$script_dir/agent-studio-workload-launch.py" /usr/local/libexec/agent-studio-workload-launch
workload_temp="$(mktemp -d)"
trap 'rm -rf "$workload_temp"' EXIT
cat > "$workload_temp/unit" <<'UNIT'
[Unit]
Description=Agent Studio isolated user workloads
After=local-fs.target

[Service]
Type=simple
ExecStart=/usr/local/libexec/agent-studio-workload-guard serve
Delegate=yes
MemoryAccounting=yes
MemoryMax=16G
MemorySwapMax=0
CPUQuota=300%
TasksMax=4096
OOMPolicy=continue
OOMScoreAdjust=-900
Restart=on-failure
RestartSec=2
RuntimeDirectory=agent-studio-workloads
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
UNIT
run_as_root install -o root -g root -m 644 "$workload_temp/unit" /etc/systemd/system/agent-studio-workloads.service
cat > "$workload_temp/sudoers" <<'SUDOERS'
agentstudio ALL=(root) NOPASSWD: /usr/local/libexec/agent-studio-workload-guard attach *, /usr/local/libexec/agent-studio-workload-guard release *
SUDOERS
run_as_root visudo -cf "$workload_temp/sudoers"
run_as_root install -o root -g root -m 440 "$workload_temp/sudoers" /etc/sudoers.d/agent-studio-workloads
run_as_root systemctl daemon-reload
run_as_root systemctl enable --now agent-studio-workloads.service
for i in {1..30}; do
  [[ -e /run/agent-studio-workloads/ready ]] && break
  sleep 1
done
[[ -e /run/agent-studio-workloads/ready ]] || die "Workload isolation failed to initialize"
[[ "$(cat /sys/fs/cgroup/system.slice/agent-studio-workloads.service/memory.max)" == 17179869184 ]] || die "Incorrect workload aggregate limit"
run_as_root /usr/local/libexec/agent-studio-workload-guard adopt
log_info "Workload isolation ready: 8 GiB per job, 16 GiB total, no swap; existing Codex processes adopted"
