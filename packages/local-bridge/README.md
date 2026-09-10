# Agent Studio Local Bridge 0.2

Cloud Agent 通过任务绑定的 MCP 工具访问桌面执行端。桌面端主动连接 Relay，不监听入站端口。

`runtime/executor.cjs` 与 `runtime/transport.cjs` 同时供 Electron 和 `src/client.ts` 的 headless client 使用。客户端必须传入**本机选择并保存的 root id/path 映射**，从不信任 Relay 下发的目录范围。旧版 localhost `/execute` 演示端和云端提供 roots 的原型已移除。

支持文件读取、新建、覆盖、精确编辑、目录、重命名、删除，以及 Shell、进程输出/输入/取消。命令以本机账号执行，所选目录是默认 cwd，**不是 OS 沙箱**。浏览器和云端业务工具仍在云端。

调用使用稳定 request id；Relay 保存短期投递状态，执行端保存短期请求回执，断线重投不会自动重复执行。崩溃后的未知结果会明确返回 unknown，禁止盲目重试。无审批、文件版本历史、自动 worktree。

验证：`npm ci --ignore-scripts && npm run build && npm test`。集成验证使用隔离 PostgreSQL 的 `LOCAL_BRIDGE_TEST_DATABASE_URL` 运行 API `local-bridge.integration.test.ts`。
