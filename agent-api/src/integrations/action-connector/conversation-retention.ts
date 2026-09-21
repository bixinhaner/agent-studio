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

/**
 * A retry is the same report run. Its attempt number belongs to the durable
 * tool lease, not to the user-visible conversation identity.
 */
export function legacyProactiveConversationId(runId: string): string {
  return `proactive-${runId}`;
}
