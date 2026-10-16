# 我的电脑 · Agent Studio 桌面客户端 0.3.0

Portal 输入框选择「使用电脑文件夹」→「打开客户端并选择」→在系统窗口选择文件夹，自动返回当前任务。最近目录可直接复用；任务分类文件夹与本地执行目录分别保存。

客户端使用原有云端账号的一次性连接请求配对，通过出站 HTTPS 接收任务。普通用户无需配置设备 ID、端口、MCP 或 Tunnel。配对码是备用入口。

文件操作和 Shell 在本机执行。Shell 使用当前 OS 账号，目录仅是默认工作目录。无每次操作审批、文件修改历史或自动 worktree。关闭窗口后继续在菜单栏/托盘运行；「暂停连接」停止本机进程并保留连接配置。「退出连接」移除本机凭证。

自动更新：打包后的应用启动 15 秒后及每 6 小时读取发布目录的 `manifest.json`，版本更高时下载对应安装包并按清单校验大小与 SHA256，失败则丢弃、保持当前版本。仅在本机空闲（无运行中的命令且 5 分钟内无任务）时自动安装：Windows 静默运行 NSIS 安装包，macOS 在应用退出后替换 `.app` 并重新打开，Linux AppImage 替换文件；`.deb` 只提示手动下载。0.2.3 及更早版本没有更新器，需要手动安装一次 0.3.0。macOS 为 ad-hoc 签名，更新后系统可能再次询问钥匙串授权；若凭证无法解密，客户端会提示重新连接。

首次配对后自动开启「开机自动连接」（Linux 和开发模式除外），可在设置中关闭。结果回传失败时会写入本机 `outbox` 目录并自动重试，不会重新执行已完成的操作。

开发：`npm ci && npm start`，测试 `npm test`（更新器）。测试 Relay 可用 `AGENT_STUDIO_RELAY_URL`，返回页面可用 `AGENT_STUDIO_PORTAL_URL`，深链接不会覆盖 Relay 地址。

构建：`npm exec -- electron-builder --mac dmg zip --arm64 --x64 --publish never`，Windows `--win nsis zip --x64`，Linux `--linux AppImage deb --x64`。构建自动打包 `../local-bridge/runtime`，桌面与 headless 共用执行器。生产安装包发布到 `/usr/local/agent-studio/downloads/local-bridge`，独立于前端 dist。发布时同时上传 `manifest.json`（`version`、`sourceRevision`、`files[].name/bytes/sha256`），客户端自动更新依赖它；发布前核对 SHA256、包内版本与共享执行器。

macOS 签名/公证和 Windows 签名需要发行方证书；当前构建环境没有发行证书。源码构建成功不代表各 OS 的签名和原生运行验收通过。

应用、安装包、窗口品牌和系统托盘统一使用线上 Bailey favicon（renderer/brand.png 原图；build/ 为各平台图标导出）。Linux 无桌面环境优先使用 Portal 中的「Linux 命令行」，详见 ../local-bridge/README.md。
