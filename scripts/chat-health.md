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
