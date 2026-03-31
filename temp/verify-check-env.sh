#!/usr/bin/env bash
set -euo pipefail

base="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
script="$base/scripts/check-env.sh"

test -f "$script"
grep -q 'pm2 status' "$script"
grep -q 'CodexRuntime' "$script"
grep -q 'DATABASE_URL' "$script"
grep -q 'curl' "$script"
