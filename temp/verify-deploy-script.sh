#!/usr/bin/env bash
set -euo pipefail

base="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
script="$base/scripts/deploy-agent-studio.sh"

test -f "$script"
grep -q 'prisma migrate deploy' "$script"
grep -q 'SeedSystemRbacService' "$script"
grep -q 'npm run build' "$script"
grep -q 'pm2' "$script"
