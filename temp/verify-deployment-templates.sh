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

grep -q 'INSTALL_ROOT=' "$base/scripts/lib/common.sh"
grep -q 'INSTALL_STATE_FILE=' "$base/scripts/lib/common.sh"
grep -q 'redact_secret' "$base/scripts/lib/common.sh"
grep -q 'run_as_app_user' "$base/scripts/lib/common.sh"
grep -q 'state_write_json' "$base/scripts/lib/common.sh"
grep -q 'DATABASE_URL=' "$base/templates/agent-api.env.template"
grep -q 'API_BASE_URL=/api' "$base/templates/agent-api.env.template"
grep -q 'VITE_AGENT_API_BASE=/api' "$base/templates/agent-ui.env.production.template"
grep -q 'reverse_proxy' "$base/templates/Caddyfile.template"
grep -q 'agent-studio-api' "$base/templates/pm2-ecosystem.config.cjs.template"
grep -q 'cwd:' "$base/templates/pm2-ecosystem.config.cjs.template"
