# Agent Studio Local Bridge

本包是 Portal 延伸到用户电脑的执行端最小实现。启动前设置 `AGENT_STUDIO_BRIDGE_TOKEN`，服务只监听 `127.0.0.1`，接受带 Bearer token 的 `POST /execute` 请求，支持 `read/list/write`。请求必须携带绑定的 `userId/deviceId/sessionId` 与授权 roots；路径经过 realpath 校验，写入限制 10MB，并支持 mtime 乐观锁。云端 Relay 应通过主动出站连接转发请求，生产环境不要暴露此端口。
