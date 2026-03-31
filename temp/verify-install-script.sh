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
probe_repo_dir="$probe_app_root/custom-agent-studio"
probe_default_repo_dir="$probe_app_root/app/agent-studio"
probe_env_backend="$probe_repo_dir/agent-api/.env"
probe_env_frontend="$probe_repo_dir/agent-ui/.env.production"
probe_first_log="$probe_root/first.log"
probe_resume_log="$probe_root/resume.log"
probe_blocked_root="$probe_root/blocked-install-root"
probe_blocked_state="$probe_root/blocked-state.json"
probe_blocked_log="$probe_root/blocked.log"
probe_blocked_repo_dir="$probe_blocked_root/custom-agent-studio"
probe_blocked_env_backend="$probe_blocked_repo_dir/agent-api/.env"
probe_blocked_env_frontend="$probe_blocked_repo_dir/agent-ui/.env.production"
probe_override_root="$probe_root/override-install-root"
probe_override_state="$probe_root/override-state.json"
probe_override_log="$probe_root/override.log"
probe_override_resume_log="$probe_root/override-resume.log"
probe_override_repo_dir="$probe_override_root/custom-agent-studio"
probe_override_backend_env="$probe_root/explicit-backend.env"
probe_override_frontend_env="$probe_root/explicit-frontend.env"
probe_repath_root="$probe_root/repath-install-root"
probe_repath_state="$probe_root/repath-state.json"
probe_repath_repo_a="$probe_repath_root/repo-a"
probe_repath_repo_b="$probe_repath_root/repo-b"
probe_repath_env_a_expected="$probe_repath_repo_a/agent-api/.env"
probe_repath_env_b_expected="$probe_repath_repo_b/agent-api/.env"
probe_worktree_root="$probe_root/worktree-install-root"
probe_worktree_state="$probe_root/worktree-state.json"
probe_worktree_main="$probe_root/worktree-main"
probe_worktree_checkout="$probe_worktree_root/worktree-checkout"

cleanup() {
  rm -rf "$probe_root"
}
trap cleanup EXIT
cleanup
mkdir -p "$probe_home"

file_owner() {
  python3 - "$1" <<'PY'
import pathlib
import pwd
import sys

path = pathlib.Path(sys.argv[1])
print(pwd.getpwuid(path.stat().st_uid).pw_name)
PY
}

file_mode() {
  python3 - "$1" <<'PY'
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
print(format(stat.S_IMODE(path.stat().st_mode), "o"))
PY
}

# Static contract checks.
test -f "$script"
grep -q -- '--force-phase' "$script"
grep -q -- '--force-all' "$script"
grep -q 'apply_app_user_ownership' "$script"
grep -q 'ensure_secure_file_mode' "$script"
grep -q 'print_follow_up_actions' "$script"
grep -q 'follow_up_message_for_step' "$script"
grep -q 'record_step_status first_deploy attempted' "$script"
grep -q 'refresh_app_paths' "$script"
grep -q 'APP_REPO_DIR_EXPLICIT' "$script"
grep -q 'deploy_key_guidance_shown' "$script"
grep -q 'Continue to repository clone now?' "$script"
grep -q 'repository clone is not complete yet' "$script"
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
  --repo-dir "$probe_repo_dir" \
  --repo-url "$base" \
  --skip-codex-check \
  --yes >"$probe_first_log" 2>&1

test "$(file_owner "$probe_app_root")" = "$current_user"
grep -q 'Public key path:' "$probe_first_log"
grep -q 'Add this public key to GitHub as a deploy key' "$probe_first_log"
! grep -q 'Cloning repository' "$probe_first_log"
test ! -d "$probe_repo_dir/.git"
python3 - "$probe_state" "$probe_repo_dir" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("deploy_key_guidance_shown") == "true", state.get("deploy_key_guidance_shown")
assert state.get("repo_clone_status") == "pending", state.get("repo_clone_status")
assert state.get("repo_clone_reason") == "deploy key guidance shown; rerun to continue clone", state.get("repo_clone_reason")
assert state.get("app_repo_dir") == sys.argv[2], state.get("app_repo_dir")
assert state.get("backend_env_file") == f"{sys.argv[2]}/agent-api/.env", state.get("backend_env_file")
PY
test ! -e "$probe_default_repo_dir/agent-api/.env"

# Probe 2: rerun continues into clone and records restricted env permissions.
APP_USER="$current_user" \
APP_HOME="$probe_home" \
INSTALL_ROOT="$probe_app_root" \
CADDY_CONFIG_FILE="$probe_caddy" \
DEPLOY_KEY_PATH="$probe_app_root/.ssh/id_ed25519_agent_studio_deploy" \
bash "$script" \
  --state-file "$probe_state" \
  --domain example.com \
  --repo-dir "$probe_repo_dir" \
  --repo-url "$base" \
  --skip-codex-check \
  --yes >"$probe_resume_log" 2>&1
grep -q 'Cloning repository' "$probe_resume_log"
test "$(file_mode "$probe_env_backend")" = "600"
test "$(file_mode "$probe_env_frontend")" = "600"
test ! -e "$probe_default_repo_dir/agent-api/.env"
python3 - "$probe_state" "$probe_repo_dir" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("repo_clone_status") == "complete", state.get("repo_clone_status")
assert state.get("app_repo_dir") == sys.argv[2], state.get("app_repo_dir")
assert state.get("backend_env_file") == f"{sys.argv[2]}/agent-api/.env", state.get("backend_env_file")
assert state.get("backend_env_mode") == "600", state.get("backend_env_mode")
assert state.get("frontend_env_mode") == "600", state.get("frontend_env_mode")
PY

# Probe 3: env generation stays blocked when clone is skipped even if the target tree exists.
mkdir -p "$probe_blocked_repo_dir/agent-api" "$probe_blocked_repo_dir/agent-ui"
APP_USER="$current_user" \
APP_HOME="$probe_root/home-blocked" \
INSTALL_ROOT="$probe_blocked_root" \
CADDY_CONFIG_FILE="$probe_blocked_root/Caddyfile" \
DEPLOY_KEY_PATH="$probe_blocked_root/.ssh/id_ed25519_agent_studio_deploy" \
bash "$script" \
  --state-file "$probe_blocked_state" \
  --domain example.com \
  --repo-dir "$probe_blocked_repo_dir" \
  --skip-codex-check \
  --yes \
  --no-clone >"$probe_blocked_log" 2>&1
grep -q 'clone disabled by --no-clone' "$probe_blocked_log"
test ! -e "$probe_blocked_env_backend"
test ! -e "$probe_blocked_env_frontend"
python3 - "$probe_blocked_state" "$probe_blocked_repo_dir" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("repo_clone_status") == "skipped", state.get("repo_clone_status")
assert state.get("env_files_status") == "pending", state.get("env_files_status")
assert state.get("backend_env_status") == "pending", state.get("backend_env_status")
assert state.get("frontend_env_status") == "pending", state.get("frontend_env_status")
assert state.get("installer_complete") == "false", state.get("installer_complete")
assert state.get("app_repo_dir") == sys.argv[2], state.get("app_repo_dir")
PY

# Probe 4: explicit env-file overrides are preserved and a valid checkout keeps repo_clone complete under --no-clone.
mkdir -p "$probe_override_repo_dir/agent-api" "$probe_override_repo_dir/agent-ui"
git init -q "$probe_override_repo_dir"
APP_USER="$current_user" \
APP_HOME="$probe_root/home-override" \
INSTALL_ROOT="$probe_override_root" \
CADDY_CONFIG_FILE="$probe_override_root/Caddyfile" \
BACKEND_ENV_FILE="$probe_override_backend_env" \
FRONTEND_ENV_FILE="$probe_override_frontend_env" \
bash "$script" \
  --state-file "$probe_override_state" \
  --domain example.com \
  --repo-dir "$probe_override_repo_dir" \
  --skip-codex-check \
  --yes \
  --no-clone >"$probe_override_log" 2>&1
grep -q 'clone disabled by --no-clone; existing checkout is already usable' "$probe_override_log"
test -f "$probe_override_backend_env"
test -f "$probe_override_frontend_env"
test ! -e "$probe_override_repo_dir/agent-api/.env"
test ! -e "$probe_override_repo_dir/agent-ui/.env.production"
python3 - "$probe_override_state" "$probe_override_repo_dir" "$probe_override_backend_env" "$probe_override_frontend_env" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("repo_clone_status") == "complete", state.get("repo_clone_status")
assert state.get("env_files_status") == "complete", state.get("env_files_status")
assert state.get("backend_env_file") == sys.argv[3], state.get("backend_env_file")
assert state.get("frontend_env_file") == sys.argv[4], state.get("frontend_env_file")
assert state.get("backend_env_status") == "complete", state.get("backend_env_status")
assert state.get("frontend_env_status") == "complete", state.get("frontend_env_status")
assert state.get("app_repo_dir") == sys.argv[2], state.get("app_repo_dir")
PY

# Probe 5: persisted explicit path overrides survive a later resume without env re-export.
rm -f "$probe_override_backend_env" "$probe_override_frontend_env"
APP_USER="$current_user" \
APP_HOME="$probe_root/home-override" \
INSTALL_ROOT="$probe_override_root" \
CADDY_CONFIG_FILE="$probe_override_root/Caddyfile" \
bash "$script" \
  --state-file "$probe_override_state" \
  --domain example.com \
  --repo-dir "$probe_override_repo_dir" \
  --skip-codex-check \
  --yes \
  --no-clone \
  --force-phase env_files >"$probe_override_resume_log" 2>&1
test -f "$probe_override_backend_env"
test -f "$probe_override_frontend_env"
test ! -e "$probe_override_repo_dir/agent-api/.env"
test ! -e "$probe_override_repo_dir/agent-ui/.env.production"
python3 - "$probe_override_state" "$probe_override_backend_env" "$probe_override_frontend_env" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("backend_env_file") == sys.argv[2], state.get("backend_env_file")
assert state.get("frontend_env_file") == sys.argv[3], state.get("frontend_env_file")
assert state.get("env_files_status") == "complete", state.get("env_files_status")
PY

# Probe 6: a fresh --repo-dir override must win over persisted repo-relative state from an earlier run.
mkdir -p "$probe_repath_repo_a/agent-api" "$probe_repath_repo_a/agent-ui"
git init -q "$probe_repath_repo_a"
APP_USER="$current_user" \
APP_HOME="$probe_root/home-repath" \
INSTALL_ROOT="$probe_repath_root" \
CADDY_CONFIG_FILE="$probe_repath_root/Caddyfile" \
bash "$script" \
  --state-file "$probe_repath_state" \
  --domain example.com \
  --repo-dir "$probe_repath_repo_a" \
  --skip-codex-check \
  --yes \
  --no-clone >/dev/null 2>&1
test -f "$probe_repath_env_a_expected"

mkdir -p "$probe_repath_repo_b/agent-api" "$probe_repath_repo_b/agent-ui"
git init -q "$probe_repath_repo_b"
APP_USER="$current_user" \
APP_HOME="$probe_root/home-repath" \
INSTALL_ROOT="$probe_repath_root" \
CADDY_CONFIG_FILE="$probe_repath_root/Caddyfile" \
bash "$script" \
  --state-file "$probe_repath_state" \
  --domain example.com \
  --repo-dir "$probe_repath_repo_b" \
  --skip-codex-check \
  --yes \
  --no-clone \
  --force-phase env_files >/dev/null 2>&1

test -f "$probe_repath_env_b_expected"
python3 - "$probe_repath_state" "$probe_repath_repo_b" "$probe_repath_env_b_expected" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("repo_dir") == sys.argv[2], state.get("repo_dir")
assert state.get("app_repo_dir") == sys.argv[2], state.get("app_repo_dir")
assert state.get("backend_env_file") == sys.argv[3], state.get("backend_env_file")
PY

# Probe 7: a valid git worktree checkout should count as a usable existing checkout under --no-clone.
git init -q "$probe_worktree_main"
(
  cd "$probe_worktree_main"
  git config user.name test
  git config user.email test@example.com
  touch README.md
  git add README.md
  git commit -qm "init"
  git worktree add -q "$probe_worktree_checkout" -b verify-worktree
)
APP_USER="$current_user" \
APP_HOME="$probe_root/home-worktree" \
INSTALL_ROOT="$probe_worktree_root" \
CADDY_CONFIG_FILE="$probe_worktree_root/Caddyfile" \
bash "$script" \
  --state-file "$probe_worktree_state" \
  --domain example.com \
  --repo-dir "$probe_worktree_checkout" \
  --skip-codex-check \
  --yes \
  --no-clone >/dev/null 2>&1
python3 - "$probe_worktree_state" "$probe_worktree_checkout" <<'PY'
import json
import pathlib
import sys

state = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state.get("repo_clone_status") == "complete", state.get("repo_clone_status")
assert state.get("repo_clone_reason") == "clone disabled by --no-clone; existing checkout is already usable", state.get("repo_clone_reason")
assert state.get("app_repo_dir") == sys.argv[2], state.get("app_repo_dir")
PY
