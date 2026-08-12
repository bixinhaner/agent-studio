type PortalChatAutoRecoveryInput = {
  error: unknown;
  attempted: boolean;
  finalAnswerStarted: boolean;
  unsafeSideEffectStarted: boolean;
  aborted: boolean;
};

type PortalRuntimeEvent = {
  delta?: string;
  text?: string;
  raw?: unknown;
};

const RETRYABLE_NETWORK_ERROR_PATTERN =
  /\b(?:ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b|network error|fetch failed|socket hang up|socket (?:was )?closed|connection (?:was )?(?:closed|reset|terminated)|other side closed|transport (?:was )?closed|upstream (?:connection )?(?:closed|disconnected)|websocket (?:was )?closed/i;

function errorDetails(error: unknown): string[] {
  const details: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) {
      details.push(current.name, current.message);
      const code = (current as Error & { code?: unknown }).code;
      if (typeof code === "string") details.push(code);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.code === "string") details.push(record.code);
      if (typeof record.message === "string") details.push(record.message);
      current = record.cause;
      continue;
    }
    details.push(String(current));
    break;
  }

  return details;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeAgentMessagePhase(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[-\s]+/g, "_").toLowerCase() : "";
}

export function isRetryablePortalNetworkError(error: unknown): boolean {
  return errorDetails(error).some((detail) => RETRYABLE_NETWORK_ERROR_PATTERN.test(detail));
}

export function shouldAutoRecoverPortalChat(input: PortalChatAutoRecoveryInput): boolean {
  if (input.attempted || input.finalAnswerStarted || input.unsafeSideEffectStarted || input.aborted) {
    return false;
  }
  return isRetryablePortalNetworkError(input.error);
}

export function portalAutoRecoveryPrompt(input: { originalPrompt: string; firstAttemptRuntimeEventSeen: boolean }): string {
  return input.firstAttemptRuntimeEventSeen ? "continue" : input.originalPrompt;
}

export function portalRuntimeEventStartsFinalAnswer(event: PortalRuntimeEvent): boolean {
  const item = asRecord(asRecord(event.raw)?.item);
  if (item?.type !== "agent_message") return false;
  return normalizeAgentMessagePhase(item.phase) === "final_answer" && Boolean(event.delta || event.text || item.text);
}

export function portalRuntimeEventIndicatesTurnStarted(event: PortalRuntimeEvent): boolean {
  const eventType = asRecord(event.raw)?.type;
  return typeof eventType === "string" && (eventType.startsWith("turn.") || eventType.startsWith("item."));
}

export function portalRuntimeEventHasUnsafeRetrySideEffect(event: PortalRuntimeEvent): boolean {
  const itemType = asRecord(asRecord(event.raw)?.item)?.type;
  return (
    itemType === "mcp_tool_call" ||
    itemType === "command_execution" ||
    itemType === "file_change" ||
    itemType === "image_generation" ||
    itemType === "image_generation_call" ||
    itemType === "collab_agent_tool_call" ||
    itemType === "collabAgentToolCall" ||
    itemType === "subAgentActivity"
  );
}

export function portalAutoRecoveryFailureAssistantMessage(input: { id: string; sessionId: string }) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    role: "assistant",
    content: [
      {
        type: "data",
        name: "codex_recovery_failure",
        data: { attempted: true }
      }
    ],
    status: {
      type: "incomplete",
      reason: "error",
      error: "portal_auto_recovery_exhausted"
    },
    createdAt: now,
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        sessionId: input.sessionId,
        serverPersisted: true,
        failed: true,
        autoRecoveryAttempted: true
      }
    }
  };
}
