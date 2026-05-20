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
DOMAIN="${DOMAIN:-}"
CADDY_UPSTREAM_HOST="${CADDY_UPSTREAM_HOST:-}"
CADDY_UPSTREAM_PORT="${CADDY_UPSTREAM_PORT:-}"
CADDY_EXTRA_SNIPPET_DIR="${CADDY_EXTRA_SNIPPET_DIR:-/etc/caddy/conf.d}"
ASSET_RETENTION_DAYS="${AGENT_STUDIO_ASSET_RETENTION_DAYS:-}"
FRONTEND_BUILD_NODE_OPTIONS="${FRONTEND_BUILD_NODE_OPTIONS:---max-old-space-size=3072}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
SKIP_RBAC_SEED="${SKIP_RBAC_SEED:-0}"
SKIP_CADDY_RELOAD="${SKIP_CADDY_RELOAD:-0}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Deploy Agent Studio on an Ubuntu host.

Options:
  --repo-dir <path>      Repository checkout path [default: $APP_REPO_DIR]
  --remote <name>        Git remote name [default: $GIT_REMOTE]
  --ref <name>           Git branch to deploy [default: $GIT_REF]
  --domain <name>        Public domain used to render Caddy config [default: install state domain]
  --api-host <host>      Host written into PM2 env [default: $API_HOST]
  --api-port <port>      Port written into PM2 env [default: $API_PORT]
  --caddy-upstream-host <host>
                         Backend host used by Caddy reverse proxy [default: 127.0.0.1]
  --caddy-upstream-port <port>
                         Backend port used by Caddy reverse proxy [default: --api-port value]
  --asset-retention-days <days>
                         Days to keep old frontend assets; 0 disables pruning [default: ${ASSET_RETENTION_DAYS:-30}]
  --frontend-node-options <value>
                         NODE_OPTIONS used for frontend build [default: $FRONTEND_BUILD_NODE_OPTIONS]
  --skip-git-pull        Rebuild current checkout without fetching or pulling
  --skip-rbac-seed       Skip built-in RBAC seed step
  --skip-caddy-reload    Skip rendering/reloading Caddy
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
    --domain)
      DOMAIN="$2"
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
    --caddy-upstream-host)
      CADDY_UPSTREAM_HOST="$2"
      shift 2
      ;;
    --caddy-upstream-port)
      CADDY_UPSTREAM_PORT="$2"
      shift 2
      ;;
    --asset-retention-days)
      ASSET_RETENTION_DAYS="$2"
      shift 2
      ;;
    --frontend-node-options)
      FRONTEND_BUILD_NODE_OPTIONS="$2"
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
    --skip-caddy-reload)
      SKIP_CADDY_RELOAD=1
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
caddy_template_path="$script_dir/../templates/Caddyfile.template"

if [[ -z "$CADDY_UPSTREAM_HOST" ]]; then
  CADDY_UPSTREAM_HOST="127.0.0.1"
fi

if [[ -z "$CADDY_UPSTREAM_PORT" ]]; then
  CADDY_UPSTREAM_PORT="$API_PORT"
fi

if [[ -n "$ASSET_RETENTION_DAYS" && ! "$ASSET_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  die "--asset-retention-days must be a non-negative integer"
fi

shell_quote() {
  printf '%q' "$1"
}

require_repo_checkout() {
  [[ -d "$APP_REPO_DIR" ]] || die "repository directory does not exist: $APP_REPO_DIR"
  run_as_app_user_shell "git -C '$APP_REPO_DIR' rev-parse --is-inside-work-tree >/dev/null 2>&1" || die "not a git checkout: $APP_REPO_DIR"
  [[ -f "$APP_API_DIR/package.json" ]] || die "missing agent-api/package.json under $APP_API_DIR"
  [[ -f "$APP_UI_DIR/package.json" ]] || die "missing agent-ui/package.json under $APP_UI_DIR"
  [[ -f "$BACKEND_ENV_FILE" ]] || die "missing backend env file: $BACKEND_ENV_FILE"
  [[ -f "$FRONTEND_ENV_FILE" ]] || die "missing frontend env file: $FRONTEND_ENV_FILE"
}

render_pm2_ecosystem() {
  [[ -f "$pm2_template_path" ]] || die "missing PM2 template: $pm2_template_path"
  local pm2_ecosystem_dir
  pm2_ecosystem_dir="$(dirname "$PM2_ECOSYSTEM_FILE")"
  if is_app_user; then
    ensure_dir "$pm2_ecosystem_dir"
  else
    run_as_root mkdir -p "$pm2_ecosystem_dir"
  fi

  local rendered_ecosystem
  rendered_ecosystem="$(mktemp)"
  python3 - "$pm2_template_path" "$rendered_ecosystem" "$PM2_APP_NAME" "$APP_API_DIR" "$API_HOST" "$API_PORT" <<'PY'
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

  if is_app_user; then
    install -m 644 "$rendered_ecosystem" "$PM2_ECOSYSTEM_FILE"
  else
    run_as_root install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$rendered_ecosystem" "$PM2_ECOSYSTEM_FILE"
  fi
  rm -f "$rendered_ecosystem"
}

render_caddy_config() {
  local template="$1"
  local destination="$2"
  local domain="$3"
  local ui_root="$4"
  local upstream_host="$5"
  local upstream_port="$6"

  python3 - "$template" "$destination" "$domain" "$ui_root" "$upstream_host" "$upstream_port" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
destination = Path(sys.argv[2])
domain = sys.argv[3]
ui_root = sys.argv[4]
upstream_host = sys.argv[5]
upstream_port = sys.argv[6]
rendered = (
    template
    .replace("{$DOMAIN}", domain)
    .replace("{$UI_DIST_ROOT}", ui_root)
    .replace("{$CADDY_UPSTREAM_HOST}", upstream_host)
    .replace("{$CADDY_UPSTREAM_PORT}", upstream_port)
)
destination.write_text(rendered)
PY
}

append_extra_caddy_snippets() {
  local destination="$1"

  [[ -d "$CADDY_EXTRA_SNIPPET_DIR" ]] || return 0

  local snippet
  local appended=0
  while IFS= read -r -d '' snippet; do
    appended=1
    printf '\n# Extra Caddy snippet: %s\n' "$snippet" >> "$destination"
    cat "$snippet" >> "$destination"
    printf '\n' >> "$destination"
  done < <(find "$CADDY_EXTRA_SNIPPET_DIR" -maxdepth 1 -type f -name '*.caddy' -print0 | sort -z)

  if [[ "$appended" == "1" ]]; then
    log_info "Appended extra Caddy snippets from $CADDY_EXTRA_SNIPPET_DIR"
  fi
}

resolve_caddy_domain() {
  if [[ -n "$DOMAIN" ]]; then
    return 0
  fi
  if [[ -f "$INSTALL_STATE_FILE" ]]; then
    DOMAIN="$(state_read domain "")"
  fi
}

refresh_caddy_config() {
  if [[ "$SKIP_CADDY_RELOAD" == "1" ]]; then
    log_info "Skipping Caddy config refresh"
    return 0
  fi

  resolve_caddy_domain
  if [[ -z "$DOMAIN" ]]; then
    log_warn "Skipping Caddy config refresh because no domain was provided and no install state domain was found"
    return 0
  fi

  [[ -f "$caddy_template_path" ]] || die "missing Caddy template: $caddy_template_path"

  local rendered_config
  rendered_config="$(mktemp)"
  render_caddy_config "$caddy_template_path" "$rendered_config" "$DOMAIN" "$APP_UI_DIR/dist" "$CADDY_UPSTREAM_HOST" "$CADDY_UPSTREAM_PORT"
  append_extra_caddy_snippets "$rendered_config"

  if command_exists caddy; then
    log_step "Validating Caddy config"
    run_as_root caddy validate --config "$rendered_config" --adapter caddyfile >/dev/null
  else
    log_warn "Caddy binary not found; writing config without validation"
  fi

  log_step "Updating Caddy config"
  run_as_root mkdir -p "$(dirname "$CADDY_CONFIG_FILE")"
  run_as_root install -m 644 "$rendered_config" "$CADDY_CONFIG_FILE"

  if command_exists caddy && command_exists systemctl; then
    log_step "Reloading Caddy"
    run_as_root systemctl reload caddy
  elif ! command_exists caddy; then
    log_warn "Caddy binary not found; Caddy was not reloaded"
  else
    log_warn "systemctl not found; Caddy was not reloaded"
  fi

  rm -f "$rendered_config"
}

git_update() {
  if [[ "$SKIP_GIT_PULL" == "1" ]]; then
    log_info "Skipping git fetch/pull"
    return 0
  fi

  log_step "Updating repository checkout"
  run_as_app_user_shell "cd '$APP_REPO_DIR' && git fetch '$GIT_REMOTE' && git checkout '$GIT_REF' && git pull --ff-only '$GIT_REMOTE' '$GIT_REF'"
}

sanitize_frontend_env() {
  if ! grep -Eq '^[[:space:]]*NODE_ENV[[:space:]]*=' "$FRONTEND_ENV_FILE"; then
    return 0
  fi

  log_info "Removing unsupported NODE_ENV from frontend env file: $FRONTEND_ENV_FILE"
  python3 - "$FRONTEND_ENV_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
rendered = []
changed = False

for raw_line in path.read_text().splitlines():
    stripped = raw_line.strip()
    if stripped and not stripped.startswith("#") and "=" in raw_line:
        key = raw_line.split("=", 1)[0].strip()
        if key == "NODE_ENV":
            changed = True
            continue
    rendered.append(raw_line)

if changed:
    path.write_text("\n".join(rendered).rstrip() + "\n")
PY
}

build_backend() {
  log_step "Installing backend dependencies"
  run_as_app_user_shell "cd '$APP_API_DIR' && NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_PREFER_OFFLINE=true npm ci"

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
  run_as_app_user_shell "cd '$APP_UI_DIR' && NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_PREFER_OFFLINE=true npm ci"

  log_step "Building frontend"
  sanitize_frontend_env
  local frontend_node_options
  frontend_node_options="$(shell_quote "$FRONTEND_BUILD_NODE_OPTIONS")"
  if [[ -n "$ASSET_RETENTION_DAYS" ]]; then
    local asset_retention_days
    asset_retention_days="$(shell_quote "$ASSET_RETENTION_DAYS")"
    run_as_app_user_shell "cd '$APP_UI_DIR' && unset NODE_ENV && NODE_OPTIONS=$frontend_node_options AGENT_STUDIO_ASSET_RETENTION_DAYS=$asset_retention_days npm run build"
  else
    run_as_app_user_shell "cd '$APP_UI_DIR' && unset NODE_ENV && NODE_OPTIONS=$frontend_node_options npm run build"
  fi

  [[ -f "$APP_UI_DIR/dist/index.html" ]] || die "frontend build did not produce dist/index.html"
  [[ -f "$APP_UI_DIR/dist/version.json" ]] || die "frontend build did not produce dist/version.json"
  [[ -f "$APP_UI_DIR/dist/stale-asset-reload.js" ]] || die "frontend build did not produce dist/stale-asset-reload.js"
  [[ -d "$APP_UI_DIR/dist/assets" ]] || die "frontend build did not produce dist/assets"
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
  refresh_caddy_config

  log_step "Deploy complete"
  log_info "Repo: $APP_REPO_DIR"
  log_info "PM2 app: $PM2_APP_NAME"
  log_info "PM2 ecosystem: $PM2_ECOSYSTEM_FILE"
  log_info "Caddy config: $CADDY_CONFIG_FILE"
  log_info "Public domain: ${DOMAIN:-<unset>}"
}

main
