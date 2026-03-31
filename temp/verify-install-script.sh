#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
base="$(cd "$script_dir/.." && pwd -P)"
script="$base/scripts/install-ubuntu.sh"
common="$base/scripts/lib/common.sh"
deploy_script="$base/scripts/deploy-agent-studio.sh"

test -f "$script"
test -f "$common"
test -f "$deploy_script"

bash -n "$common" "$script" "$deploy_script"

help_output="$(bash "$script" --help)"
printf '%s\n' "$help_output" | grep -q 'Root-only Ubuntu installer for Agent Studio.'
printf '%s\n' "$help_output" | grep -q 'if the current working directory is a git checkout, it is used as the repo'
printf '%s\n' "$help_output" | grep -q 'otherwise the repo defaults to /usr/local/agent-studio'

grep -q 'require_root_shell' "$script"
grep -q 'detect_default_repo_dir' "$script"
grep -q 'normalize_legacy_state_defaults' "$script"
grep -q 'current_dir_is_git_checkout' "$script"
grep -q 'REPO_DIR="$INSTALL_ROOT"' "$script"
grep -q 'legacy_repo_dir="$INSTALL_ROOT/app/agent-studio"' "$script"
grep -q 'legacy_root_key_path="/root/.ssh/id_ed25519_agent_studio_deploy"' "$script"
grep -q 'ensure_system_dependencies' "$script"
grep -q 'ensure_ubuntu_apt_packages' "$script"
grep -q 'ensure_nodesource_nodejs' "$script"
grep -q 'ensure_global_pm2' "$script"
grep -q 'ensure_service_started postgresql' "$script"
grep -q 'generate_random_secret 24' "$script"
grep -q 'postgresql://\$POSTGRES_DB_USER:\$POSTGRES_DB_PASSWORD@\$POSTGRES_HOST:\$POSTGRES_PORT/\$POSTGRES_DB_NAME?schema=public' "$script"
grep -q 'bash "\$script_dir/deploy-agent-studio.sh" --repo-dir "\$REPO_DIR" --skip-git-pull' "$script"
grep -q 'pm2 startup systemd -u "\$APP_USER" --hp "\$APP_HOME"' "$script"
grep -q 'Generate an SSH deploy key for private repo access now?' "$script"
grep -q 'Attempt to clone the repository now?' "$script"
grep -q 'clone disabled and no local checkout exists' "$script"
grep -q 'local repository checkout already exists' "$script"
grep -q 'system dependencies:' "$script"

grep -q 'APP_REPO_DIR="${APP_REPO_DIR:-$INSTALL_ROOT}"' "$common"
grep -q 'require_root_shell()' "$common"
grep -q 'current_dir_is_git_checkout()' "$common"
grep -q 'ensure_ubuntu_apt_packages()' "$common"
grep -q 'ensure_nodesource_nodejs()' "$common"
grep -q 'ensure_global_pm2()' "$common"
grep -q 'generate_random_secret()' "$common"
grep -q 'write_env_key_value()' "$common"

echo INSTALLER_BOOTSTRAP_VERIFY_OK
