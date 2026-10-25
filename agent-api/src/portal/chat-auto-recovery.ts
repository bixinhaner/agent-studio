import type { PortalPartialAssistantSnapshot } from "./chat-partial-answer.js";
import {
  classifyUpstreamTransientError,
  UPSTREAM_RETRY_DELAYS_MS,
  type UpstreamTransientErrorKind
} from "../operations/upstream-transient-error.js";

type PortalChatAutoRecoveryInput = {
  error: unknown;
  attempted: boolean;
  finalAnswerStarted: boolean;
  nonResumableSideEffectStarted: boolean;
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
  if (input.attempted || input.finalAnswerStarted || input.nonResumableSideEffectStarted || input.aborted) {
    return false;
  }
  return isRetryablePortalNetworkError(input.error);
}

export type PortalChatRetryPlan = {
  reason: "upstream_busy" | "connection";
  delayMs: number;
  upstreamKind?: UpstreamTransientErrorKind;
};

/**
 * Decides whether a failed portal attempt runs again. A busy model service (429, overloaded, 5xx) gets
 * up to two slow retries; a dropped connection keeps its single quick retry. Neither runs once the final
 * answer is streaming or a non-resumable tool has run, or after the user or a system update stopped it.
 */
export function planPortalChatRetry(input: {
  error: unknown;
  upstreamRetries: number;
  connectionRecoveryAttempted: boolean;
  finalAnswerStarted: boolean;
  nonResumableSideEffectStarted: boolean;
  aborted: boolean;
}): PortalChatRetryPlan | undefined {
  if (input.aborted || input.finalAnswerStarted || input.nonResumableSideEffectStarted) return undefined;
  const upstreamKind = classifyUpstreamTransientError(input.error);
  if (upstreamKind) {
    const delayMs = UPSTREAM_RETRY_DELAYS_MS[input.upstreamRetries];
    return delayMs === undefined ? undefined : { reason: "upstream_busy", delayMs, upstreamKind };
  }
  return shouldAutoRecoverPortalChat({
    error: input.error,
    attempted: input.connectionRecoveryAttempted,
    finalAnswerStarted: input.finalAnswerStarted,
    nonResumableSideEffectStarted: input.nonResumableSideEffectStarted,
    aborted: input.aborted
  })
    ? { reason: "connection", delayMs: 250 }
    : undefined;
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

export function portalRuntimeEventHasNonResumableSideEffect(event: PortalRuntimeEvent): boolean {
  const itemType = asRecord(asRecord(event.raw)?.item)?.type;
  return (
    itemType === "mcp_tool_call" ||
    itemType === "image_generation" ||
    itemType === "image_generation_call" ||
    itemType === "collab_agent_tool_call" ||
    itemType === "collabAgentToolCall" ||
    itemType === "subAgentActivity"
  );
}

export function portalRuntimeEventHasAnySideEffect(event: PortalRuntimeEvent): boolean {
  const itemType = asRecord(asRecord(event.raw)?.item)?.type;
  return (
    portalRuntimeEventHasNonResumableSideEffect(event) ||
    itemType === "command_execution" ||
    itemType === "file_change"
  );
}

export function portalAutoRecoveryFailureAssistantMessage(input: {
  id: string;
  sessionId: string;
  runId?: string;
  partial?: PortalPartialAssistantSnapshot;
}) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    role: "assistant",
    content: [
      ...(input.partial?.contentParts ?? []),
      ...(input.partial?.answerText.trim() ? [{ type: "text", text: input.partial.answerText }] : []),
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
        ...(input.runId ? { runId: input.runId } : {}),
        serverPersisted: true,
        failed: true,
        autoRecoveryAttempted: true
      }
    }
  };
}
