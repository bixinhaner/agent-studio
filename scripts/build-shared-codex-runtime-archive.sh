#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  build-shared-codex-runtime-archive.sh --source <codex-primary-runtime> --output <archive.tar.gz>

The source must be a Linux Codex workspace dependency runtime. The archive is
consumed by deploy-agent-studio.sh and contains one shared, read-only copy of
the Node packages required by installed artifact plugins.
EOF
}

SOURCE_ROOT=""
OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_ROOT="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || {
  printf 'The shared runtime archive must be built on Linux.\n' >&2
  exit 1
}
[[ -n "$SOURCE_ROOT" && -n "$OUTPUT" ]] || {
  usage >&2
  exit 2
}

NODE_MODULES="$SOURCE_ROOT/dependencies/node/node_modules"
ARTIFACT_TOOL="$NODE_MODULES/@oai/artifact-tool"
LUCIDE="$NODE_MODULES/lucide"
[[ -f "$ARTIFACT_TOOL/package.json" ]] || {
  printf 'Missing @oai/artifact-tool in %s\n' "$NODE_MODULES" >&2
  exit 1
}
[[ -f "$LUCIDE/package.json" ]] || {
  printf 'Missing lucide in %s\n' "$NODE_MODULES" >&2
  exit 1
}

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
TARGET="$STAGING/dependencies/node/node_modules"
mkdir -p "$TARGET/@oai"
cp -aL "$ARTIFACT_TOOL" "$TARGET/@oai/artifact-tool"
cp -aL "$LUCIDE" "$TARGET/lucide"

node --input-type=module - "$TARGET" <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const packageRoot = path.join(root, "@oai", "artifact-tool");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const entrypoints = [
  path.join(packageRoot, "dist", "node", "artifact_tool.mjs"),
  path.join(packageRoot, "dist", "artifact_tool.mjs")
];
const entrypoint = entrypoints.find((candidate) => fs.existsSync(candidate));
if (packageJson.name !== "@oai/artifact-tool" || !entrypoint) {
  throw new Error("invalid @oai/artifact-tool package");
}
await import(pathToFileURL(entrypoint).href);
console.log(`validated ${packageJson.name}@${packageJson.version}`);
EOF

mkdir -p "$(dirname "$OUTPUT")"
tar -czf "$OUTPUT" -C "$STAGING" .
printf 'Created %s\n' "$OUTPUT"
