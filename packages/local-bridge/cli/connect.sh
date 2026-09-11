#!/usr/bin/env bash
set -euo pipefail
# Installs only in the current user's data directory. Never changes the caller's cwd.
if [ "$(uname -s)" != Linux ]; then echo '此命令用于 Linux；macOS / Windows 请使用桌面客户端。' >&2; exit 1; fi
case "$(uname -m)" in x86_64) bridge_arch=x64 ;; aarch64|arm64) bridge_arch=arm64 ;; *) echo '暂不支持此 CPU 架构。' >&2; exit 1 ;; esac
bridge_libc=$(getconf GNU_LIBC_VERSION 2>/dev/null || true)
if [[ "$bridge_libc" != "glibc "* ]]; then echo '需要 glibc 2.28 或更新版本（如 Ubuntu 20.04+、Debian 10+）；暂不支持 Alpine。' >&2; exit 1; fi
for bridge_tool in curl tar sha256sum; do command -v "$bridge_tool" >/dev/null || { echo "请先安装 $bridge_tool，再运行此命令。" >&2; exit 1; }; done
bridge_download="${BAILEY_DOWNLOAD_URL:-https://bailey.baicells.com/downloads/local-bridge}"
bridge_home="${XDG_DATA_HOME:-$HOME/.local/share}/bailey-local-bridge"
mkdir -p "$bridge_home"
bridge_stage=$(mktemp -d "$bridge_home/.install.XXXXXX")
trap 'rm -rf -- "$bridge_stage"' EXIT
bridge_name="bailey-connect-linux-$bridge_arch.tar.gz"
curl --fail --silent --show-error --location --retry 2 "$bridge_download/cli-SHA256SUMS" -o "$bridge_stage/SHA256SUMS"
bridge_hash=$(awk -v name="$bridge_name" '$2 == name {print $1}' "$bridge_stage/SHA256SUMS")
if [[ ! "$bridge_hash" =~ ^[a-f0-9]{64}$ ]]; then echo '下载信息不完整，请稍后重试。' >&2; exit 1; fi
bridge_release="$bridge_home/$bridge_hash"
if [ ! -x "$bridge_release/bin/node" ]; then
  echo '正在安装 Bailey 命令行连接…' >&2
  curl --fail --silent --show-error --location --retry 2 "$bridge_download/$bridge_name" -o "$bridge_stage/$bridge_name"
  printf '%s  %s\n' "$bridge_hash" "$bridge_stage/$bridge_name" | sha256sum --check --status || { echo '下载校验失败，请重新运行。' >&2; exit 1; }
  mkdir "$bridge_stage/package"
  tar -xzf "$bridge_stage/$bridge_name" -C "$bridge_stage/package" --no-same-owner
  "$bridge_stage/package/bin/node" --version >/dev/null || { echo '此 Linux 环境无法运行客户端，需要 glibc 2.28 或更新版本。' >&2; exit 1; }
  mv -T "$bridge_stage/package" "$bridge_release" 2>/dev/null || [ -x "$bridge_release/bin/node" ]
fi
mkdir -p "$HOME/.local/bin"
ln -sfn "$bridge_release/bin/bailey-connect" "$HOME/.local/bin/bailey-connect"
echo '以后可在目标目录运行 ~/.local/bin/bailey-connect，无需重新安装。' >&2
rm -rf -- "$bridge_stage"
trap - EXIT
exec "$bridge_release/bin/bailey-connect" "$@"
