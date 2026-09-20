# Codex 用量校正

生产计量优先读取本轮 rollout 的 `token_usage_record`，按 thread/turn/response 去重；旧日志只有 `token_count` 时，只接受边界完整且无交错歧义的运行轮次。业务请求中的多次自动重试合并计量。`usage_events.id` 使用稳定的轮次键，并在事务锁内检查重复上报；不使用累计计数下降来推断新增用量。

日志尚未完整落盘时保留通知估算并标记 `_usageAccounting.status=pending_reconciliation`，不能将其视为准确值。缺失业务请求记录或原始日志、多个业务记录共用一个轮次、交错旧日志等情况不会自动猜测回填。进程被强制终止且未持久化业务用量记录的情况仍需从业务运行记录单独恢复。

## 回填

在 agent-api 目录，以运行用户执行。时间参数显式使用 UTC；报表预演按北京时间展示，日汇总沿用现有 UTC 存储规则。

```sh
node --env-file=.env dist/ops/reconcile-codex-usage.js \
  --from 2026-06-10T16:00:00Z --to <固定截止时间> \
  --homes temp/codex-homes --output temp/usage-reconciliation/preview
```

先检查 `summary.json`、`blocked.json`、`plan.json`。仅有舍入末位差异不触发修改。缺少历史价格快照时跳过；回填使用每条记录原有的价格，不更新价格档。

执行前，备份 usage_events、usage_daily_rollups、cost_profiles、运行代码及计划涉及的 rollout 文件，将原始计划放入仅运行用户可访问的 backups 子目录。不要重新运行已停用的累计高水位 `--apply` 脚本。

```sh
node --env-file=.env dist/ops/reconcile-codex-usage.js \
  --apply-plan <备份目录>/plan.json --output temp/usage-reconciliation/apply
```

计划带稳定摘要；执行前检查全量原值，每批事务内再次锁行并比较。每批 50 条，只更新 token、费用及审计 metadata，保留请求数量、业务身份、时间和结果状态。执行后重建受影响组织/日期的汇总。中途失败可用同一计划续跑，已完成项不重复修改。

```sh
node --env-file=.env dist/ops/reconcile-codex-usage.js \
  --rollback-plan <备份目录>/plan.json --output temp/usage-reconciliation/rollback
```

回滚也校验当前值，拒绝覆盖后续修改。验收必须比较修改后明细、计划、日汇总；重复执行应全部为 unchanged，并检查价格档指纹、新生产请求的 `_usageAccounting`、API/chat 健康状态。无法恢复的记录需保留并报告。
