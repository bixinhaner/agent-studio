import type { DingTalkBotRuntimeConfig } from "./bot-stream-service.js";

export const DINGTALK_BOT_CHANNEL = "dingtalk_bot";

const DEFAULT_RESET_COMMANDS = ["新对话", "重置", "reset", "/reset"];

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function asNumber(value: unknown, fallback: number, options: { min: number; max: number }): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(options.max, Math.max(options.min, Math.round(parsed)));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = trimOrUndefined(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

export function normalizeDingTalkBotConfig(input: unknown): DingTalkBotRuntimeConfig {
  const root = asRecord(input);
  const robot = asRecord(root?.robot) ?? {};
  const resetCommands = asStringArray(robot.resetCommands);
  const replyMode = trimOrUndefined(robot.replyMode) === "ai_card_stream" ? "ai_card_stream" : "markdown";
  return {
    enabled: asBoolean(robot.enabled, false),
    receiveMode: "stream",
    replyMode,
    agentModeId: trimOrUndefined(robot.agentModeId),
    knowledgeSetIds: asStringArray(robot.knowledgeSetIds),
    singleChatEnabled: asBoolean(robot.singleChatEnabled, true),
    groupChatEnabled: asBoolean(robot.groupChatEnabled, true),
    groupReplyMode: "mention_only",
    autoSyncUsers: asBoolean(robot.autoSyncUsers, true),
    streamingCardTemplateId: trimOrUndefined(robot.streamingCardTemplateId),
    streamingCardContentKey: trimOrUndefined(robot.streamingCardContentKey) ?? "content",
    streamingCardUpdateIntervalMs: asNumber(robot.streamingCardUpdateIntervalMs, 700, { min: 250, max: 10_000 }),
    streamingCardMinUpdateChars: asNumber(robot.streamingCardMinUpdateChars, 24, { min: 1, max: 1000 }),
    resetCommands: resetCommands.length > 0 ? resetCommands : DEFAULT_RESET_COMMANDS,
    errorAlertEnabled: asBoolean(robot.errorAlertEnabled, false),
    errorAlertUseSuperAdmins: asBoolean(robot.errorAlertUseSuperAdmins, true),
    errorAlertUserIds: asStringArray(robot.errorAlertUserIds),
    errorAlertThrottleSeconds: asNumber(robot.errorAlertThrottleSeconds, 300, { min: 0, max: 86_400 }),
    unauthorizedMessage:
      trimOrUndefined(robot.unauthorizedMessage) ??
      "当前钉钉账号还没有关联到 Agent Studio 用户，请联系管理员同步组织通讯录。",
    busyMessage: trimOrUndefined(robot.busyMessage) ?? "上一条消息还在处理中，请稍后再发。",
    resetConfirmationMessage: trimOrUndefined(robot.resetConfirmationMessage) ?? "已开启新对话。",
    unsupportedMessage: trimOrUndefined(robot.unsupportedMessage) ?? "暂时只支持文本消息。",
    errorMessage: trimOrUndefined(robot.errorMessage) ?? "这条消息处理失败，请稍后重试。"
  };
}

export function isDingTalkResetCommand(text: string, config: DingTalkBotRuntimeConfig): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return config.resetCommands.some((command) => command.trim().toLowerCase() === normalized);
}
