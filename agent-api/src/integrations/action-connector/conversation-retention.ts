import type { ActionConnectorChatRequest } from "./runtime.js";

const LEGACY_PROACTIVE_EXTERNAL_USER_ID = "xomc-proactive-service";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Built-in xOMC reports are independent findings rather than an interactive
 * assistant conversation. Keep their runtime context isolated and archive the
 * backing Studio thread after delivery so internal report turns do not fill
 * the user's active thread list.
 */
export function isLegacyProactiveConversation(request: ActionConnectorChatRequest): boolean {
  const context = asRecord(request.context);
  const externalIdentity = asRecord(context?.externalIdentity);
  return context?.proactive === true
    && typeof context.scenarioKey === "string"
    && !context.scenarioKey.startsWith("assistant:")
    && externalIdentity?.externalUserId === LEGACY_PROACTIVE_EXTERNAL_USER_ID;
}

export function isStableProactiveConversationId(conversationId: string | undefined): boolean {
  return /^proactive-[a-z0-9-]+-[a-f0-9]{64}(?:-[a-f0-9]{16})?$/.test(conversationId?.trim() ?? "");
}

/**
 * Old per-run report conversations are safe to archive after terminal
 * delivery. A stable conversation must stay reopenable for the next report;
 * its idle retention is handled separately by the operational cleanup.
 */
export function shouldArchiveLegacyProactiveConversation(request: ActionConnectorChatRequest): boolean {
  return isLegacyProactiveConversation(request) && !isStableProactiveConversationId(request.conversationId);
}

/**
 * A retry is the same report run. Its attempt number belongs to the durable
 * tool lease, not to the user-visible conversation identity.
 */
export function legacyProactiveConversationId(runId: string): string {
  return `proactive-${runId}`;
}
