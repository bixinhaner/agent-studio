#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
base="$(cd "$script_dir/.." && pwd -P)"
script="$base/scripts/install-ubuntu.sh"

# The installer is not implemented yet; this should fail until task 2 lands.
test -f "$script"
grep -q -- '--domain' "$script"
grep -q -- '--repo-url' "$script"
grep -q -- '--skip-codex-check' "$script"
grep -q 'install-state.json' "$script"
grep -q 'deploy key' "$script"
grep -q 'prompt_' "$script"
