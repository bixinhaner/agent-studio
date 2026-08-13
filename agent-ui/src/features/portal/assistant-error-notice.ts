import type { PortalMessageKey } from "./i18n";

const GENERIC_ERROR_PATTERNS = {
  requestLimit: /ai request limit reached|conversation limit reached/i,
  subscriptionRequired: /a plan is required|workspace has not enabled access|has not enabled access/i,
  subscriptionExpired: /access has ended|no longer active|subscription_expired/i,
  subscriptionPaused: /access is paused|currently paused|subscription_paused/i,
  deploymentDrain: /system is updating|agent studio is deploying|currently deploying|deployment drain/i,
  messageTooLarge: /too large to send directly|upload (it|the content) as a .*file|direct messages are limited/i,
  workspaceUnavailable: /service capacity|token limit|temporarily unavailable/i
} as const;

export function portalAssistantErrorMessageKey(detail: string, code?: string): PortalMessageKey {
  const normalizedCode = (code || "").trim().toUpperCase();
  const normalizedDetail = detail.replace(/\s+/g, " ").trim();

  if (normalizedCode === "DEPLOYMENT_DRAIN") return "thread.errorDeploymentDrain";
  if (normalizedCode === "AI_SERVICE_BUSY") return "thread.errorAiServiceBusy";
  if (normalizedCode === "SKILL_LOAD_FAILED") return "thread.errorSkillLoadFailed";
  if (normalizedCode === "DIRECT_CHAT_MESSAGE_TOO_LARGE") return "thread.errorMessageTooLarge";
  if (normalizedCode === "AI_REQUEST_LIMIT_REACHED" || normalizedCode === "QUOTA_LIMIT_REACHED" || normalizedCode.endsWith("_TURN_LIMIT_EXCEEDED")) {
    return "thread.errorRequestLimit";
  }
  if (normalizedCode === "SUBSCRIPTION_REQUIRED" || normalizedCode === "EXTERNAL_SUBSCRIPTION_REQUIRED") {
    return "thread.errorSubscriptionRequired";
  }
  if (normalizedCode === "SUBSCRIPTION_EXPIRED" || normalizedCode.endsWith("_SUBSCRIPTION_EXPIRED")) {
    return "thread.errorSubscriptionExpired";
  }
  if (normalizedCode === "SUBSCRIPTION_PAUSED" || normalizedCode.endsWith("_SUBSCRIPTION_PAUSED")) {
    return "thread.errorSubscriptionPaused";
  }
  if (normalizedCode === "AI_TOKEN_LIMIT_REACHED" || normalizedCode.endsWith("_TOKEN_LIMIT_EXCEEDED")) {
    return "thread.errorWorkspaceUnavailable";
  }

  if (GENERIC_ERROR_PATTERNS.requestLimit.test(normalizedDetail)) return "thread.errorRequestLimit";
  if (GENERIC_ERROR_PATTERNS.subscriptionRequired.test(normalizedDetail)) return "thread.errorSubscriptionRequired";
  if (GENERIC_ERROR_PATTERNS.subscriptionExpired.test(normalizedDetail)) return "thread.errorSubscriptionExpired";
  if (GENERIC_ERROR_PATTERNS.subscriptionPaused.test(normalizedDetail)) return "thread.errorSubscriptionPaused";
  if (GENERIC_ERROR_PATTERNS.deploymentDrain.test(normalizedDetail)) return "thread.errorDeploymentDrain";
  if (GENERIC_ERROR_PATTERNS.messageTooLarge.test(normalizedDetail)) return "thread.errorMessageTooLarge";
  if (GENERIC_ERROR_PATTERNS.workspaceUnavailable.test(normalizedDetail)) return "thread.errorWorkspaceUnavailable";
  return "thread.errorGeneric";
}
