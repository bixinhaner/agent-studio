import { randomUUID } from "node:crypto";
import { z } from "zod";

import { actionConnectorConfigSchema, type ActionConnectorConfig } from "../center/action-connector-adapter.js";
import { ActionConnectorClient, type ActionDescriptor, type ConnectorActionRequest } from "./client.js";
import type { IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";

export const actionConnectorChatRequestSchema = z.object({
  message: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).optional(),
  locale: z.string().trim().min(1).default("en-US"),
  timezone: z.string().trim().min(1).default("UTC"),
  context: z.record(z.string(), z.unknown()).default({})
});

export type ActionConnectorChatRequest = z.infer<typeof actionConnectorChatRequestSchema>;

export type AgentStreamEvent =
  | { type: "start"; runId: string; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "tool_call"; callId: string; toolName: string; title: string; input: unknown }
  | { type: "action_preview"; callId: string; title: string; summary: string; risk: "read" | "low" | "high"; preview: unknown }
  | { type: "tool_result"; callId: string; status: "ok" | "error"; output?: unknown; error?: { code: string; message: string; retryable?: boolean } }
  | { type: "done" }
  | { type: "error"; error: { code: string; message: string; retryable?: boolean } };

type IntegrationConfigRow = {
  config: unknown;
};

type IntegrationInstanceRow = {
  id: string;
  type: string;
  status: string;
  name: string;
};

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function loadConnectorConfig(db: IntegrationInstanceRepositoryDb, connectorId: string): Promise<ActionConnectorConfig> {
  const instance = (await db.integrationInstance.findUnique({ where: { id: connectorId } })) as IntegrationInstanceRow | null;
  if (!instance || instance.type !== "action_connector") {
    throw new Error("action connector not found");
  }
  if (instance.status !== "active") {
    throw new Error("action connector is not active");
  }
  const configRow = (await db.integrationInstanceConfig.findUnique({
    where: { integrationInstanceId: connectorId }
  })) as IntegrationConfigRow | null;
  const parsed = actionConnectorConfigSchema.parse(asRecord(configRow?.config));
  return parsed;
}

function isChinese(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function riskAllowed(config: ActionConnectorConfig, risk: string): boolean {
  if (risk === "read") return config.policy.allowReadActions;
  if (risk === "low") return config.policy.allowLowRiskActions;
  if (risk === "high") return config.policy.allowHighRiskActions;
  return false;
}

function chooseAction(message: string, actions: ActionDescriptor[]): ConnectorActionRequest {
  const normalized = message.toLowerCase();
  const serialMatch = message.match(/(?:sn|serial|serial number|序列号)[:：\s]*([A-Za-z0-9._-]{3,})/i);
  const serialNumber = serialMatch?.[1];
  const hasAction = (id: string) => actions.some((action) => action.id === id);

  if ((normalized.includes("alarm") || message.includes("告警")) && hasAction("alarm.active_summary")) {
    return {
      actionId: "alarm.active_summary",
      input: serialNumber ? { deviceSerialNumber: serialNumber, limit: 10 } : { limit: 10 }
    };
  }

  if ((normalized.includes("health") || message.includes("健康")) && hasAction("system.health")) {
    return { actionId: "system.health", input: {} };
  }

  if (serialNumber && hasAction("device.summary")) {
    return { actionId: "device.summary", input: { serialNumber } };
  }

  if (hasAction("device.search")) {
    return { actionId: "device.search", input: { query: message, limit: 10 } };
  }

  const first = actions[0];
  if (!first) throw new Error("connector returned no actions");
  return { actionId: first.id, input: {} };
}

function summarizeResult(actionId: string, result: unknown, locale: string): string {
  const zh = isChinese(locale);
  const data = asRecord(result);
  const nested = asRecord(data.result);
  const payload = Object.keys(nested).length > 0 ? nested : data;

  if (actionId === "device.search") {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const total = typeof payload.total === "number" ? payload.total : items.length;
    return zh ? `已读取到 ${items.length} 条设备结果，总数 ${total}。` : `Read ${items.length} device result(s), total ${total}.`;
  }
  if (actionId === "device.summary") {
    const serial = typeof payload.serial_number === "string" ? payload.serial_number : "";
    return zh ? `已读取设备 ${serial || "详情"} 的摘要和参数样本。` : `Read summary and parameter sample for device ${serial || "detail"}.`;
  }
  if (actionId === "alarm.active_summary") {
    const stats = asRecord(payload.statistics);
    const total = typeof stats.total_active === "number" ? stats.total_active : undefined;
    return zh ? `已读取活动告警摘要${total === undefined ? "。" : `，当前活动告警 ${total} 条。`}` : `Read active alarm summary${total === undefined ? "." : `, ${total} active alarm(s).`}`;
  }
  if (actionId === "system.health") {
    return zh ? "已读取系统健康状态。" : "Read system health status.";
  }
  return zh ? "已完成只读动作并返回结果。" : "Completed the read action and returned the result.";
}

export class ActionConnectorRuntimeService {
  constructor(
    private readonly db: IntegrationInstanceRepositoryDb,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async streamChat(input: {
    connectorId: string;
    delegationHeaderValue: string;
    request: ActionConnectorChatRequest;
    signal?: AbortSignal;
    emit(event: AgentStreamEvent): void;
  }): Promise<void> {
    const config = await loadConnectorConfig(this.db, input.connectorId);
    const client = new ActionConnectorClient(config, input.delegationHeaderValue, this.fetchImpl);
    const runId = randomUUID();
    const conversationId = input.request.conversationId || randomUUID();
    const callId = randomUUID();

    input.emit({ type: "start", runId, conversationId });
    input.emit({
      type: "delta",
      text: isChinese(input.request.locale) ? "正在选择可用动作并读取业务数据。\n" : "Selecting an available action and reading business data.\n"
    });

    const actions = await client.search(input.request.message, input.signal);
    const selected = chooseAction(input.request.message, actions.length > 0 ? actions : await client.list(input.signal));
    const descriptor = (await client.describe(selected.actionId, input.signal)) ?? actions.find((action) => action.id === selected.actionId);
    if (!descriptor) throw new Error("selected action descriptor not found");
    if (!riskAllowed(config, descriptor.risk)) {
      throw new Error(`action risk ${descriptor.risk} is not allowed by connector policy`);
    }

    input.emit({
      type: "tool_call",
      callId,
      toolName: "actions.execute",
      title: descriptor.title || selected.actionId,
      input: selected
    });

    const preview = await client.preview({ ...selected, dryRun: true }, input.signal);
    input.emit({
      type: "action_preview",
      callId,
      title: descriptor.title || selected.actionId,
      summary: typeof asRecord(preview).summary === "string" ? String(asRecord(preview).summary) : descriptor.description || selected.actionId,
      risk: descriptor.risk === "low" || descriptor.risk === "high" ? descriptor.risk : "read",
      preview
    });

    const result = await client.execute(selected, input.signal);
    input.emit({ type: "tool_result", callId, status: "ok", output: result });
    input.emit({ type: "delta", text: `${summarizeResult(selected.actionId, result, input.request.locale)}\n` });
    input.emit({ type: "done" });
  }
}

