#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_REF="${GIT_REF:-main}"
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8787}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
SKIP_RBAC_SEED="${SKIP_RBAC_SEED:-0}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Deploy Agent Studio on an Ubuntu host.

Options:
  --repo-dir <path>      Repository checkout path [default: $APP_REPO_DIR]
  --remote <name>        Git remote name [default: $GIT_REMOTE]
  --ref <name>           Git branch or ref to deploy [default: $GIT_REF]
  --api-host <host>      Host written into PM2 env [default: $API_HOST]
  --api-port <port>      Port written into PM2 env [default: $API_PORT]
  --skip-git-pull        Rebuild current checkout without fetching or pulling
  --skip-rbac-seed       Skip built-in RBAC seed step
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
    --api-host)
      API_HOST="$2"
      shift 2
      ;;
    --api-port)
      API_PORT="$2"
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

pm2_template_path="$script_dir/../templates/pm2-ecosystem.config.cjs.template"

require_repo_checkout() {
  [[ -d "$APP_REPO_DIR" ]] || die "repository directory does not exist: $APP_REPO_DIR"
  git -C "$APP_REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git checkout: $APP_REPO_DIR"
  [[ -f "$APP_API_DIR/package.json" ]] || die "missing agent-api/package.json under $APP_API_DIR"
  [[ -f "$APP_UI_DIR/package.json" ]] || die "missing agent-ui/package.json under $APP_UI_DIR"
  [[ -f "$BACKEND_ENV_FILE" ]] || die "missing backend env file: $BACKEND_ENV_FILE"
  [[ -f "$FRONTEND_ENV_FILE" ]] || die "missing frontend env file: $FRONTEND_ENV_FILE"
}

render_pm2_ecosystem() {
  [[ -f "$pm2_template_path" ]] || die "missing PM2 template: $pm2_template_path"
  ensure_dir "$(dirname "$PM2_ECOSYSTEM_FILE")"

  python3 - "$pm2_template_path" "$PM2_ECOSYSTEM_FILE" "$PM2_APP_NAME" "$APP_API_DIR" "$API_HOST" "$API_PORT" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
rendered = (
    template
    .replace("__PM2_APP_NAME__", sys.argv[3])
    .replace("__APP_API_DIR__", sys.argv[4])
    .replace("__API_HOST__", sys.argv[5])
    .replace("__API_PORT__", sys.argv[6])
)
destination.write_text(rendered)
PY

  apply_app_user_ownership "$PM2_ECOSYSTEM_FILE" || true
}

git_update() {
  if [[ "$SKIP_GIT_PULL" == "1" ]]; then
    log_info "Skipping git fetch/pull"
    return 0
  fi

  log_step "Updating repository checkout"
  run_as_app_user_shell "cd '$APP_REPO_DIR' && git fetch '$GIT_REMOTE' && git checkout '$GIT_REF' && git pull --ff-only '$GIT_REMOTE' '$GIT_REF'"
}

build_backend() {
  log_step "Installing backend dependencies"
  run_as_app_user_shell "cd '$APP_API_DIR' && npm ci"

  log_step "Generating Prisma client"
  run_as_app_user_shell "cd '$APP_API_DIR' && npm run prisma:generate"

  log_step "Applying database migrations"
  run_as_app_user_shell "cd '$APP_API_DIR' && npx prisma migrate deploy"

  log_step "Building backend"
  run_as_app_user_shell "cd '$APP_API_DIR' && npm run build"
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
  run_as_app_user_shell "cd '$APP_UI_DIR' && npm ci"

  log_step "Building frontend"
  run_as_app_user_shell "cd '$APP_UI_DIR' && npm run build"
}

restart_pm2() {
  log_step "Rendering PM2 ecosystem file"
  render_pm2_ecosystem

  log_step "Restarting PM2 app"
  if run_as_app_user_shell "pm2 describe '$PM2_APP_NAME' >/dev/null 2>&1"; then
    run_as_app_user_shell "pm2 restart '$PM2_ECOSYSTEM_FILE' --only '$PM2_APP_NAME' --update-env"
  else
    run_as_app_user_shell "pm2 start '$PM2_ECOSYSTEM_FILE' --only '$PM2_APP_NAME' --update-env"
  fi
  run_as_app_user_shell "pm2 save"
}

main() {
  require_command git
  require_command npm
  require_command node
  require_command python3
  require_command pm2

  require_repo_checkout
  git_update
  build_backend
  seed_rbac
  build_frontend
  restart_pm2

  log_step "Deploy complete"
  log_info "Repo: $APP_REPO_DIR"
  log_info "PM2 app: $PM2_APP_NAME"
  log_info "PM2 ecosystem: $PM2_ECOSYSTEM_FILE"
}

main
