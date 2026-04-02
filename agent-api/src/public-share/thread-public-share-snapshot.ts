import type { StoredMessageItem, ThreadRecord } from "../persistence/thread-repository.js";

export type ThreadPublicShareSnapshotPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "source";
      id: string;
      url: string;
      title?: string;
    };

export type ThreadPublicShareSnapshotMessage = {
  id: string;
  role: "user" | "assistant";
  parts: ThreadPublicShareSnapshotPart[];
};

export type ThreadPublicShareSnapshotTurn = {
  id: string;
  leadMessageId: string;
  messages: ThreadPublicShareSnapshotMessage[];
};

export type ThreadPublicShareSnapshot = {
  version: 1;
  threadTitle?: string;
  turns: ThreadPublicShareSnapshotTurn[];
};

type ParsedShareableMessage = ThreadPublicShareSnapshotMessage;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function pushTextPart(parts: ThreadPublicShareSnapshotPart[], text: string) {
  if (!text.trim()) return;
  const normalized = redactSensitiveText(text);
  if (!normalized.trim()) return;
  const last = parts.at(-1);
  if (last?.type === "text") {
    last.text += normalized;
    return;
  }
  parts.push({
    type: "text",
    text: normalized
  });
}

function redactSensitiveText(text: string): string {
  const patterns = [
    /(^|[\s("'`])((?:\/Users|\/home|\/usr\/local|\/var|\/opt|\/tmp)[^\s"'`)\]}]+)/g,
    /(^|[\s("'`])([A-Za-z]:\\[^\s"'`)\]}]+)/g
  ];
  return patterns.reduce(
    (current, pattern) =>
      current.replace(pattern, (_match, prefix: string) => `${prefix}[redacted path]`),
    text
  );
}

function placeholderForUnsupportedPart(part: Record<string, unknown>, role: "user" | "assistant"): string {
  const type = asTrimmedString(part.type);
  if (type === "file") {
    const filename = asTrimmedString(part.filename);
    return filename ? `[附件：${filename}]` : "[附件已省略]";
  }
  if (type === "image") {
    return role === "user" ? "[图片已省略]" : "[图片输出已省略]";
  }
  if (type === "audio") {
    return "[音频已省略]";
  }
  if (type === "reasoning" || type === "tool-call" || type === "data") {
    return "";
  }
  return "";
}

function sanitizeMessageParts(parts: unknown, role: "user" | "assistant"): ThreadPublicShareSnapshotPart[] {
  if (!Array.isArray(parts)) return [];
  const sanitized: ThreadPublicShareSnapshotPart[] = [];
  let unsupportedOnly = false;

  for (const entry of parts) {
    const part = asRecord(entry);
    if (!part) continue;
    const type = asTrimmedString(part.type);

    if (type === "text") {
      pushTextPart(sanitized, typeof part.text === "string" ? part.text : "");
      continue;
    }

    if (type === "source") {
      const url = asTrimmedString(part.url);
      if (!isHttpUrl(url)) continue;
      const id = asTrimmedString(part.id) || `source-${sanitized.length + 1}`;
      const title = asTrimmedString(part.title) || undefined;
      sanitized.push({
        type: "source",
        id,
        url,
        ...(title ? { title } : {})
      });
      continue;
    }

    const placeholder = placeholderForUnsupportedPart(part, role);
    if (placeholder) {
      pushTextPart(sanitized, placeholder);
      unsupportedOnly = true;
    } else if (type) {
      unsupportedOnly = true;
    }
  }

  if (sanitized.length === 0 && unsupportedOnly) {
    pushTextPart(sanitized, role === "user" ? "[此消息包含未公开内容]" : "[此回复包含未公开内容]");
  }

  return sanitized;
}

function parseShareableMessages(items: StoredMessageItem[]): ParsedShareableMessage[] {
  const parsed: ParsedShareableMessage[] = [];

  for (const [index, item] of items.entries()) {
    const message = asRecord(item.message);
    if (!message) continue;
    const role = asTrimmedString(message.role);
    if (role !== "user" && role !== "assistant") continue;

    const parts = sanitizeMessageParts(message.content, role);
    if (parts.length === 0) continue;

    parsed.push({
      id: asTrimmedString(message.id) || `message-${index + 1}`,
      role,
      parts
    });
  }

  return parsed;
}

export function groupParsedMessagesIntoTurns(messages: ParsedShareableMessage[]): ThreadPublicShareSnapshotTurn[] {
  const turns: ThreadPublicShareSnapshotTurn[] = [];

  for (const message of messages) {
    const lastTurn = turns.at(-1);
    if (message.role === "user" || !lastTurn) {
      const nextId = `turn-${turns.length + 1}`;
      turns.push({
        id: nextId,
        leadMessageId: message.id,
        messages: [message]
      });
      continue;
    }

    lastTurn.messages.push(message);
  }

  return turns;
}

function firstMeaningfulText(snapshot: ThreadPublicShareSnapshot): string {
  for (const turn of snapshot.turns) {
    for (const message of turn.messages) {
      for (const part of message.parts) {
        if (part.type !== "text") continue;
        const text = part.text.replace(/\s+/g, " ").trim();
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

function truncateTitle(value: string, max = 60): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trim()}...`;
}

export function deriveThreadPublicShareTitle(snapshot: ThreadPublicShareSnapshot, threadTitle?: string): string {
  const preferred = asTrimmedString(threadTitle);
  if (preferred) return preferred;
  const fallback = truncateTitle(firstMeaningfulText(snapshot), 56);
  return fallback || "Shared conversation";
}

export function buildThreadPublicShareSnapshot(input: {
  thread: Pick<ThreadRecord, "title">;
  repository: { messages: StoredMessageItem[] };
  selectedTurnIds: string[];
}): {
  selectedTurnCount: number;
  title: string;
  snapshot: ThreadPublicShareSnapshot;
} {
  const turnIds = new Set(input.selectedTurnIds.map((value) => asTrimmedString(value)).filter(Boolean));
  const parsedMessages = parseShareableMessages(input.repository.messages);
  const groupedTurns = groupParsedMessagesIntoTurns(parsedMessages);
  const turns = groupedTurns.filter((turn) => turnIds.has(turn.id));

  if (turns.length === 0) {
    throw new Error("至少选择一个可公开的对话轮次");
  }

  const snapshot: ThreadPublicShareSnapshot = {
    version: 1,
    threadTitle: asTrimmedString(input.thread.title) || undefined,
    turns
  };

  return {
    selectedTurnCount: turns.length,
    title: deriveThreadPublicShareTitle(snapshot, input.thread.title),
    snapshot
  };
}

function normalizeSnapshotPart(value: unknown): ThreadPublicShareSnapshotPart | null {
  const part = asRecord(value);
  if (!part) return null;
  const type = asTrimmedString(part.type);
  if (type === "text") {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text.trim()) return null;
    return { type: "text", text };
  }
  if (type === "source") {
    const url = asTrimmedString(part.url);
    if (!isHttpUrl(url)) return null;
    const id = asTrimmedString(part.id) || "source";
    const title = asTrimmedString(part.title) || undefined;
    return {
      type: "source",
      id,
      url,
      ...(title ? { title } : {})
    };
  }
  return null;
}

function normalizeSnapshotMessage(value: unknown, index: number): ThreadPublicShareSnapshotMessage | null {
  const message = asRecord(value);
  if (!message) return null;
  const role = asTrimmedString(message.role);
  if (role !== "user" && role !== "assistant") return null;
  const parts = Array.isArray(message.parts)
    ? message.parts.map(normalizeSnapshotPart).filter((part): part is ThreadPublicShareSnapshotPart => Boolean(part))
    : [];
  if (parts.length === 0) return null;
  return {
    id: asTrimmedString(message.id) || `message-${index + 1}`,
    role,
    parts
  };
}

function normalizeSnapshotTurn(value: unknown, index: number): ThreadPublicShareSnapshotTurn | null {
  const turn = asRecord(value);
  if (!turn) return null;
  const messages = Array.isArray(turn.messages)
    ? turn.messages
        .map((message, messageIndex) => normalizeSnapshotMessage(message, messageIndex))
        .filter((message): message is ThreadPublicShareSnapshotMessage => Boolean(message))
    : [];
  if (messages.length === 0) return null;
  return {
    id: asTrimmedString(turn.id) || `turn-${index + 1}`,
    leadMessageId: asTrimmedString(turn.leadMessageId) || messages[0]!.id,
    messages
  };
}

export function normalizeThreadPublicShareSnapshot(value: unknown): ThreadPublicShareSnapshot {
  const snapshot = asRecord(value);
  const turns = Array.isArray(snapshot?.turns)
    ? snapshot.turns
        .map((turn, index) => normalizeSnapshotTurn(turn, index))
        .filter((turn): turn is ThreadPublicShareSnapshotTurn => Boolean(turn))
    : [];

  return {
    version: 1,
    threadTitle: asTrimmedString(snapshot?.threadTitle) || undefined,
    turns
  };
}
