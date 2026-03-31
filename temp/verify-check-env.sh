#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
base="$(cd "$script_dir/.." && pwd -P)"
script="$base/scripts/check-env.sh"

test -f "$script"
grep -q 'pm2 status' "$script"
grep -q 'CodexRuntime' "$script"
grep -q 'DATABASE_URL' "$script"
grep -q 'psql' "$script"
grep -q 'dist/index.html' "$script"
grep -q 'curl' "$script"
grep -q 'psql' "$script"
grep -q 'select 1' "$script"
bash -n "$script"
bash "$script" --help >/dev/null
