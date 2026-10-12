# 云端任务资源隔离

生产通过 `ensure-workload-isolation.sh`（由标准部署脚本调用）安装独立
`agent-studio-workloads.service`。API/PM2 不在这个控制组内。

- 每个新 Codex 会话独立 app-server，8 GiB `memory.max`，`memory.high=max`，不使用 swap。
- `memory.oom.group=1`：超过内存上限终止整个任务运行环境，包括 setsid/双重 fork 的子进程。
- 每任务最多 2 核、512 个进程/线程；所有任务合计最多 20 GiB、3 核、4096 个进程/线程。
- 20 GiB 总上限也是硬保护：多个任务合计超限时可能有任务被终止，但不会把 API 放入同一个回收组。
- 文件和会话数据不删除，后续消息可恢复持久化 Codex thread。
- 生产 `AGENT_STUDIO_WORKLOAD_ISOLATION=required`，缺失 launcher/broker/控制组时拒绝启动。
  生产固定 app-server 驱动；SDK 路径不能悄悄绕过隔离。
- supervisor 跟踪 leader/owner 的 PID 及启动时间；退出或 PID 重用后杀死残留子进程并回收组。
- 部署时将旧 app-server 与残留工作区进程树接管进受限组。旧 app-server 若共享了多个会话，
  过渡期这些会话共用一组；Linux 已分配的旧内存不会因迁组重新计费，限制对新分配生效。
  蓝绿排空后，新运行环境逐会话、从第一次分配起完整执行 8 GiB 限制。

## 权限边界

Python launcher 保持原用户、环境和 stdin/stdout，仅在 exec 前请求 root broker 将自身移入组。
root broker 只接受固定格式的 attach/release 操作，检查 UID、launcher 命令及 UUID，
不以 root 执行传入命令。控制组配置、broker 和 sudoers 均归 root 所有。
这解决正常任务的资源失控，并不是同一 Unix UID 下的恶意代码安全沙箱；同 UID 的任务间
信号/文件权限隔离属于另一层控制。

## 验证

本地：`python3 -B scripts/test-workload-guard.py`；后端运行 workload-isolation 和
codex-app-server-runtime 测试及构建。

Linux 生产安装后，先确认剩余内存充足、任务组使用量低于 6 GiB，再运行：

```
sudo -u agentstudio python3 scripts/verify-workload-isolation.py
```

探针在自己的两个控制组中运行：一个健康的邻居，一个包含 setsid 子进程的超限任务，
真实分配超过 8 GiB 验证组 OOM；同时连续检查管理、公网及聊天就绪接口。
结束时清理两个验证组，不发送用户消息或修改数据库。不要在负载已接近总限额时执行。

监测 `/sys/fs/cgroup/system.slice/agent-studio-workloads.service/` 的 `memory.current`、
`memory.events` 和各 `job-*` 的限制；不得只用 PM2 online 判定隔离生效。

## 运维

不要在有任务运行时重启 workload supervisor；systemd 的组清理会终止其中的所有任务。
部署重复执行安装时不会重启它。升级 supervisor 自身实现需要安排任务清空后的服务重启。
回滚 API 时保留隔离服务，避免杀死仍在排空的会话。现有 PM2 主机保护仍保留，作为额外保险。

资源额度调整通过标准部署脚本热更新，即使没有后端代码变更也会同步正在运行的控制组；不重启任务或 API。任务准入排队尚未实现，20 GiB 总上限当前仍为硬保护。
