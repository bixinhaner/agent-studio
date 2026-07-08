import type {
  CodexCommentaryEntry,
  CodexProjectedToolCall,
  CodexRuntimeEventProjection,
  CodexTraceKind,
  CodexTraceRow
} from "../../operations/codex-execution-service.js";
import type { AgentProcessKind, AgentStreamEvent } from "./runtime.js";

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isRisk(value: unknown): value is "read" | "low" | "high" {
  return value === "read" || value === "low" || value === "high";
}

function processKind(kind: CodexTraceKind): AgentProcessKind {
  if (kind === "tool") return "tool_result";
  if (kind === "meta") return "status";
  return kind;
}

function processDetail(row: CodexTraceRow): unknown {
  return row.rawDetail ?? row.detail;
}

function traceRowToProcessEvent(row: CodexTraceRow, index: number): AgentStreamEvent {
  return {
    type: "process",
    id: trimOrUndefined(row.id) ?? `process-${index + 1}`,
    kind: processKind(row.kind),
    title: trimOrUndefined(row.title) ?? "Processing step",
    ...(processDetail(row) !== undefined ? { detail: processDetail(row) } : {}),
    ...(trimOrUndefined(row.at) ? { at: trimOrUndefined(row.at) } : {})
  };
}

function commentaryEntryToThoughtEvent(entry: CodexCommentaryEntry): AgentStreamEvent | undefined {
  const text = trimOrUndefined(entry.text);
  if (!text) return undefined;
  return {
    type: "thought",
    id: trimOrUndefined(entry.id),
    text,
    append: false,
    status: entry.status,
    ...(typeof entry.last_event_at === "number" ? { lastEventAt: entry.last_event_at } : {})
  };
}

export function actionConnectorCommentaryEntriesToEvents(
  entries: CodexCommentaryEntry[] | undefined
): AgentStreamEvent[] {
  return (entries ?? [])
    .map(commentaryEntryToThoughtEvent)
    .filter((event): event is AgentStreamEvent => Boolean(event));
}

function actionPayloadFromToolResult(result: unknown): Record<string, unknown> | undefined {
  const direct = asRecord(result);
  if (!direct) return undefined;
  const content = Array.isArray(direct.content) ? direct.content : undefined;
  const text = content
    ?.map((item) => asRecord(item)?.text)
    .find((value): value is string => typeof value === "string" && value.trim().startsWith("{"));
  if (!text) return direct;
  try {
    return asRecord(JSON.parse(text)) ?? direct;
  } catch {
    return direct;
  }
}

function toolCallId(toolCall: CodexProjectedToolCall): string {
  return trimOrUndefined(toolCall.id) ?? `tool-${toolCall.name}`;
}

function toolCallToEvents(toolCall: CodexProjectedToolCall): AgentStreamEvent[] {
  const callId = toolCallId(toolCall);
  const events: AgentStreamEvent[] = [
    {
      type: "tool_call",
      callId,
      toolName: toolCall.name,
      title: toolCall.name,
      input: toolCall.args
    }
  ];

  if (toolCall.errorMessage) {
    events.push({
      type: "tool_result",
      callId,
      status: "error",
      error: {
        code: "TOOL_CALL_FAILED",
        message: toolCall.errorMessage,
        retryable: true
      }
    });
    return events;
  }

  const actionPayload = actionPayloadFromToolResult(toolCall.result);
  if (actionPayload?.requiresConfirmation === true) {
    events.push({
      type: "action_preview",
      callId,
      title: trimOrUndefined(actionPayload.title) ?? toolCall.name,
      summary: trimOrUndefined(actionPayload.summary) ?? trimOrUndefined(actionPayload.message) ?? toolCall.name,
      risk: isRisk(actionPayload.risk) ? actionPayload.risk : "low",
      preview: actionPayload
    });
    return events;
  }

  events.push({
    type: "tool_result",
    callId,
    status: "ok",
    output: toolCall.result
  });
  return events;
}

export function projectActionConnectorRuntimeEvents(
  projection: CodexRuntimeEventProjection
): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];

  if (projection.commentaryDelta?.text) {
    events.push({
      type: "thought",
      id: trimOrUndefined(projection.commentaryDelta.id),
      text: projection.commentaryDelta.text,
      append: projection.commentaryDelta.append,
      status: projection.commentaryDelta.status,
      at: trimOrUndefined(projection.commentaryDelta.at),
      lastEventAt: projection.commentaryDelta.last_event_at
    });
  }

  events.push(...actionConnectorCommentaryEntriesToEvents(projection.liveCommentaryEntries));

  if (projection.toolCall) {
    events.push(...toolCallToEvents(projection.toolCall));
  }

  projection.traceRows.forEach((row, index) => {
    events.push(traceRowToProcessEvent(row, index));
  });

  if (projection.answerDelta) {
    events.push({ type: "delta", text: projection.answerDelta });
  }

  return events;
}
