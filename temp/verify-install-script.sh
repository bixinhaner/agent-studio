#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
base="$(cd "$script_dir/.." && pwd -P)"
script="$base/scripts/install-ubuntu.sh"
current_user="$(id -un)"
probe_root="$base/temp/verify-install-script-probe"
probe_state="$probe_root/state.json"
probe_home="$probe_root/home"
probe_caddy="$probe_root/Caddyfile"
probe_app_root="$probe_root/install-root"
probe_repo_dir="$probe_app_root/app/agent-studio"
probe_env_backend="$probe_repo_dir/agent-api/.env"
probe_env_frontend="$probe_repo_dir/agent-ui/.env.production"
probe_skip_root="$probe_root/skip-install-root"
probe_skip_state="$probe_root/skip-state.json"

cleanup() {
  rm -rf "$probe_root"
}
trap cleanup EXIT
cleanup
mkdir -p "$probe_home"

# Static contract checks.
test -f "$script"
grep -q -- '--force-phase' "$script"
grep -q -- '--force-all' "$script"
grep -q 'apply_app_user_ownership' "$script"
grep -q 'ensure_secure_file_mode' "$script"
grep -q 'print_follow_up_actions' "$script"
grep -q 'follow_up_message_for_step' "$script"
grep -q 'record_step_status first_deploy attempted' "$script"
grep -q 'pg_roles' "$script"
grep -q 'pg_database' "$script"
grep -q 'installer_complete' "$script"
grep -q 'record_install_state backend_env_mode "600"' "$script"
grep -q 'record_install_state frontend_env_mode "600"' "$script"

# Probe 1: ownership and env permissions in a temp install root.
APP_USER="$current_user" \
APP_HOME="$probe_home" \
INSTALL_ROOT="$probe_app_root" \
CADDY_CONFIG_FILE="$probe_caddy" \
DEPLOY_KEY_PATH="$probe_app_root/.ssh/id_ed25519_agent_studio_deploy" \
bash "$script" \
  --state-file "$probe_state" \
  --domain example.com \
  --repo-url "$base" \
  --skip-codex-check \
  --yes

test "$(stat -f %Su "$probe_app_root")" = "$current_user"
test "$(stat -f %Lp "$probe_env_backend")" = "600"
test "$(stat -f %Lp "$probe_env_frontend")" = "600"
python3 - "$probe_state" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("first_deploy_status") == "pending", state.get("first_deploy_status")
assert state.get("backend_env_mode") == "600", state.get("backend_env_mode")
assert state.get("frontend_env_mode") == "600", state.get("frontend_env_mode")
PY

# Probe 2: skipped required work keeps the install incomplete.
APP_USER="$current_user" \
APP_HOME="$probe_skip_root/home" \
INSTALL_ROOT="$probe_skip_root" \
CADDY_CONFIG_FILE="$probe_skip_root/Caddyfile" \
bash "$script" \
  --state-file "$probe_skip_state" \
  --domain example.com \
  --skip-codex-check \
  --yes \
  --no-clone
python3 - "$probe_skip_state" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("repo_clone_status") == "skipped", state.get("repo_clone_status")
PY
