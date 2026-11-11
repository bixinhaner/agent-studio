# Agent Host：让业务系统使用 Agent Studio 智能体

业务系统旁边运行的一个进程，把 Agent Studio 已有的两条通道合成一个本机接口，业务系统两条都不用自己实现：

```text
业务系统 ──127.0.0.1──> agent-host ──HTTPS（只有出站）──> Agent Studio
                           │  Action Connector：对话、智能体调用业务操作
                           └─ Local Bridge 服务设备：智能体在本机会话目录里读文件、跑脚本（沙箱内）
```

数据在哪里就在哪里算，只有结论经过网络。智能体得到的工具与 Portal「使用电脑文件夹」完全相同（`local_computer`），Agent Studio 不需要为业务系统新增工具。

## 业务系统要做的

提供两个只对本机开放的接口（用共享密钥校验 `Authorization: Bearer <secret>`）：

| 接口 | 作用 |
| --- | --- |
| `GET <capabilitiesPath>` | 返回能力清单：`{ sourceName, commonOperations, categories, operations[] }`。这是唯一的操作登记表，agent-host 由它自动生成并发布带摘要校验的能力手册，登记表变了手册自动换版 |
| `POST <operationsPath>` | 执行一个操作：`{ operationId, risk, pathParams, query, body, user, conversationId, runId, toolCallId, rootId }` → `{ status: "ok", output }` 或 `{ status: "error", error: { code, message, retryable } }`。权限、确认、审计都由业务系统按 `user` 决定 |

调用 agent-host 的三个接口（同一个密钥）：

| 接口 | 作用 |
| --- | --- |
| `POST /sessions` `{ path, label, writable }` | 把 `sessionsRoot` 下的一个目录交给智能体，返回 `rootId`。目录默认只读，只有 `writable` 列出的子目录可写；目录里的 `AGENTS.md` 会交给智能体作为说明 |
| `POST /chat` `{ message, conversationId, user, rootId, context, locale }` | 一轮对话，返回 NDJSON 事件流（`delta`、`process`、`host_tool`、`done`、`error`…）。业务操作请求在 agent-host 内执行并回传，调用方只需读事件 |
| `DELETE /sessions/<rootId>` | 收回目录 |

`GET /health` 返回配对、连接、手册和沙箱状态。

## 隔离

- 文件工具：会话目录内只读，`writable` 子目录除外。
- 命令：在 bubblewrap 中运行，只看得到系统运行时（只读）、会话目录和私有 `/tmp`；默认无网络；环境变量被清空；可设 CPU 时间、文件大小等上限。
- 设备归属连接器：只有该连接器的会话能绑定它的目录，Portal 用户的任务不能；反之用户的电脑也不会被连接器会话使用。
- 服务凭证只在配对时从环境变量读取一次，不落盘；之后使用设备自己的令牌。

## 部署

```bash
AGENT_STUDIO_SERVICE_TOKEN=... node service/agent-host.cjs pair --config /path/agent-host.json   # 一次
node service/agent-host.cjs run --config /path/agent-host.json                                    # 常驻（systemd）
```

配置示例：

```json
{
  "instanceId": "netopt-prod-1",
  "instanceName": "网规网优助手",
  "sourceSystem": "baicells-network-optimization",
  "studio": { "baseUrl": "https://<agent-studio>", "connectorId": "<provision 返回的 connectorId>" },
  "listen": { "host": "127.0.0.1", "port": 9191 },
  "secretFile": "/path/shared.secret",
  "stateDir": "/path/state",
  "sessionsRoot": "/path/sessions",
  "app": { "baseUrl": "http://127.0.0.1:9090", "capabilitiesPath": "/api/ai/capabilities", "operationsPath": "/api/ai/operations" },
  "sandbox": { "mode": "bwrap", "readOnlyPaths": [], "env": {}, "network": false, "limits": { "cpuSeconds": 900, "fileSizeMb": 2048 } }
}
```

Agent Studio 侧：创建连接器（`apiProfile.skillName` 指向该系统的技能，默认的 `/api/v1/` 目录与手册路径即可），Agent Mode 启用该技能。对话时在 `context.localComputer.rootId` 带上目录，Studio 会为这轮会话挂上 `local_computer` 工具。

验证：`node --test tests/service.test.cjs`。
