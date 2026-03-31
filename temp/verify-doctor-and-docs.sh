#!/usr/bin/env bash
set -euo pipefail

base="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

test -f "$base/scripts/doctor.sh"
test -f "$base/docs/deployment/ubuntu-caddy-pm2.md"
test -f "$base/docs/deployment/private-repo-deploy-key.md"
test -f "$base/docs/deployment/troubleshooting.md"
grep -q 'journalctl' "$base/scripts/doctor.sh"
grep -q 'prisma migrate status' "$base/scripts/doctor.sh"
grep -q 'DINGTALK_REDIRECT_URI' "$base/scripts/doctor.sh"
grep -q 'SESSION_COOKIE_SECURE' "$base/scripts/doctor.sh"
grep -q 'deploy key' "$base/docs/deployment/private-repo-deploy-key.md"
grep -q 'PM2' "$base/docs/deployment/ubuntu-caddy-pm2.md"
