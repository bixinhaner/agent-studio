# 接入新应用：让业务系统使用 Bailey 智能体

本文说明把一个新的业务系统（如网规网优助手）接到 Bailey 的全部步骤。业务系统旁边运行 agent-host，智能体既能在业务系统主机上分析原始文件（沙箱内），又能调用业务系统的接口读取结果、记录操作。网规网优助手是第一个按此方式接入的应用，可作参照。

```text
业务系统 ──127.0.0.1──> agent-host ──HTTPS（只有出站）──> Bailey
   ↑ 能力清单 / 执行操作                    连接器 → Agent Mode → 技能
```

业务系统主机只需能访问 Bailey 的 HTTPS 地址，不需要开放任何入站端口。

## 1. 业务系统：实现约定接口

在业务系统里实现两个只对本机开放的接口（`Authorization: Bearer <共享密钥>`）：

- `GET /api/ai/capabilities`：能力清单，列出智能体可调用的操作（`operationId`、方法、路径、风险等级、参数说明）。agent-host 由它生成能力手册并随对话发给 Bailey，清单变了手册自动换版，Bailey 侧无需改动。
- `POST /api/ai/operations`：执行一个操作，按请求里的 `user` 做权限判断；写操作需要用户在业务系统界面确认时返回 `CONFIRMATION_REQUIRED`。

再在业务系统里调用 agent-host（同一个密钥）：

- 管理员设置页：`GET /health` 显示状态，`PUT /connection { baseUrl, accessKey }` 连接，`DELETE /connection` 断开。只允许业务系统管理员操作。
- 用户分析页：`POST /sessions` 把会话目录交给智能体，`POST /chat` 进行对话（NDJSON 事件流），用完 `DELETE /sessions/<rootId>`。会话目录里放一个 `AGENTS.md`，说明目录结构与分析方法。

接口细节见 `packages/local-bridge/service/README-agent-host.md`。

## 2. Bailey：登记应用（技能、Agent Mode、连接器）

每个应用在仓库里有两份登记：

1. 技能：`agent-api/bundled-skills/<技能名>/`（`SKILL.md`，可带 `scripts/`、`agents/`）。告诉智能体这个业务领域怎么分析、何时用本机文件、何时调用业务接口。
2. 应用登记：`agent-api/connector-apps/<slug>/`
   - `app.json`：技能、技能包、Agent Mode、连接器的名称与配置，格式参照 `connector-apps/netopt-operations/app.json`。`connector.config.apiProfile.skillName` 指向上面的技能；`policy` 决定智能体可用的方法与风险等级。
   - `AGENTS.md`：Agent Mode 的工作区说明（这个渠道的总体规则）。

提交后，每次发布（管理端重启时）部署脚本自动执行 `npm run connector-apps:register -- --all`，按固定 ID 创建或更新技能、技能包、Agent Mode，技能校验和随之更新。不需要手写 SQL。

首次接入还需创建连接器并生成第一把接入密钥（在 Bailey 服务器的 `agent-api` 目录）：

```bash
npm run connector-apps:register -- <slug> --create-connector --host-key "<应用>-<主机>"
```

输出里的 `hostKey.key` 只显示一次。已有连接器不会被改动；以后生成密钥用管理界面即可。

## 3. 业务系统主机：安装 agent-host

```bash
curl -fsSL https://bailey.baicells.com/downloads/local-bridge/agent-host-install.sh | sudo bash -s -- \
  --name <实例名> --user <业务系统运行用户> --app-url http://127.0.0.1:<端口> --sessions-root <会话根目录> \
  [--secret-file <业务系统读取的共享密钥文件>] [--port 9191] [--read-only <运行库目录>] [--env KEY=VALUE]
```

安装脚本输出 agent-host 地址和共享密钥文件，把它们写进业务系统的配置。升级只需带 `--name` 重跑。

## 4. 连接

1. Bailey 管理员：集成中心 → 连接器 → 「主机接入」→ 生成接入密钥。
2. 业务系统管理员：在业务系统 Bailey 设置里填写 Bailey 地址与密钥，点「连接」。
3. 「主机接入 → 已连接的主机」出现这台主机且在线，业务系统设置页显示已连接。

## 5. 验收

- 业务系统设置页：已连接，显示连接器名称。
- 一次带会话目录的分析：回答引用了会话目录里的文件（智能体用 `local_computer` 工具），并能调用业务接口。
- 一次写操作：业务系统界面出现确认，确认后完成。
- Bailey 管理员在「已连接的主机」断开后，业务系统显示未连接；重新填写密钥可恢复。

## 安全要点

- 接入密钥只用于注册主机，可多把、可撤销；撤销不影响已连接的主机。主机的设备令牌在「已连接的主机」中断开即作废。
- 连接器会话挂载会话目录时必须带上由设备令牌派生的证明，只知道连接器和目录 ID 无法挂载。
- 会话目录默认只读，命令在 bubblewrap 中运行，默认无网络。业务操作的权限与确认始终由业务系统决定。
