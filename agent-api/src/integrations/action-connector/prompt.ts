import type { ActionConnectorConfig } from "../center/action-connector-adapter.js";
import type { ActionConnectorChatRequest } from "./runtime.js";

export type ActionConnectorRuntimePromptInput = {
  config: ActionConnectorConfig;
  request: ActionConnectorChatRequest;
  conversationId: string;
  runId: string;
  cliPath: string;
};

export function buildActionConnectorRuntimePrompt(input: ActionConnectorRuntimePromptInput): string {
  const approvedAction = input.request.approvedAction
    ? JSON.stringify(input.request.approvedAction, null, 2)
    : "";
  const context = JSON.stringify(input.request.context ?? {}, null, 2);
  const policy = JSON.stringify(input.config.policy, null, 2);
  return [
    "这条消息来自一个外部业务系统内嵌 Agent 助手。",
    "你负责推理、选择 REST API、读取信息和形成回答；业务数据查询必须通过 action-connector-cli 的通用 REST 工具完成。",
    "不要要求用户手动复制业务系统数据。不要直连业务系统数据库。不要编造 API 结果。",
    `业务系统显示名：${input.config.displayName}`,
    `对话 ID：${input.conversationId}`,
    `运行 ID：${input.runId}`,
    `用户语言：${input.request.locale}`,
    `用户时区：${input.request.timezone}`,
    `当前请求模式：${input.request.mode}`,
    `Connector policy：\n${policy}`,
    approvedAction ? `用户已批准的动作：\n${approvedAction}` : undefined,
    `当前页面上下文：\n${context}`,
    "",
    "可用 CLI：",
    `- node ${JSON.stringify(input.cliPath)} identity`,
    `- node ${JSON.stringify(input.cliPath)} catalog "query text"`,
    `- node ${JSON.stringify(input.cliPath)} describe operationId`,
    `- node ${JSON.stringify(input.cliPath)} request GET /api/v1/example '{"operationId":"example.list","query":{"key":"value"},"reason":"why this API is needed"}'`,
    "",
    "执行规则：",
    "- 先用 catalog/describe 了解可用 REST API 和参数，再调用 request。",
    "- 只能请求 /api/v1 下 catalog 中存在的 API；不要猜测未确认的路径。",
    "- 默认优先使用 GET 读取真实数据；写操作只有在 connector policy 和外部系统确认允许时才能请求。",
    "- API 返回失败时，根据错误调整参数或说明无法完成，不要绕过策略。",
    "- 最终回答必须基于 CLI 返回的真实结果，用用户语言简洁说明关键结论。",
    "",
    "用户问题：",
    input.request.message
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
