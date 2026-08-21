#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=/dev/null
source "$script_dir/lib/common.sh"

DWS_VERSION="${DWS_VERSION:-v1.0.59}"
DWS_RELEASE_REPOSITORY="${DWS_RELEASE_REPOSITORY:-DingTalk-Real-AI/dingtalk-workspace-cli}"
DWS_INSTALL_PATH="${DWS_INSTALL_PATH:-/usr/local/bin/dws}"
DWS_USER_HOME_ROOT="${DWS_USER_HOME_ROOT:-/var/lib/agent-studio/dws-users}"
DWS_SKILLS_ROOT="${DWS_SKILLS_ROOT:-$APP_HOME/.codex/skills}"
DWS_DOWNLOAD_DIR=""

DWS_SKILL_NAMES=(
  dingtalk-aisearch
  dingtalk-aitable
  dingtalk-calendar
  dingtalk-chat
  dingtalk-contact
  dingtalk-doc
  dingtalk-drive
  dingtalk-event
  dingtalk-mail
  dingtalk-minutes
  dingtalk-misc
  dingtalk-shared
  dingtalk-todo
  dingtalk-wiki
)

resolve_dws_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    *) die "unsupported DWS architecture: $(uname -m)" ;;
  esac
}

verify_release_asset() {
  local checksum_file="$1"
  local asset_path="$2"
  local asset_name="$3"
  local expected
  local actual
  expected="$(awk -v name="$asset_name" '$2 == name { print $1; exit }' "$checksum_file")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "missing checksum for DWS asset: $asset_name"
  actual="$(sha256sum "$asset_path" | awk '{ print $1 }')"
  [[ "$actual" == "$expected" ]] || die "checksum mismatch for DWS asset: $asset_name"
}

installed_dws_version() {
  [[ -x "$DWS_INSTALL_PATH" ]] || return 0
  "$DWS_INSTALL_PATH" version 2>/dev/null | awk '/^Version:/ { print $2; exit }'
}

dws_skills_are_current() {
  local marker="$DWS_SKILLS_ROOT/.dws-official-version"
  [[ -f "$marker" ]] || return 1
  [[ "$(tr -d '[:space:]' < "$marker")" == "$DWS_VERSION" ]] || return 1
  local name
  for name in "${DWS_SKILL_NAMES[@]}"; do
    [[ -f "$DWS_SKILLS_ROOT/$name/SKILL.md" ]] || return 1
  done
}

cleanup_download_dir() {
  if [[ -n "$DWS_DOWNLOAD_DIR" && -d "$DWS_DOWNLOAD_DIR" ]]; then
    rm -rf -- "$DWS_DOWNLOAD_DIR"
  fi
}

install_dws_binary() {
  local download_dir="$1"
  local checksums="$2"
  if [[ "$(installed_dws_version)" == "$DWS_VERSION" ]]; then
    log_info "DWS runtime is already $DWS_VERSION"
    return 0
  fi

  local arch
  local asset_name
  local asset_path
  local extract_dir
  arch="$(resolve_dws_arch)"
  asset_name="dws-linux-$arch.tar.gz"
  asset_path="$download_dir/$asset_name"
  extract_dir="$download_dir/binary"

  log_step "Downloading DWS runtime $DWS_VERSION"
  curl -fsSL -o "$asset_path" \
    "https://github.com/$DWS_RELEASE_REPOSITORY/releases/download/$DWS_VERSION/$asset_name"
  verify_release_asset "$checksums" "$asset_path" "$asset_name"
  if tar -tzf "$asset_path" | grep -Eq '(^/|(^|/)\.\.(/|$)|\\)'; then
    die "DWS runtime archive contains an unsafe path"
  fi
  mkdir -p "$extract_dir"
  tar -xzf "$asset_path" -C "$extract_dir"
  [[ -x "$extract_dir/dws" ]] || die "DWS runtime archive does not contain an executable dws binary"
  run_as_root install -o root -g root -m 0755 "$extract_dir/dws" "$DWS_INSTALL_PATH"
  [[ "$(installed_dws_version)" == "$DWS_VERSION" ]] || die "installed DWS version does not match $DWS_VERSION"
}

install_dws_skills() {
  local download_dir="$1"
  local checksums="$2"
  if dws_skills_are_current; then
    log_info "Official DWS Skills are already $DWS_VERSION"
    return 0
  fi

  local asset_name="dws-skills.zip"
  local asset_path="$download_dir/$asset_name"
  local extract_dir="$download_dir/skills"
  local backup_root="$APP_HOME/.dws/skill-backups/${DWS_VERSION}-$(date -u +%Y%m%dT%H%M%SZ)"
  local marker="$download_dir/dws-official-version"
  local name

  log_step "Downloading official DWS Skills $DWS_VERSION"
  curl -fsSL -o "$asset_path" \
    "https://github.com/$DWS_RELEASE_REPOSITORY/releases/download/$DWS_VERSION/$asset_name"
  verify_release_asset "$checksums" "$asset_path" "$asset_name"
  if zipinfo -1 "$asset_path" | grep -Eq '(^/|(^|/)\.\.(/|$)|\\)'; then
    die "DWS Skill archive contains an unsafe path"
  fi
  mkdir -p "$extract_dir"
  unzip -q "$asset_path" -d "$extract_dir"
  for name in "${DWS_SKILL_NAMES[@]}"; do
    [[ -f "$extract_dir/multi/$name/SKILL.md" ]] || die "DWS Skill archive is missing $name"
  done

  run_as_root install -d -o "$APP_USER" -g "$APP_GROUP" -m 0755 "$DWS_SKILLS_ROOT"
  for name in "${DWS_SKILL_NAMES[@]}"; do
    if run_as_root test -e "$DWS_SKILLS_ROOT/$name" || run_as_root test -L "$DWS_SKILLS_ROOT/$name"; then
      run_as_root install -d -o "$APP_USER" -g "$APP_GROUP" -m 0755 "$backup_root"
      run_as_root mv "$DWS_SKILLS_ROOT/$name" "$backup_root/$name"
    fi
    run_as_root mv "$extract_dir/multi/$name" "$DWS_SKILLS_ROOT/$name"
    run_as_root chown -R "$APP_USER:$APP_GROUP" "$DWS_SKILLS_ROOT/$name"
  done
  printf '%s\n' "$DWS_VERSION" > "$marker"
  run_as_root install -o "$APP_USER" -g "$APP_GROUP" -m 0644 "$marker" "$DWS_SKILLS_ROOT/.dws-official-version"
}

main() {
  require_command awk
  require_command curl
  require_command sha256sum
  require_command tar
  require_command unzip
  require_command zipinfo

  [[ "$DWS_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || die "invalid DWS_VERSION: $DWS_VERSION"

  local download_dir
  local checksums
  download_dir="$(mktemp -d)"
  DWS_DOWNLOAD_DIR="$download_dir"
  trap cleanup_download_dir EXIT
  checksums="$download_dir/checksums.txt"
  curl -fsSL -o "$checksums" \
    "https://github.com/$DWS_RELEASE_REPOSITORY/releases/download/$DWS_VERSION/checksums.txt"

  install_dws_binary "$download_dir" "$checksums"
  install_dws_skills "$download_dir" "$checksums"
  run_as_root install -d -o "$APP_USER" -g "$APP_GROUP" -m 0700 "$DWS_USER_HOME_ROOT"
  log_info "DWS runtime and official multi-Skills are ready at $DWS_VERSION"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi
