# Project Agent Instructions

- 如果实现功能，优先参考 `assistant-ui`。
- If temporary verification and test scripts or code are generated during the task, please create them in the project's temp directory. If the directory does not exist, create it.Other temporary files or code that do not affect business operations during the task should also be placed in the temp directory.
- 前端显示时区都要跟随用户本地时区。
- 当用户要求执行 Git 提交并推送 GitHub 时，必须严格按以下流程串行执行（禁止并行执行任何会修改 Git 状态的命令，如 add/commit/amend/notes/push）：先确认提交范围（全部或部分）并 `git add`，再提交；提交信息和 note 若为多行必须使用真实换行，禁止在文本中写字面量 `\n`；若有 note，提交后执行 `git notes add`；随后必须用 `git show -s --format=%B HEAD` 与 `git notes show HEAD` 自检格式；最后先推送分支再推送 `refs/notes/commits`，如因 amend 导致提交哈希变化则使用 `--force-with-lease`；完成后向用户明确反馈提交哈希与推送结果。

## Usage 统计与计费约束

- 所有业务入口必须统一走 `UsageRecorder`，禁止直接调用 `UsageIngestionService`、`usageEventRepository.create()` 或自行计算 `estimated_cost` / `internal_cost`；底层 token 归一化、费用计算和 daily rollup 更新由 `UsageIngestionService` 内部完成。
- 新增 Codex 会话入口（包括站内聊天、钉钉、Zendesk、CREST、OpenAI-compatible API、其它外部渠道）必须调用 `usageRecorder.recordCodexUsage()`，只传业务归属、metadata、`RuntimeUsageSnapshot`、`codexThreadId` 和 `resultStatus`；原因是 Codex runtime 可能返回累计快照，需要公共服务按 thread 分段差分，否则会重复计费或漏计。
- 新增确实不是 Codex runtime 的计量入口时，必须调用 `usageRecorder.recordDirectUsage()`，并说明为什么不能提供 `RuntimeUsageSnapshot`。
- 修改 `live-runtime-session.ts` 的 token 提取逻辑会影响所有 Codex 渠道；修改前必须确认钉钉、Zendesk、CREST、站内聊天等入口仍能正确记录成功/失败 usage。
- 新增或修改 usage 入口必须补充测试，至少覆盖 token、cached input 边界、cost profile 计费、rollup 更新；如果是 Codex 入口，还必须覆盖累计快照差分和 thread 切换场景。

## 生产环境

- SSH 登录入口：`ssh agent-studio`。
- SSH 登录用户通常是 `azureuser`，该用户具备免密 `sudo` 权限。
- 生产代码目录：`/usr/local/agent-studio`。
- 生产仓库和运行进程归属用户：`agentstudio`。
- 生产仓库当前存在未跟踪目录 `backups/`，这是线上保留目录，除非用户明确要求，否则不要删除、移动或提交。
- 生产公网域名：`https://aiagent.indonesiacentral.cloudapp.azure.com`。
- 健康检查：
  - 服务器本机：`curl -fsS http://127.0.0.1:8787/healthz`
  - 公网：`curl -fsS https://aiagent.indonesiacentral.cloudapp.azure.com/healthz`

## 生产部署流程

- 本地必须先完成提交并推送 GitHub，再部署生产。
- 本地推送 GitHub 推荐命令：
  `GIT_SSH_COMMAND='ssh -p 443 -o Hostname=ssh.github.com' git push origin main`
- 生产部署只执行脚本即可，不要拆成手工 `git pull`、构建、PM2、Caddy 多步操作：
  `ssh agent-studio 'cd /usr/local/agent-studio && bash scripts/deploy-agent-studio.sh'`
- 部署脚本会执行后端依赖安装、Prisma client 生成、数据库迁移、后端构建、前端依赖安装、前端构建、PM2 重启、Caddy 配置校验和 reload。
- 部署后检查：
  - `curl -fsS http://127.0.0.1:8787/healthz`
  - `curl -fsS https://aiagent.indonesiacentral.cloudapp.azure.com/healthz`

## 生产排查约定

- 需要读取数据库时，优先通过生产 `agent-api/.env` 中的 `DATABASE_URL`，不要把密钥内容输出到对话中。
- 可使用如下模式进入数据库查询，注意不要打印完整连接串：
  `cd /usr/local/agent-studio/agent-api && DATABASE_URL=$(grep -m1 "^DATABASE_URL=" .env | sed "s/^DATABASE_URL=//; s/^\"//; s/\"$//") && DATABASE_URL=$(printf "%s" "$DATABASE_URL" | sed "s/[?].*$//") && psql "$DATABASE_URL"`
- 生产服务由 PM2 管理，应用名为 `agent-studio-api`。
- Caddy 配置由部署脚本渲染和 reload，除非用户明确要求，不要手动改 `/etc/caddy/Caddyfile`。


## Git 与提交规则

### Commit 格式

```
<type>(<scope>): <中文一句话概述>

例:
  fix(scope): 修复用户启用后看不到负责客户/商机/联系人
  feat(boq): 增加价格管理 BOQ 可销售清单
  hotfix(login): 修复生产登录 CORS 配置遗漏
  ux(account): 重组客户详情页 SAP 信息区
  docs(contributing): 补充 GitFlow 分支策略
```

`type` 可选：`feat` / `fix` / `hotfix` / `ux` / `ops` / `data` / `docs` / `chore` / `perm` / `test`

提交信息强制规则：
- 标题描述必须使用中文；`type`、`scope`、文件路径、命令、配置键等约定字段可保留英文
- 每次 commit 都必须写 body，并按序号描述修改功能和内容
- 序号顺序按影响面组织：业务/用户可见变化 → API/数据/权限 → 前端/UI → 运维/文档/测试 → 验证结果
- 每条序号写清“为什么”和“对用户/生产的影响”，避免只写“修改代码”

Commit body 模板：

```text
1. <功能或模块>：<具体改动、为什么这样改、对用户或生产的影响>
2. <功能或模块>：<具体改动、为什么这样改、对用户或生产的影响>
3. 验证：<执行的检查、测试、部署或未执行原因>
```
