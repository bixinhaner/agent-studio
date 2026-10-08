import type {
  AdminConversationTranscriptMessage,
  AdminConversationTranscriptProcessRow
} from "./types";

export type TranscriptLayoutItem =
  | { kind: "message"; message: AdminConversationTranscriptMessage }
  | { kind: "alternates"; anchorId: string | null; messages: AdminConversationTranscriptMessage[] };

/**
 * Mirrors the portal: the main line is the branch the user currently sees; other
 * versions (edits, regenerations, sends rejected while a reply was running) are
 * grouped right after the active message they branch away from.
 */
export function layoutTranscript(messages: AdminConversationTranscriptMessage[]): TranscriptLayoutItem[] {
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
  source: "process" | "question" | "answer" | "steer" | "outcome";
};

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
  const rows: TranscriptTimelineRow[] = (message.processRows ?? []).map((row) => ({ ...row, source: "process" }));
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
  for (const event of message.steerEvents ?? []) {
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
