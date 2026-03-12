# Zendesk 自动答复集成设计

## 目标

将 `agent-studio` 作为 Zendesk Support 的自动答复机器人接入，满足以下要求：

- 与现有聊天线程系统解耦，不复用 `thread.external_id`
- 后端独立持久化 Zendesk 设置、处理状态和运行日志
- 前端独立提供配置、验证、手动测试和 setup 指南
- 使用 Zendesk Trigger + Active Webhook 作为事件入口
- 使用 Zendesk Tickets API 作为评论回写出口

## 模块边界

### 后端

独立目录：`agent-api/src/integrations/zendesk/`

- `settings-store.ts`
  - 保存 Zendesk 配置
  - 数据文件：`temp/zendesk/settings.json`
- `binding-store.ts`
  - 保存 `ticket_id -> 最近已处理 requester comment id`
  - 用于幂等和去重
  - 数据文件：`temp/zendesk/bindings.json`
- `run-store.ts`
  - 保存最近运行日志
  - 数据文件：`temp/zendesk/runs.json`
- `client.ts`
  - 封装 Zendesk REST API
  - 包含 `getMe`、`getTicketContext`、`addTicketComment`
- `prompt.ts`
  - 组装 ticket 上下文 prompt
  - 解析 agent JSON 决策
- `service.ts`
  - 编排完整流程：签名校验、读取 ticket、调用 agent、回写评论、更新绑定和日志
- `router.ts`
  - 对前端暴露管理 API
  - 对 Zendesk 暴露 webhook 入口处理器

### 前端

独立目录：`agent-ui/src/features/zendesk/`

- `ZendeskIntegrationPanel.tsx`
  - 配置 UI
  - setup 指南
  - 运行日志
  - 手动执行 ticket
- `api.ts`
  - 调用 `/api/integrations/zendesk/*`
- `types.ts`
  - 前端专用类型
- `zendesk.css`
  - 模块私有样式

`App.tsx` 只负责挂载 `<ZendeskIntegrationPanel />`，不持有 Zendesk feature 的业务状态。

## 数据流

### 自动处理

1. Zendesk Trigger 触发 Active Webhook
2. `POST /api/integrations/zendesk/webhook`
3. 后端校验 `X-Zendesk-Webhook-Signature` 和 `X-Zendesk-Webhook-Signature-Timestamp`
4. 根据 payload 中的 `ticket_id` 获取 ticket 与最新评论
5. 找到最新一条 requester 的公开评论
6. 检查 `bindings.json`
   - 已处理过则跳过
   - 未处理则继续
7. 组装 prompt，调用 Codex runtime
8. 解析 agent 返回的 JSON 决策
9. 根据配置决定：
   - public reply
   - internal note
   - skip / handoff
10. 通过 Zendesk Tickets API 回写
11. 更新 binding 和 run log

### 手动测试

1. 前端输入 ticket ID
2. 调用 `POST /api/integrations/zendesk/run`
3. 后端走同一套 `processTicket` 逻辑
4. 前端刷新最近运行记录

## API

### `GET /api/integrations/zendesk/overview`

返回：

- 当前配置（已脱敏）
- readiness 状态
- 缺失字段
- webhook setup 示例
- 最近运行日志

### `PUT /api/integrations/zendesk/settings`

保存 Zendesk 集成配置。

注意：

- `zendesk_api_token` 与 `webhook_signing_secret` 留空时保持原值
- 其他字段按当前表单值覆盖

### `POST /api/integrations/zendesk/validate`

调用 Zendesk `users/me` 验证凭证，并写入最近验证结果。

### `POST /api/integrations/zendesk/run`

手动触发单个 ticket 处理。

请求体：

```json
{
  "ticket_id": "12345"
}
```

### `POST /api/integrations/zendesk/webhook`

Zendesk Active Webhook 入口。

最小 payload：

```json
{
  "ticket_id": "{{ticket.id}}"
}
```

## 幂等策略

不依赖 trigger 本身的唯一事件 ID，而是读取工单最新 requester comment：

- 若 `latest requester comment id <= lastProcessedRequesterCommentId`
  - 认为是重复事件
  - 直接跳过

优点：

- 不依赖 trigger payload 的复杂字段
- 能防止 bot 自己回写 comment 后再次触发回环

## Agent 输出约定

集成层要求 agent 输出 JSON：

```json
{
  "decision": "public_reply",
  "body": "给客户的公开回复",
  "internalNote": "给内部客服的备注",
  "confidence": 0.92,
  "reasons": ["reason 1"]
}
```

如果模型未按 JSON 输出，系统自动降级为 internal note。

## 回写策略

- `responseMode = public_reply`
  - 模型给出 `public_reply` 时公开回复
  - 否则按 `fallbackMode` 决定写 internal note 或 skip
- `responseMode = internal_note`
  - 永远只写 internal note
  - 适合人工审核模式

`autoStatus` 由配置控制，默认推荐 `pending`。

## Zendesk 侧建议配置

### Trigger 1: New Ticket

- 条件：`Ticket is Created`
- Action：`Notify active webhook`
- Payload：最少包含 `ticket_id`

### Trigger 2: Requester Reply

- 条件：`Ticket is Updated`
- 附加条件：`Current user is end-user`
- Action：`Notify active webhook`

## 安全

- webhook 不走 `AGENT_API_TOKEN`
- webhook 仅靠 Zendesk 签名密钥鉴权
- 管理 API 仍走现有 `Authorization: Bearer ...`
- 凭证仅保存在本地 `temp/zendesk/settings.json`
- 前端读取到的是脱敏配置

## 已知限制

- 当前使用 requester 作为“客户消息”识别依据；CC/side conversation 未单独建模
- 当前日志只保留最近 200 条
- 当前不自动创建/同步 Zendesk trigger，需要在 Zendesk 管理台手动配置
- 当前不把 Zendesk ticket 映射到主聊天线程系统，目的是保持独立性
