#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
SOURCE_NODE="$SOURCE_ROOT/dependencies/node/bin/node"
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
mkdir -p "$STAGING/dependencies/node/bin"
if [[ -x "$SOURCE_NODE" ]]; then
  cp -aL "$SOURCE_NODE" "$STAGING/dependencies/node/bin/node"
else
  cp -aL "$(command -v node)" "$STAGING/dependencies/node/bin/node"
fi

cat > "$STAGING/dependencies/node/package.json" <<'EOF'
{
  "name": "agent-studio-shared-codex-runtime",
  "private": true,
  "dependencies": {
    "@tesseract.js-data/chi_sim": "1.0.0",
    "@tesseract.js-data/eng": "1.0.0",
    "@viz-js/viz": "3.28.0",
    "sharp": "0.34.5",
    "tesseract.js": "7.0.0"
  }
}
EOF
npm install \
  --prefix "$STAGING/dependencies/node" \
  --omit=dev \
  --no-audit \
  --no-fund \
  --package-lock=false

TARGET="$STAGING/dependencies/node/node_modules"
mkdir -p "$TARGET/@oai"
cp -aL "$ARTIFACT_TOOL" "$TARGET/@oai/artifact-tool"
cp -aL "$LUCIDE" "$TARGET/lucide"

mkdir -p "$STAGING/dependencies/bin/override"
cp "$script_dir/runtime-wrappers/heif-convert.mjs" "$STAGING/dependencies/bin/override/heif-convert"
cp "$script_dir/runtime-wrappers/dot.mjs" "$STAGING/dependencies/bin/override/dot"
cp "$script_dir/runtime-wrappers/tesseract.mjs" "$STAGING/dependencies/bin/override/tesseract"
ln -s dot "$STAGING/dependencies/bin/override/neato"
chmod 0755 \
  "$STAGING/dependencies/node/bin/node" \
  "$STAGING/dependencies/bin/override/heif-convert" \
  "$STAGING/dependencies/bin/override/dot" \
  "$STAGING/dependencies/bin/override/tesseract"

mkdir -p "$STAGING/dependencies/tessdata"
cp "$TARGET/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz" \
  "$STAGING/dependencies/tessdata/eng.traineddata.gz"
cp "$TARGET/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz" \
  "$STAGING/dependencies/tessdata/chi_sim.traineddata.gz"
rm -rf "$TARGET/@tesseract.js-data"

FONT_TARGET="$STAGING/dependencies/fonts"
mkdir -p "$FONT_TARGET" "$STAGING/dependencies/fontconfig"
font_count=0
while IFS= read -r font_file; do
  cp -aL "$font_file" "$FONT_TARGET/$(basename "$font_file")"
  font_count=$((font_count + 1))
done < <(
  find "$SOURCE_ROOT/dependencies" -type f \
    \( -iname 'Carlito-*.ttf' \
      -o -iname 'Caladea-*.ttf' \
      -o -iname 'LiberationSans-*.ttf' \
      -o -iname 'LiberationSerif-*.ttf' \
      -o -iname 'NotoSansCJK*.ttc' \
      -o -iname 'NotoSansCJK*.otf' \
      -o -iname 'NotoSerifCJK*.ttc' \
      -o -iname 'NotoSerifCJK*.otf' \) \
    -print
)
[[ "$font_count" -gt 0 ]] || {
  printf 'No compatible Office fonts were found under %s\n' "$SOURCE_ROOT/dependencies" >&2
  exit 1
}
cp "$script_dir/runtime-fontconfig/fonts.conf" "$STAGING/dependencies/fontconfig/fonts.conf"

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
const sharpPackage = path.join(root, "sharp");
const vizPackage = path.join(root, "@viz-js", "viz");
const tesseractPackage = path.join(root, "tesseract.js");
for (const packageDir of [sharpPackage, vizPackage, tesseractPackage]) {
  if (!fs.existsSync(path.join(packageDir, "package.json"))) {
    throw new Error(`missing shared runtime package: ${packageDir}`);
  }
}
console.log(`validated ${packageJson.name}@${packageJson.version}`);
EOF

mkdir -p "$(dirname "$OUTPUT")"
tar -czf "$OUTPUT" -C "$STAGING" .
printf 'Created %s\n' "$OUTPUT"
