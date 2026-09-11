# Agent Studio Local Bridge 0.2

Cloud Agent 通过任务绑定的 MCP 工具访问桌面执行端。桌面端主动连接 Relay，不监听入站端口。

`runtime/executor.cjs` 与 `runtime/transport.cjs` 同时供 Electron 和 `src/client.ts` 的 headless client 使用。客户端必须传入**本机选择并保存的 root id/path 映射**，从不信任 Relay 下发的目录范围。旧版 localhost `/execute` 演示端和云端提供 roots 的原型已移除。

支持文件读取、新建、覆盖、精确编辑、目录、重命名、删除，以及 Shell、进程输出/输入/取消。命令以本机账号执行，所选目录是默认 cwd，**不是 OS 沙箱**。浏览器和云端业务工具仍在云端。

调用使用稳定 request id；Relay 保存短期投递状态，执行端保存短期请求回执，断线重投不会自动重复执行。崩溃后的未知结果会明确返回 unknown，禁止盲目重试。无审批、文件版本历史、自动 worktree。

验证：`npm ci --ignore-scripts && npm run build && npm test`。集成验证使用隔离 PostgreSQL 的 `LOCAL_BRIDGE_TEST_DATABASE_URL` 运行 API `local-bridge.integration.test.ts`。

## Linux 命令行

在 Portal「使用电脑文件夹 → Linux 命令行」复制连接命令，进入目标目录后粘贴执行。首次会自动下载带 Node.js 的独立包，无需 sudo、npm、GUI 或开放端口。支持 glibc 2.28+ 的 Linux x64/ARM64（如 Ubuntu 20.04+、Debian 10+）；Alpine 暂不支持。需要 bash、curl、tar、sha256sum。

之后在目标目录运行 `~/.local/bin/bailey-connect` 复用账号连接，在 Portal 选择该目录；从 Portal 复制的新配对命令会自动选中当前目录。保持终端打开，Ctrl+C 停止连接及其启动的 Shell 进程。一个账号站点同时只运行一个连接进程，避免重复领取任务；最近选过的目录仍可在 Portal 复用。

可用 `--code` 重新配对、`--server` 指定 HTTPS 站点。凭证保存在当前用户的 XDG state 目录（目录 0700、文件 0600）；运行包在 XDG data 目录，启动器在 `~/.local/bin/bailey-connect`。原有桌面客户端无需更改。

构建 `npm run build:cli`：校验固定 Node.js 官方归档摘要，打包 x64/ARM64 执行器与启动器。发布 `dist-cli/` 中的两个 tar.gz、`connect.sh` 与 `cli-SHA256SUMS` 到独立下载目录。安装脚本对下载包做 SHA256 校验并保留原工作目录。
