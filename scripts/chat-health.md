# 聊天服务健康检查

PM2 的 online 只代表进程存活。聊天主线程被同步计算阻塞时，进程仍在线，但无法处理请求。

- 管理服务：`http://127.0.0.1:8787/healthz`
- 聊天服务：`http://127.0.0.1:8791/healthz`
- 公网聊天服务：`https://bailey.baicells.com/healthz/chat`（其他已配置 Portal 域名同样支持）

公网 `/healthz` 保持管理服务原有含义，不能代替聊天检查。`/healthz/chat` 直接代理聊天进程的 `/healthz`，连接超时 2 秒，响应头超时 3 秒，不会回退到前端 HTML 或管理服务。

执行以下命令分别验证服务；任一请求超时、非成功 HTTP 状态、非 JSON 或 `ok` 不为 true 时退出码为 1：

```sh
node scripts/check-api-health.mjs \
  --admin-url http://127.0.0.1:8787/healthz \
  --chat-url http://127.0.0.1:8791/healthz \
  --public-chat-url https://bailey.baicells.com/healthz/chat
```

API 部署完成前会分别检查本机管理和聊天接口。API 单独部署如需更新代理路由，使用 `--refresh-caddy`。外部监控应独立监测 `/healthz/chat`，不能只检查 `/healthz`。检查脚本本身不自动重启服务，也不证明模型供应商可用或真实会话已完成。

若聊天服务阻塞，重启前保留日志、PID/子进程信息及 CPU 采样。停止聊天服务后只清理已核实属于旧聊天进程的残留运行时，避免旧进程继续持有线程写锁；不要影响管理服务或其他工作负载。正常修复部署仍使用部署脚本的 drain 流程。

## 自动巡检与重启（agent-studio-chat-watchdog）

部署脚本安装 `agent-studio-chat-watchdog.timer`，每分钟以应用用户检查 `releases/state/chat.slot` 指向的当前聊天槽位的 `/internal/ready`（与 Caddy 切流用同一个接口）：

- 连续 3 次失败：通过管理服务 `POST /internal/ops/service-health-alert`（仅本机）给超级管理员发钉钉工作通知，然后 `pm2 restart` 该槽位（PM2 已没有该应用时按 ecosystem 文件启动），最多等 180 秒就绪，并再发一条"已自动重启并恢复"或"重启失败"。
- 重启失败时每 15 分钟重试并提醒一次；服务恢复响应后发"已恢复"，并给出影响时长。
- 部署持有部署锁期间跳过检查，不和部署抢着重启。管理服务不可用时告警只写 journal：`journalctl -u agent-studio-chat-watchdog`。
- 演练（不重启、告警标注"演练"）：`sudo -u agentstudio env HOME=/home/agentstudio CHAT_WATCHDOG_STATE_DIR=<state> /usr/local/sbin/agent-studio-chat-watchdog --slot <空闲槽位> --no-restart`；只测钉钉通道：加 `--test-alert`。

退役槽位以退出码 75 结束，PM2 的 `stop_exit_codes` 只有 75。崩溃、V8 内存溢出中止（PM2 可能记为 code 0）等其他退出都会被 PM2 立即拉起，巡检是最后一道保护。文件结构化预览（表格、Draw.io、整文件文本解码）在独立子进程中解析，堆上限 512 MB、超时 30 秒，解析失败只影响该次预览。
