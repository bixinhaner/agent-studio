export type PortalFailurePayload = {
  detail: string;
  code?: string;
  reason_code?: string;
};

export type PortalFailurePresentation = {
  userMessage: string;
  rawDetail: string;
  code?: string;
  reasonCode?: string;
};

type PortalFailureMessageKey =
  | "generic"
  | "deploymentDrain"
  | "aiServiceBusy"
  | "skillLoadFailed"
  | "messageTooLarge"
  | "requestLimit"
  | "subscriptionRequired"
  | "subscriptionExpired"
  | "subscriptionPaused"
  | "workspaceUnavailable";

const MESSAGES: Record<"en" | "zh", Record<PortalFailureMessageKey, string>> = {
  en: {
    generic: "I couldn't complete this response. Please try again. If the issue continues, contact your workspace admin.",
    deploymentDrain: "The system is being updated. Please try again in a few minutes.",
    aiServiceBusy: "The AI service is currently busy. Please try again later.",
    skillLoadFailed: "The selected Skill could not be loaded, so this request was not started. Select it again and retry.",
    messageTooLarge: "This message is too large to send directly. Upload it as a .txt or .log file, then send a short question. Direct messages are limited to 20,000 characters.",
    requestLimit: "AI request limit reached. Please wait for the next reset or contact your workspace admin.",
    subscriptionRequired: "Access is not enabled yet. Please contact your workspace admin to enable a plan.",
    subscriptionExpired: "Your access has ended. Please contact your workspace admin to renew it.",
    subscriptionPaused: "Access is paused. Please contact your workspace admin to resume it.",
    workspaceUnavailable: "This workspace is temporarily unavailable. Please try again after the next reset or contact your workspace admin."
  },
  zh: {
    generic: "暂时无法完成本次回答，请重试；如果问题持续出现，请联系工作区管理员。",
    deploymentDrain: "系统正在升级，请几分钟后重试。",
    aiServiceBusy: "AI 服务当前繁忙，请稍后重试。",
    skillLoadFailed: "所选 Skill 暂时未能加载，本次尚未开始执行。请重新选择后重试。",
    messageTooLarge: "消息内容过长，无法直接发送。请将内容上传为 .txt 或 .log 文件，再发送简短问题。单条消息最多 20,000 个字符。",
    requestLimit: "AI 请求次数已达上限，请等待下个周期重置，或联系工作区管理员。",
    subscriptionRequired: "当前尚未开通访问权限，请联系工作区管理员启用订阅方案。",
    subscriptionExpired: "当前访问权限已到期，请联系工作区管理员续订。",
    subscriptionPaused: "当前访问权限已暂停，请联系工作区管理员恢复。",
    workspaceUnavailable: "工作区暂时不可用，请在下个周期重置后重试，或联系工作区管理员。"
  }
};

function language(locale?: string | null): "en" | "zh" {
  const primary = (locale || "").split(",", 1)[0]?.split(";", 1)[0]?.trim().toLowerCase();
  return primary === "zh" || primary?.startsWith("zh-") ? "zh" : "en";
}

function messageKey(detail: string, code?: string): PortalFailureMessageKey {
  const normalizedCode = (code || "").trim().toUpperCase();
  const normalizedDetail = detail.replace(/\s+/g, " ").trim();
  if (normalizedCode === "DEPLOYMENT_DRAIN") return "deploymentDrain";
  if (normalizedCode === "AI_SERVICE_BUSY") return "aiServiceBusy";
  if (normalizedCode === "SKILL_LOAD_FAILED") return "skillLoadFailed";
  if (normalizedCode === "DIRECT_CHAT_MESSAGE_TOO_LARGE") return "messageTooLarge";
  if (normalizedCode === "AI_REQUEST_LIMIT_REACHED" || normalizedCode === "QUOTA_LIMIT_REACHED" || normalizedCode.endsWith("_TURN_LIMIT_EXCEEDED")) return "requestLimit";
  if (normalizedCode === "SUBSCRIPTION_REQUIRED" || normalizedCode === "EXTERNAL_SUBSCRIPTION_REQUIRED") return "subscriptionRequired";
  if (normalizedCode === "SUBSCRIPTION_EXPIRED" || normalizedCode.endsWith("_SUBSCRIPTION_EXPIRED")) return "subscriptionExpired";
  if (normalizedCode === "SUBSCRIPTION_PAUSED" || normalizedCode.endsWith("_SUBSCRIPTION_PAUSED")) return "subscriptionPaused";
  if (normalizedCode === "AI_TOKEN_LIMIT_REACHED" || normalizedCode.endsWith("_TOKEN_LIMIT_EXCEEDED")) return "workspaceUnavailable";
  if (/system is updating|agent studio is deploying|currently deploying|deployment drain/i.test(normalizedDetail)) return "deploymentDrain";
  return "generic";
}

export function presentPortalFailure(input: {
  payload: PortalFailurePayload;
  rawDetail?: string;
  locale?: string | null;
}): PortalFailurePresentation {
  const code = input.payload.code?.trim() || undefined;
  const reasonCode = input.payload.reason_code?.trim() || undefined;
  const key = messageKey(input.payload.detail, code || reasonCode);
  return {
    userMessage: MESSAGES[language(input.locale)][key],
    rawDetail: input.rawDetail?.trim() || input.payload.detail.trim() || "Unknown portal failure",
    code,
    reasonCode
  };
}
