# Project Agent Instructions

- 如果实现功能，优先参考 `assistant-ui`。
- If temporary verification and test scripts or code are generated during the task, please create them in the project's temp directory. If the directory does not exist, create it.Other temporary files or code that do not affect business operations during the task should also be placed in the temp directory.
- 前端显示时区都要跟随用户本地时区。
- 当用户要求执行 Git 提交并推送 GitHub 时，必须严格按以下流程串行执行（禁止并行执行任何会修改 Git 状态的命令，如 add/commit/amend/notes/push）：先确认提交范围（全部或部分）并 `git add`，再提交；提交信息和 note 若为多行必须使用真实换行，禁止在文本中写字面量 `\n`；若有 note，提交后执行 `git notes add`；随后必须用 `git show -s --format=%B HEAD` 与 `git notes show HEAD` 自检格式；最后先推送分支再推送 `refs/notes/commits`，如因 amend 导致提交哈希变化则使用 `--force-with-lease`；完成后向用户明确反馈提交哈希与推送结果。

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
