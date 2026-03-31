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
probe_first_log="$probe_root/first.log"
probe_resume_log="$probe_root/resume.log"

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
grep -q 'deploy_key_guidance_shown' "$script"
grep -q 'Continue to repository clone now?' "$script"
grep -q 'pg_roles' "$script"
grep -q 'pg_database' "$script"
grep -q 'installer_complete' "$script"
grep -q 'record_install_state backend_env_mode "600"' "$script"
grep -q 'record_install_state frontend_env_mode "600"' "$script"

# Probe 1: key guidance stops before clone and leaves the install resumable.
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
  --yes >"$probe_first_log" 2>&1

test "$(stat -f %Su "$probe_app_root")" = "$current_user"
grep -q 'Public key path:' "$probe_first_log"
grep -q 'Add this public key to GitHub as a deploy key' "$probe_first_log"
! grep -q 'Cloning repository' "$probe_first_log"
test ! -d "$probe_repo_dir/.git"
python3 - "$probe_state" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("deploy_key_guidance_shown") == "true", state.get("deploy_key_guidance_shown")
assert state.get("repo_clone_status") == "pending", state.get("repo_clone_status")
assert state.get("repo_clone_reason") == "deploy key guidance shown; rerun to continue clone", state.get("repo_clone_reason")
PY

# Probe 2: rerun continues into clone and records restricted env permissions.
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
  --yes >"$probe_resume_log" 2>&1
grep -q 'Cloning repository' "$probe_resume_log"
test "$(stat -f %Lp "$probe_env_backend")" = "600"
test "$(stat -f %Lp "$probe_env_frontend")" = "600"
python3 - "$probe_state" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("repo_clone_status") == "complete", state.get("repo_clone_status")
assert state.get("backend_env_mode") == "600", state.get("backend_env_mode")
assert state.get("frontend_env_mode") == "600", state.get("frontend_env_mode")
PY
