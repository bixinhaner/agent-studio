#!/usr/bin/env bash
# Installs or upgrades a Bailey agent host beside a business system (Linux, systemd, run as root).
#
# First install (one instance per business system; <name> is the systemd instance):
#   curl -fsSL https://bailey.baicells.com/downloads/local-bridge/agent-host-install.sh | sudo bash -s -- \
#     --name netopt --user app-user --app-url http://127.0.0.1:9090 --sessions-root /data/ai-sessions
# Upgrade (keeps the configuration and the Bailey connection):
#   curl -fsSL …/agent-host-install.sh | sudo bash -s -- --name netopt
#
# Which Bailey and which connector are not set here: the application's administrator enters
# Bailey's address and a connector access key in the application, which passes them to the host.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
用法：agent-host-install.sh --name <实例名> [选项]
  首次安装必填：
    --user <用户>            运行服务的系统用户（通常与业务系统相同，便于读写会话目录和共享密钥）
    --app-url <URL>          业务系统本机地址，如 http://127.0.0.1:9090
    --sessions-root <目录>   业务系统存放会话目录的根目录
  可选：
    --secret-file <文件>     与业务系统共享的密钥文件；不存在时自动生成（默认 /etc/bailey-agent-host/<实例名>.secret）
    --port <端口>            本机监听端口（默认 9191，只监听 127.0.0.1）
    --instance-id <ID>       实例标识（默认 <实例名>-<主机名>）
    --instance-name <名称>   在 Bailey 中显示的主机名称（默认实例名）
    --source-system <标识>   业务系统标识（默认实例名）
    --capabilities-path <路径> / --operations-path <路径>   业务系统接口（默认 /api/ai/capabilities、/api/ai/operations）
    --read-only <目录>       沙箱内额外只读可见的目录，可重复
    --env <KEY=VALUE>        沙箱内命令的环境变量，可重复
    --sandbox <bwrap|none>   命令隔离方式（默认 bwrap）
    --download-url <URL>     安装包下载地址（默认 $BAILEY_DOWNLOAD_URL 或 https://bailey.baicells.com/downloads/local-bridge）
    --package <tar.gz>       使用本地安装包（离线安装）
  只带 --name 重新运行即为升级，保留配置和 Bailey 连接。
EOF
  exit 2
}

name='' user='' app_url='' sessions_root='' secret_file='' port='' instance_id='' instance_name='' source_system=''
capabilities_path='' operations_path='' sandbox='' package=''
download="${BAILEY_DOWNLOAD_URL:-https://bailey.baicells.com/downloads/local-bridge}"
read_only=() env_vars=()
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || usage
  case "$1" in
    --name) name=$2 ;; --user) user=$2 ;; --app-url) app_url=$2 ;; --sessions-root) sessions_root=$2 ;;
    --secret-file) secret_file=$2 ;; --port) port=$2 ;; --instance-id) instance_id=$2 ;; --instance-name) instance_name=$2 ;;
    --source-system) source_system=$2 ;; --capabilities-path) capabilities_path=$2 ;; --operations-path) operations_path=$2 ;;
    --read-only) read_only+=("$2") ;; --env) env_vars+=("$2") ;; --sandbox) sandbox=$2 ;;
    --download-url) download=$2 ;; --package) package=$2 ;;
    *) usage ;;
  esac
  shift 2
done

fail() { echo "错误：$*" >&2; exit 1; }
[[ "$name" =~ ^[a-z0-9][a-z0-9_-]{0,39}$ ]] || fail '--name 需为小写字母、数字、- 或 _（最多 40 个字符）'
[ "$(id -u)" = 0 ] || fail '请用 root 运行（sudo）'
[ "$(uname -s)" = Linux ] && command -v systemctl >/dev/null || fail '需要使用 systemd 的 Linux'
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) fail '暂不支持此 CPU 架构' ;; esac
for tool in tar sha256sum; do command -v "$tool" >/dev/null || fail "请先安装 $tool"; done

prefix=/opt/bailey-agent-host
config_dir=/etc/bailey-agent-host
config="$config_dir/$name.json"
state_dir="/var/lib/bailey-agent-host/$name"
unit="bailey-agent-host@$name.service"
configuring=0
if [ -n "$user$app_url$sessions_root$secret_file$port$instance_id$instance_name$source_system$capabilities_path$operations_path$sandbox" ] || [ ${#read_only[@]} -gt 0 ] || [ ${#env_vars[@]} -gt 0 ]; then configuring=1; fi
if [ ! -f "$config" ]; then
  configuring=1
  [ -n "$user" ] && [ -n "$app_url" ] && [ -n "$sessions_root" ] || fail "首次安装需要 --user、--app-url 和 --sessions-root"
fi

# ---- package ---------------------------------------------------------------------------------
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
archive_name="bailey-agent-host-linux-$arch.tar.gz"
if [ -n "$package" ]; then
  cp -- "$package" "$stage/$archive_name"
else
  command -v curl >/dev/null || fail '请先安装 curl'
  curl --fail --silent --show-error --location --retry 2 "$download/agent-host-SHA256SUMS" -o "$stage/SHA256SUMS"
  expected=$(awk -v name="$archive_name" '$2 == name {print $1}' "$stage/SHA256SUMS")
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail '下载信息不完整，请稍后重试'
  curl --fail --silent --show-error --location --retry 2 "$download/$archive_name" -o "$stage/$archive_name"
  printf '%s  %s\n' "$expected" "$stage/$archive_name" | sha256sum --check --status || fail '下载校验失败，请重新运行'
fi
release_id=$(sha256sum "$stage/$archive_name" | cut -c1-16)
release="$prefix/releases/$release_id"
if [ ! -x "$release/bin/node" ]; then
  mkdir -p "$stage/package" "$prefix/releases"
  tar -xzf "$stage/$archive_name" -C "$stage/package" --no-same-owner
  "$stage/package/bin/node" --version >/dev/null || fail '此 Linux 环境无法运行内置 Node.js（需要 glibc 2.28 或更新版本）'
  chmod -R go-w "$stage/package"
  rm -rf -- "$release"; mv -T "$stage/package" "$release"
fi
ln -sfn "$release" "$prefix/current.tmp" && mv -Tf "$prefix/current.tmp" "$prefix/current"
node="$prefix/current/bin/node"
install -m 0644 "$prefix/current/bailey-agent-host@.service" /etc/systemd/system/bailey-agent-host@.service
echo "已安装 agent-host $(cat "$prefix/current/VERSION") → $release" >&2

# ---- configuration ---------------------------------------------------------------------------
mkdir -p "$config_dir" "$state_dir"
if [ "$configuring" = 1 ]; then
  if [ -f "$config" ]; then
    current_user=$(stat -c %U "$state_dir")
    user=${user:-$current_user}
  fi
  id "$user" >/dev/null 2>&1 || fail "系统用户 $user 不存在"
  group=$(id -gn "$user")
  secret_file=${secret_file:-$config_dir/$name.secret}
  if [ ! -s "$secret_file" ]; then
    mkdir -p "$(dirname "$secret_file")"
    (umask 077; "$node" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex") + "\n")' > "$secret_file")
    chown "root:$group" "$secret_file"; chmod 0640 "$secret_file"
    echo "已生成共享密钥 $secret_file（业务系统用它调用 agent-host）" >&2
  fi
  # Merge the given options into the existing configuration (or the defaults) with the bundled Node.
  read_only_json=$("$node" -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ${read_only[@]+"${read_only[@]}"})
  env_json=$("$node" -e 'console.log(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(p => { const i = p.indexOf("="); if (i < 1) throw new Error("--env 需要 KEY=VALUE：" + p); return [p.slice(0, i), p.slice(i + 1)]; }))))' -- ${env_vars[@]+"${env_vars[@]}"})
  CONFIG="$config" NAME="$name" HOST="$(hostname -s)" STATE_DIR="$state_dir" APP_URL="$app_url" SESSIONS_ROOT="$sessions_root" SECRET_FILE="$secret_file" \
  PORT="$port" INSTANCE_ID="$instance_id" INSTANCE_NAME="$instance_name" SOURCE_SYSTEM="$source_system" \
  CAPABILITIES_PATH="$capabilities_path" OPERATIONS_PATH="$operations_path" SANDBOX="$sandbox" READ_ONLY="$read_only_json" ENV_VARS="$env_json" \
  "$node" -e '
    const fs = require("node:fs"); const e = process.env;
    let c = {}; try { c = JSON.parse(fs.readFileSync(e.CONFIG, "utf8")); } catch {}
    const set = (value, apply) => { if (value) apply(value); };
    c.instanceId ||= `${e.NAME}-${e.HOST}`; c.instanceName ||= e.NAME; c.sourceSystem ||= e.NAME;
    set(e.INSTANCE_ID, v => c.instanceId = v); set(e.INSTANCE_NAME, v => c.instanceName = v); set(e.SOURCE_SYSTEM, v => c.sourceSystem = v);
    c.listen = { host: "127.0.0.1", port: Number(e.PORT || c.listen?.port || 9191) };
    c.secretFile = e.SECRET_FILE; c.stateDir = e.STATE_DIR;
    set(e.SESSIONS_ROOT, v => c.sessionsRoot = v);
    c.app = { ...(c.app || {}) }; set(e.APP_URL, v => c.app.baseUrl = v);
    set(e.CAPABILITIES_PATH, v => c.app.capabilitiesPath = v); set(e.OPERATIONS_PATH, v => c.app.operationsPath = v);
    c.sandbox = { mode: "bwrap", limits: { cpuSeconds: 900, fileSizeMb: 2048, openFiles: 1024 }, ...(c.sandbox || {}) };
    set(e.SANDBOX, v => c.sandbox.mode = v);
    const readOnly = JSON.parse(e.READ_ONLY), env = JSON.parse(e.ENV_VARS);
    if (readOnly.length) c.sandbox.readOnlyPaths = readOnly;
    if (Object.keys(env).length) c.sandbox.env = env;
    delete c.studio; // the Bailey connection is set from the application, not here
    fs.writeFileSync(e.CONFIG + ".tmp", JSON.stringify(c, null, 2) + "\n"); fs.renameSync(e.CONFIG + ".tmp", e.CONFIG);
  '
  chmod 0644 "$config"
  sessions_root=$("$node" -e 'console.log(require(process.argv[1]).sessionsRoot)' "$config")
  [ -d "$sessions_root" ] || { mkdir -p "$sessions_root"; chown "$user:$group" "$sessions_root"; }
  [ "$("$node" -e 'console.log(require(process.argv[1]).sandbox.mode)' "$config")" != bwrap ] || command -v bwrap >/dev/null \
    || echo '警告：未找到 bubblewrap（bwrap），智能体将无法在本机运行命令。请安装 bubblewrap，或用 --sandbox none（仅限可信环境）。' >&2
  mkdir -p "/etc/systemd/system/$unit.d"
  cat > "/etc/systemd/system/$unit.d/10-instance.conf" <<EOF
# Written by agent-host-install.sh; rerun it to change.
[Service]
User=$user
Group=$group
ReadWritePaths=$sessions_root
EOF
fi
service_user=$(awk -F= '/^User=/{print $2}' "/etc/systemd/system/$unit.d/10-instance.conf")
chown -R "$service_user:$(id -gn "$service_user")" "$state_dir"
chmod 0700 "$state_dir"

systemctl daemon-reload
systemctl enable "$unit" >/dev/null 2>&1
systemctl restart "$unit"
for _ in 1 2 3 4 5 6 7 8 9 10; do systemctl is-active --quiet "$unit" && break; sleep 1; done
systemctl is-active --quiet "$unit" || { journalctl -u "$unit" -n 30 --no-pager >&2; fail "$unit 未能启动"; }
port=$("$node" -e 'console.log(require(process.argv[1]).listen.port)' "$config")
secret_file=$("$node" -e 'console.log(require(process.argv[1]).secretFile)' "$config")
cat >&2 <<EOF

agent-host 已运行：$unit，监听 127.0.0.1:$port
业务系统配置：agent-host 地址 http://127.0.0.1:$port，共享密钥文件 $secret_file
下一步：在 Bailey 连接器的「主机接入」中生成接入密钥，然后由业务系统管理员在业务系统的 Bailey 设置里填写 Bailey 地址和这个密钥。
查看状态：sudo -u $service_user $node $prefix/current/service/agent-host.cjs status --config $config
EOF
