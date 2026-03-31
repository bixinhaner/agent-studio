# Agent Studio Ubuntu Deployment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repository-hosted Ubuntu deployment automation for Agent Studio, including resumable installation, guided private-repo clone, normal deploy updates, health checks, and diagnostics.

**Architecture:** Introduce a shell-based deployment toolchain under `scripts/` with shared helpers, resumable install state at `/usr/local/agent-studio/install-state.json`, and config templates under `templates/`. Keep deployment same-origin with Caddy, run the app as `agentstudio` under PM2, rely on PostgreSQL, and preserve the current runtime behavior where Codex auth comes from the server user's default environment.

**Tech Stack:** Bash, Ubuntu package tooling, PM2, Caddy, PostgreSQL, existing Prisma/RBAC build pipeline, repository docs and templates.

---

## File Structure

### Scripts
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
  - shared shell helpers for logging, prompts, state persistence, user switching, redaction, and command wrappers
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
  - resumable install wizard with CLI overrides
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/deploy-agent-studio.sh`
  - code update + build + migrate + seed + PM2 restart
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/check-env.sh`
  - environment and health validation
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/doctor.sh`
  - diagnostics helper for common failures

### Templates
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-api.env.template`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-ui.env.production.template`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/Caddyfile.template`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/pm2-ecosystem.config.cjs.template`

### Docs
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/ubuntu-caddy-pm2.md`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/private-repo-deploy-key.md`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/troubleshooting.md`

### References
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/superpowers/specs/2026-03-31-agent-studio-ubuntu-deployment-automation-design.md`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/prisma/schema.prisma`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/rbac/seed-system-rbac.ts`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-api/src/codex-runtime.ts`
- Read: `/Users/like/Desktop/baicells/Trae/agent-studio/agent-ui/src/lib/api.ts`

---

### Task 1: Build Shared Deployment Shell Library and Templates

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-api.env.template`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/agent-ui.env.production.template`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/Caddyfile.template`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/pm2-ecosystem.config.cjs.template`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-deployment-templates.sh`

- [ ] **Step 1: Write a temporary verification script that fails until the shared library and templates exist**

```bash
#!/usr/bin/env bash
set -euo pipefail

base="/Users/like/Desktop/baicells/Trae/agent-studio"
for path in \
  "$base/scripts/lib/common.sh" \
  "$base/templates/agent-api.env.template" \
  "$base/templates/agent-ui.env.production.template" \
  "$base/templates/Caddyfile.template" \
  "$base/templates/pm2-ecosystem.config.cjs.template"
do
  test -f "$path"
done

grep -q 'INSTALL_STATE_FILE' "$base/scripts/lib/common.sh"
grep -q 'DATABASE_URL=' "$base/templates/agent-api.env.template"
grep -q 'VITE_AGENT_API_BASE=' "$base/templates/agent-ui.env.production.template"
grep -q 'reverse_proxy' "$base/templates/Caddyfile.template"
grep -q 'agent-studio-api' "$base/templates/pm2-ecosystem.config.cjs.template"
```

- [ ] **Step 2: Run the verification script to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-deployment-templates.sh
```

Expected:
- FAIL because the files do not exist yet

- [ ] **Step 3: Create the shared shell helper library and config templates**

```bash
# scripts/lib/common.sh
INSTALL_ROOT="${INSTALL_ROOT:-/usr/local/agent-studio}"
INSTALL_STATE_FILE="${INSTALL_STATE_FILE:-$INSTALL_ROOT/install-state.json}"
APP_USER="${APP_USER:-agentstudio}"
APP_ROOT="${APP_ROOT:-$INSTALL_ROOT/app/agent-studio}"

log_step() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}
```

```env
# templates/agent-api.env.template
NODE_ENV=production
DATABASE_URL=postgresql://agent_studio:CHANGE_ME@127.0.0.1:5432/agent_studio?schema=public
HOST=127.0.0.1
PORT=8787
DEFAULT_WORKSPACE=/usr/local/agent-studio/data/workspaces
WORKSPACE_WHITELIST=/usr/local/agent-studio/data/workspaces
UPLOAD_TEMP_ROOT=/usr/local/agent-studio/data/session-uploads
KNOWLEDGE_SET_STORAGE_ROOT=/usr/local/agent-studio/data/knowledge-sets
SESSION_COOKIE_SECURE=true
```

```caddy
# templates/Caddyfile.template
{$DOMAIN} {
    encode gzip zstd
    root * {$UI_DIST}
    file_server

    @api path /api/* /healthz
    reverse_proxy @api 127.0.0.1:8787

    @spa {
        not path /api/* /healthz
        not file
    }
    rewrite @spa /index.html
    file_server
}
```

- [ ] **Step 4: Run the verification script again**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-deployment-templates.sh
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/common.sh templates temp/verify-deployment-templates.sh
git commit -m "feat: add deployment templates and shell helpers"
```

### Task 2: Implement Resumable Ubuntu Installer

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-install-script.sh`

- [ ] **Step 1: Write a temporary verification script that checks install wizard surfaces**

```bash
#!/usr/bin/env bash
set -euo pipefail

script="/Users/like/Desktop/baicells/Trae/agent-studio/scripts/install-ubuntu.sh"
test -f "$script"
grep -q -- '--domain' "$script"
grep -q 'install-state.json' "$script"
grep -q 'deploy key' "$script"
grep -q 'prompt_' "$script"
```

- [ ] **Step 2: Run the verification script to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-install-script.sh
```

Expected:
- FAIL because installer does not exist yet

- [ ] **Step 3: Implement the resumable installer with interactive prompts and CLI overrides**

```bash
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --skip-codex-check) SKIP_CODEX_CHECK=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

ensure_app_user
ensure_base_directories
ensure_private_repo_clone
ensure_postgres_ready
ensure_env_files
ensure_caddy_config
run_first_deploy
verify_runtime_or_mark_pending
```

- [ ] **Step 4: Run verification and a no-op help check**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-install-script.sh
bash scripts/install-ubuntu.sh --help
```

Expected:
- verification script PASS
- help output exits 0

- [ ] **Step 5: Commit**

```bash
git add scripts/install-ubuntu.sh scripts/lib/common.sh temp/verify-install-script.sh
git commit -m "feat: add resumable ubuntu installer"
```

### Task 3: Implement Update Deploy Script with Migrate + Seed + PM2 Restart

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/deploy-agent-studio.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/templates/pm2-ecosystem.config.cjs.template`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-deploy-script.sh`

- [ ] **Step 1: Write a temporary verification script for deploy behavior**

```bash
#!/usr/bin/env bash
set -euo pipefail

script="/Users/like/Desktop/baicells/Trae/agent-studio/scripts/deploy-agent-studio.sh"
test -f "$script"
grep -q 'prisma migrate deploy' "$script"
grep -q 'SeedSystemRbacService' "$script"
grep -q 'npm run build' "$script"
grep -q 'pm2' "$script"
```

- [ ] **Step 2: Run the verification script to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-deploy-script.sh
```

Expected:
- FAIL because deploy script does not exist yet

- [ ] **Step 3: Implement the normal update/deploy flow**

```bash
cd "$APP_ROOT"
git fetch origin
git checkout main
git pull --ff-only origin main

cd "$APP_ROOT/agent-api"
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run build
node --input-type=module <<'EOF'
import { createDbClient } from './dist/db/client.js';
import { RoleRepository } from './dist/persistence/role-repository.js';
import { PermissionRepository } from './dist/persistence/permission-repository.js';
import { RolePermissionRepository } from './dist/persistence/role-permission-repository.js';
import { SeedSystemRbacService } from './dist/rbac/seed-system-rbac.js';
const db = createDbClient();
try {
  await new SeedSystemRbacService({
    roles: new RoleRepository(db),
    permissions: new PermissionRepository(db),
    rolePermissions: new RolePermissionRepository(db)
  }).run();
} finally {
  await db.$disconnect();
}
EOF
```

- [ ] **Step 4: Run verification**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-deploy-script.sh
bash scripts/deploy-agent-studio.sh --help
```

Expected:
- verification script PASS
- help output exits 0

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy-agent-studio.sh templates/pm2-ecosystem.config.cjs.template temp/verify-deploy-script.sh
git commit -m "feat: add ubuntu deploy script"
```

### Task 4: Implement Environment Health Check Script

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/check-env.sh`
- Modify: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/lib/common.sh`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-check-env.sh`

- [ ] **Step 1: Write a temporary verification script for health-check capabilities**

```bash
#!/usr/bin/env bash
set -euo pipefail

script="/Users/like/Desktop/baicells/Trae/agent-studio/scripts/check-env.sh"
test -f "$script"
grep -q 'pm2 status' "$script"
grep -q 'CodexRuntime' "$script"
grep -q 'DATABASE_URL' "$script"
grep -q 'curl' "$script"
```

- [ ] **Step 2: Run the verification script to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-check-env.sh
```

Expected:
- FAIL because check script does not exist yet

- [ ] **Step 3: Implement health and runtime validation**

```bash
require_binary node
require_binary npm
require_binary psql
require_binary pm2
require_binary caddy

check_file "$APP_ROOT/agent-api/.env"
check_file "$APP_ROOT/agent-ui/.env.production"
check_file /etc/caddy/Caddyfile
check_http http://127.0.0.1:8787/healthz
run_as_app_user "cd '$APP_ROOT/agent-api' && node --input-type=module <<'EOF'
import { CodexRuntime } from './dist/codex-runtime.js';
const runtime = new CodexRuntime();
await runtime.validateProvider({ model: 'gpt-5.4', reasoningEffort: 'high' });
console.log('codex runtime ok');
EOF"
```

- [ ] **Step 4: Run verification and syntax check**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-check-env.sh
bash -n scripts/check-env.sh
```

Expected:
- verification script PASS
- shell syntax check PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/check-env.sh scripts/lib/common.sh temp/verify-check-env.sh
git commit -m "feat: add deployment health checks"
```

### Task 5: Implement Diagnostics Helper and Deployment Docs

**Files:**
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/scripts/doctor.sh`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/ubuntu-caddy-pm2.md`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/private-repo-deploy-key.md`
- Create: `/Users/like/Desktop/baicells/Trae/agent-studio/docs/deployment/troubleshooting.md`
- Test: `/Users/like/Desktop/baicells/Trae/agent-studio/temp/verify-doctor-and-docs.sh`

- [ ] **Step 1: Write a temporary verification script for diagnostics and docs**

```bash
#!/usr/bin/env bash
set -euo pipefail

base="/Users/like/Desktop/baicells/Trae/agent-studio"
test -f "$base/scripts/doctor.sh"
test -f "$base/docs/deployment/ubuntu-caddy-pm2.md"
test -f "$base/docs/deployment/private-repo-deploy-key.md"
test -f "$base/docs/deployment/troubleshooting.md"
grep -q 'journalctl' "$base/scripts/doctor.sh"
grep -q 'deploy key' "$base/docs/deployment/private-repo-deploy-key.md"
grep -q 'PM2' "$base/docs/deployment/ubuntu-caddy-pm2.md"
```

- [ ] **Step 2: Run the verification script to confirm failure**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-doctor-and-docs.sh
```

Expected:
- FAIL because doctor/docs do not exist yet

- [ ] **Step 3: Implement diagnostics helper and deployment docs**

```bash
# scripts/doctor.sh
set -euo pipefail

print_section "pm2"
pm2 status || true
print_section "api logs"
run_as_app_user "pm2 logs agent-studio-api --lines 80 --nostream" || true
print_section "caddy"
sudo caddy validate --config /etc/caddy/Caddyfile || true
print_section "postgres"
psql "$DATABASE_URL" -c 'select 1' || true
```

```md
# Ubuntu Deployment with Caddy and PM2

1. Run `scripts/install-ubuntu.sh`
2. Complete private-repo deploy-key setup when prompted.
3. Re-run the installer until all required steps are marked complete.
4. Use `scripts/check-env.sh` for validation.
5. Use `scripts/deploy-agent-studio.sh` for future upgrades.
```

- [ ] **Step 4: Run verification and shell syntax check**

Run:
```bash
cd /Users/like/Desktop/baicells/Trae/agent-studio
bash temp/verify-doctor-and-docs.sh
bash -n scripts/doctor.sh
```

Expected:
- verification script PASS
- shell syntax check PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/doctor.sh docs/deployment temp/verify-doctor-and-docs.sh
git commit -m "feat: add deployment diagnostics and docs"
```
