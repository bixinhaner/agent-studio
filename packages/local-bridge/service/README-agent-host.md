# Agent Host：让业务系统使用 Bailey 智能体

agent-host 是装在业务系统主机上的一个独立进程，与具体业务无关，任何业务系统都可以复用。它把 Bailey 已有的两条通道合成一个本机接口，业务系统两条都不用自己实现：

```text
业务系统 ──127.0.0.1──> agent-host ──HTTPS（只有出站）──> Bailey
                           │  Action Connector：对话、智能体调用业务操作
                           └─ Local Bridge 服务设备：智能体在本机会话目录里读文件、跑脚本（沙箱内）
```

数据在哪里就在哪里算，只有结论经过网络。智能体得到的工具与 Portal「使用电脑文件夹」相同（`local_computer`），Bailey 不需要为业务系统新增工具。

分工：

| 谁 | 做什么 | 次数 |
| --- | --- | --- |
| 服务器运维 | 运行安装脚本，装好 agent-host（只涉及本机：业务系统地址、会话目录、沙箱） | 一次；升级重跑 |
| Bailey 管理员 | 在连接器「主机接入」生成接入密钥 | 每台主机一次 |
| 业务系统管理员 | 在业务系统的 Bailey 设置里填写 Bailey 地址和接入密钥，点「连接」 | 一次；可随时断开、换密钥 |

## 安装与升级

```bash
curl -fsSL https://bailey.baicells.com/downloads/local-bridge/agent-host-install.sh | sudo bash -s -- \
  --name <实例名> --user <业务系统运行用户> --app-url http://127.0.0.1:<业务端口> --sessions-root <会话根目录>
```

- 支持 glibc 2.28+ 的 Linux x64/ARM64（systemd）。安装包自带 Node.js，下载后按 SHA256 校验。
- 安装位置：程序 `/opt/bailey-agent-host/current`，配置 `/etc/bailey-agent-host/<实例名>.json`，状态 `/var/lib/bailey-agent-host/<实例名>`（0700），服务 `bailey-agent-host@<实例名>.service`。一台主机可装多个实例，各自一个端口。
- 共享密钥：业务系统与 agent-host 之间的本机密钥。默认生成在 `/etc/bailey-agent-host/<实例名>.secret`（root:<用户组> 0640）；`--secret-file` 可指定业务系统已有的文件。
- 沙箱：默认 bubblewrap（需安装 `bubblewrap`）。智能体脚本需要的额外运行库用 `--read-only <目录>` 和 `--env KEY=VALUE` 提供。
- 升级：`… | sudo bash -s -- --name <实例名>`，保留配置与 Bailey 连接。改配置：带上要改的选项重跑。
- 离线：`--package bailey-agent-host-linux-x64.tar.gz`。所有选项见 `agent-host-install.sh --help`。

安装不涉及 Bailey 地址和任何 Bailey 凭证。

## 连接 Bailey

1. Bailey 管理员：集成中心 → 该连接器 → 「主机接入」→ 生成接入密钥（只显示一次）。也可在 Bailey 服务器上用 `npm run connector-apps:register -- <slug> --host-key "<用途>"`。
2. 业务系统管理员：在业务系统的 Bailey 设置里填写 Bailey 地址（如 `https://bailey.baicells.com`）和密钥。业务系统把它们交给 agent-host：`PUT /connection { baseUrl, accessKey }`。
3. agent-host 用密钥向 Bailey 注册为连接器的服务设备，换得设备令牌，之后只用设备令牌；密钥不保存。连接后在「主机接入 → 已连接的主机」可看到这台主机，管理员可随时断开。

撤销密钥只阻止它再注册新主机，已连接的主机不受影响；要断开主机，在「已连接的主机」中断开，或业务系统里点「断开」（`DELETE /connection`）。

没有业务系统界面时可用命令行（在主机上，对运行中的服务生效）：

```bash
sudo -u <用户> BAILEY_ACCESS_KEY=bly_... /opt/bailey-agent-host/current/bin/node /opt/bailey-agent-host/current/service/agent-host.cjs connect --url https://bailey.baicells.com --config /etc/bailey-agent-host/<实例名>.json
```

`status`、`disconnect` 用法相同。

## 业务系统要做的

提供两个只对本机开放的接口（用共享密钥校验 `Authorization: Bearer <secret>`）：

| 接口 | 作用 |
| --- | --- |
| `GET <capabilitiesPath>`（默认 `/api/ai/capabilities`） | 返回能力清单：`{ sourceName, commonOperations, categories, operations[] }`。这是唯一的操作登记表，agent-host 由它自动生成并发布带摘要校验的能力手册，登记表变了手册自动换版 |
| `POST <operationsPath>`（默认 `/api/ai/operations`） | 执行一个操作：`{ operationId, risk, pathParams, query, body, user, conversationId, runId, toolCallId, rootId }` → `{ status: "ok", output }` 或 `{ status: "error", error: { code, message, retryable } }`。权限、确认、审计都由业务系统按 `user` 决定 |

调用 agent-host 的接口（同一个密钥）：

| 接口 | 作用 |
| --- | --- |
| `GET /health` | 版本、连接状态、`bailey: { baseUrl, connectorId, connectorName }`（未连接为 `null`）、手册与沙箱状态 |
| `PUT /connection` `{ baseUrl, accessKey }` | 连接 Bailey（仅业务系统管理员可触发）。失败返回 400/401/502 和中文 `detail` |
| `DELETE /connection` | 断开 Bailey，设备令牌在 Bailey 侧作废 |
| `POST /sessions` `{ path, label, writable }` | 把 `sessionsRoot` 下的一个目录交给智能体，返回 `rootId`。目录默认只读，只有 `writable` 列出的子目录可写；目录里的 `AGENTS.md` 会交给智能体作为说明 |
| `POST /chat` `{ message, conversationId, user, rootId, context, locale }` | 一轮对话，返回 NDJSON 事件流（`delta`、`process`、`host_tool`、`done`、`error`…）。业务操作请求在 agent-host 内执行并回传，调用方只需读事件。未连接时返回 409 |
| `DELETE /sessions/<rootId>` | 收回目录 |

## 隔离

- 文件工具：会话目录内只读，`writable` 子目录除外。
- 命令：在 bubblewrap 中运行，只看得到系统运行时（只读）、会话目录和私有 `/tmp`；默认无网络；环境变量被清空；可设 CPU 时间、文件大小等上限。
- 设备归属连接器：只有该连接器的会话能绑定它的目录，而且绑定时必须带上由设备令牌派生的 `proof`，只知道连接器和目录 ID 不能挂载别人的目录。Portal 用户的任务不能使用它；反之用户的电脑也不会被连接器会话使用。
- 接入密钥只用于注册，不落盘；设备令牌保存在状态目录（0600），可在 Bailey 侧随时作废。

配置文件（安装脚本生成，一般不需手改）：

```json
{
  "instanceId": "netopt-host-1",
  "instanceName": "网规网优助手",
  "sourceSystem": "netopt",
  "listen": { "host": "127.0.0.1", "port": 9191 },
  "secretFile": "/etc/bailey-agent-host/netopt.secret",
  "stateDir": "/var/lib/bailey-agent-host/netopt",
  "sessionsRoot": "/data/ai-sessions",
  "app": { "baseUrl": "http://127.0.0.1:9090", "capabilitiesPath": "/api/ai/capabilities", "operationsPath": "/api/ai/operations" },
  "sandbox": { "mode": "bwrap", "readOnlyPaths": [], "env": {}, "network": false, "limits": { "cpuSeconds": 900, "fileSizeMb": 2048 } }
}
```

验证：`node --test tests/service.test.cjs`。构建安装包：`npm run build:agent-host`。
