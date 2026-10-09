import type {
  AdminConversationLocalEvent,
  AdminConversationLocalOperation,
  AdminConversationTranscriptMessage,
  AdminConversationTranscriptProcessRow
} from "./types";

export type TranscriptLayoutItem =
  | { kind: "message"; message: AdminConversationTranscriptMessage }
  | { kind: "alternates"; anchorId: string | null; messages: AdminConversationTranscriptMessage[] }
  | { kind: "local-event"; event: AdminConversationLocalEvent };

/**
 * Mirrors the portal: the main line is the branch the user currently sees; other
 * versions (edits, regenerations, sends rejected while a reply was running) are
 * grouped right after the active message they branch away from.
 */
export function layoutTranscript(
  messages: AdminConversationTranscriptMessage[],
  localEvents: AdminConversationLocalEvent[] = []
): TranscriptLayoutItem[] {
  return interleaveLocalEvents(layoutBranches(messages), localEvents);
}

/** Folder switches and portal open/download actions go before the first message sent after them. */
function interleaveLocalEvents(items: TranscriptLayoutItem[], events: AdminConversationLocalEvent[]): TranscriptLayoutItem[] {
  if (events.length === 0) return items;
  const pending = [...events].sort((left, right) => timeOf(left.at) - timeOf(right.at));
  const result: TranscriptLayoutItem[] = [];
  for (const item of items) {
    if (item.kind === "message") {
      const at = timeOf(item.message.createdAt);
      while (pending.length > 0 && !Number.isNaN(at) && timeOf(pending[0]!.at) < at) {
        result.push({ kind: "local-event", event: pending.shift()! });
      }
    }
    result.push(item);
  }
  for (const event of pending) result.push({ kind: "local-event", event });
  return result;
}

function layoutBranches(messages: AdminConversationTranscriptMessage[]): TranscriptLayoutItem[] {
  if (!messages.some((message) => message.branch)) {
    return messages.map((message) => ({ kind: "message", message }));
  }
  const alternatesByAnchor = new Map<string, AdminConversationTranscriptMessage[]>();
  const orphanAlternates: AdminConversationTranscriptMessage[] = [];
  const activeIds = new Set(messages.filter((message) => message.branch?.active !== false).map((message) => message.id));
  for (const message of messages) {
    if (message.branch?.active !== false) continue;
    const anchor = message.branch.divergesFromId;
    if (anchor && activeIds.has(anchor)) {
      alternatesByAnchor.set(anchor, [...(alternatesByAnchor.get(anchor) ?? []), message]);
    } else {
      orphanAlternates.push(message);
    }
  }
  const items: TranscriptLayoutItem[] = [];
  for (const message of messages) {
    if (message.branch?.active === false) continue;
    items.push({ kind: "message", message });
    const alternates = alternatesByAnchor.get(message.id);
    if (alternates) items.push({ kind: "alternates", anchorId: message.id, messages: alternates });
  }
  if (orphanAlternates.length > 0) items.push({ kind: "alternates", anchorId: null, messages: orphanAlternates });
  return items;
}

export type TranscriptTimelineRow = AdminConversationTranscriptProcessRow & {
  /** Interaction rows come from question cards / steers rather than the runtime trace. */
  source: "process" | "question" | "answer" | "steer" | "outcome" | "local";
  localOperation?: AdminConversationLocalOperation;
};

const LOCAL_TOOL_TRACE = /server:\s*local_computer/;

function timeOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/**
 * The admin "查看过程" timeline: runtime steps plus the user interactions that
 * happened during the run (assistant questions, answers, mid-run steers), ordered
 * by time so administrators can see which step each interaction followed.
 */
export function buildTranscriptProcessTimeline(message: AdminConversationTranscriptMessage): TranscriptTimelineRow[] {
  const localOperations = message.localOperations ?? [];
  const loggedLocal = localOperations.filter((operation) => operation.createdAt);
  // Logged local operations replace the generic "Tool step · server: local_computer" trace rows.
  const rows: TranscriptTimelineRow[] = (message.processRows ?? [])
    .filter((row) => loggedLocal.length === 0 || !LOCAL_TOOL_TRACE.test(row.detail ?? ""))
    .map((row) => ({ ...row, source: "process" }));
  for (const operation of loggedLocal) {
    const failed = operation.status !== "pending" && !(operation.status === "completed" && operation.ok !== false);
    rows.push({
      id: `local-${operation.id}`,
      kind: failed ? "error" : "tool",
      source: "local",
      title: operation.target ?? operation.op,
      localOperation: operation,
      at: operation.createdAt!
    });
  }
  for (const request of message.userInputRequests ?? []) {
    rows.push({
      id: `question-${request.id}`,
      kind: "meta",
      source: "question",
      title: `助手提问：${request.questions.map((question) => question.title).join(" / ") || request.text || "（无标题）"}`,
      detail: request.questions
        .map((question, index) => `${index + 1}. ${question.title}${question.options.length > 0 ? `\n   选项：${question.options.join(" / ")}` : ""}`)
        .join("\n"),
      ...(request.askedAt ? { at: request.askedAt } : {})
    });
    if (request.answer) {
      rows.push({
        id: `answer-${request.id}`,
        kind: "meta",
        source: "answer",
        title: request.answer.via === "steer" ? "用户回答（运行中送达）" : "用户回答（后续消息）",
        detail: request.answer.text,
        ...(request.answer.at ? { at: request.answer.at } : {})
      });
    }
  }
  const answeredBySteer = new Set(
    (message.userInputRequests ?? []).filter((request) => request.answer?.via === "steer").map((request) => request.id)
  );
  for (const event of message.steerEvents ?? []) {
    // A steer that answered a question card is already shown as that card's answer.
    if (event.status === "accepted" && event.userInputRequestId && answeredBySteer.has(event.userInputRequestId)) continue;
    rows.push({
      id: `steer-${event.id}`,
      kind: event.status === "failed" ? "error" : "meta",
      source: "steer",
      title: event.status === "failed" ? `用户运行中引导（未送达${event.errorCode ? ` · ${event.errorCode}` : ""}）` : "用户运行中引导",
      detail: event.message,
      at: event.createdAt
    });
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftAt = timeOf(left.row.at);
      const rightAt = timeOf(right.row.at);
      if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) return leftAt - rightAt;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
