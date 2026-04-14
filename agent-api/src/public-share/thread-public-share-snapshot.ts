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

export type ThreadPublicShareSnapshotProcessKind =
  | "reasoning"
  | "tool"
  | "source"
  | "meta"
  | "process"
  | "done"
  | "error"
  | "debug";

export type ThreadPublicShareSnapshotProcessRow = {
  id: string;
  kind: ThreadPublicShareSnapshotProcessKind;
  title: string;
  detail?: string;
  at?: string;
};

export type ThreadPublicShareSnapshotMessage = {
  id: string;
  role: "user" | "assistant";
  parts: ThreadPublicShareSnapshotPart[];
  processRows?: ThreadPublicShareSnapshotProcessRow[];
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

const PROCESS_KINDS = new Set<ThreadPublicShareSnapshotProcessKind>([
  "reasoning",
  "tool",
  "source",
  "meta",
  "process",
  "done",
  "error",
  "debug"
]);

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

const KNOWLEDGE_SET_IMAGE_PATH_PATTERN =
  /\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/[^\n<>"'`]*?\.(?:png|jpe?g|gif|webp|bmp|svg|avif)/giu;

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
  const preservedPaths: string[] = [];
  const protectedText = text.replace(KNOWLEDGE_SET_IMAGE_PATH_PATTERN, (match) => {
    const token = `__PUBLIC_SHARE_KNOWLEDGE_IMAGE_${preservedPaths.length}__`;
    preservedPaths.push(match);
    return token;
  });
  const patterns = [
    /(^|[\s("'`])((?:\/Users|\/home|\/usr\/local|\/var|\/opt|\/tmp)[^\s"'`)\]}]+)/g,
    /(^|[\s("'`])([A-Za-z]:\\[^\s"'`)\]}]+)/g
  ];
  const redacted = patterns.reduce(
    (current, pattern) =>
      current.replace(pattern, (_match, prefix: string) => `${prefix}[redacted path]`),
    protectedText
  );
  return preservedPaths.reduce(
    (current, preservedPath, index) =>
      current.replaceAll(`__PUBLIC_SHARE_KNOWLEDGE_IMAGE_${index}__`, preservedPath),
    redacted
  );
}

function placeholderForUnsupportedPart(part: Record<string, unknown>, role: "user" | "assistant"): string {
  const type = asTrimmedString(part.type);
  if (type === "file") {
    const filename = asTrimmedString(part.filename);
    return filename ? `[Attachment: ${filename}]` : "[Attachment omitted]";
  }
  if (type === "image") {
    return role === "user" ? "[Image omitted]" : "[Generated image omitted]";
  }
  if (type === "audio") {
    return "[Audio omitted]";
  }
  if (type === "reasoning" || type === "tool-call" || type === "data") {
    return "";
  }
  return "";
}

function normalizeProcessKind(value: unknown): ThreadPublicShareSnapshotProcessKind {
  const raw = asTrimmedString(value);
  return PROCESS_KINDS.has(raw as ThreadPublicShareSnapshotProcessKind)
    ? (raw as ThreadPublicShareSnapshotProcessKind)
    : "process";
}

function sanitizeProcessTitle(value: unknown, fallback = "Process event"): string {
  const title = redactSensitiveText(asTrimmedString(value));
  return title || fallback;
}

function sanitizeProcessDetail(value: unknown): string | undefined {
  const detail = redactSensitiveText(asTrimmedString(value));
  return detail || undefined;
}

function sanitizeProcessAt(value: unknown): string | undefined {
  const at = asTrimmedString(value);
  return at || undefined;
}

function stringifyProcessValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractTraceBatchRows(part: Record<string, unknown>): ThreadPublicShareSnapshotProcessRow[] {
  if (asTrimmedString(part.type) !== "data" || asTrimmedString(part.name) !== "codex_trace_batch") {
    return [];
  }

  const data = asRecord(part.data);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows
    .map((entry, index) => {
      const row = asRecord(entry);
      if (!row) return null;
      const title = sanitizeProcessTitle(row.title);
      if (!title) return null;
      return {
        id: asTrimmedString(row.id) || `process-row-${index + 1}`,
        kind: normalizeProcessKind(row.kind),
        title,
        detail: sanitizeProcessDetail(row.detail),
        at: sanitizeProcessAt(row.at)
      } satisfies ThreadPublicShareSnapshotProcessRow;
    })
    .filter(Boolean) as ThreadPublicShareSnapshotProcessRow[];
}

function extractFallbackProcessRows(parts: unknown): ThreadPublicShareSnapshotProcessRow[] {
  if (!Array.isArray(parts)) return [];
  const rows: ThreadPublicShareSnapshotProcessRow[] = [];

  for (const [index, entry] of parts.entries()) {
    const part = asRecord(entry);
    if (!part) continue;
    const type = asTrimmedString(part.type);

    if (type === "reasoning") {
      const detail = sanitizeProcessDetail(part.text);
      if (!detail) continue;
      rows.push({
        id: asTrimmedString(part.id) || `process-row-${index + 1}`,
        kind: "reasoning",
        title: "Reasoning summary",
        detail
      });
      continue;
    }

    if (type === "tool-call") {
      const toolName = asTrimmedString(part.toolName) || "tool";
      const argsText = sanitizeProcessDetail(part.argsText);
      const resultText = sanitizeProcessDetail(stringifyProcessValue(part.result));
      const detail = [argsText, resultText].filter(Boolean).join("\n\n").trim();
      rows.push({
        id: asTrimmedString(part.toolCallId) || `process-row-${index + 1}`,
        kind: "tool",
        title: `Tool call · ${toolName}`,
        detail: detail || undefined
      });
      continue;
    }

    if (type === "data" && asTrimmedString(part.name) === "codex_process") {
      const data = asRecord(part.data);
      if (!data) continue;
      const title = sanitizeProcessTitle(data.title);
      if (!title) continue;
      rows.push({
        id: asTrimmedString(part.id) || `process-row-${index + 1}`,
        kind: normalizeProcessKind(data.kind),
        title,
        detail: sanitizeProcessDetail(data.detail),
        at: sanitizeProcessAt(data.at)
      });
    }
  }

  return rows;
}

function extractProcessRows(parts: unknown): ThreadPublicShareSnapshotProcessRow[] {
  if (!Array.isArray(parts)) return [];
  const traceRows = parts.flatMap((entry) => {
    const part = asRecord(entry);
    return part ? extractTraceBatchRows(part) : [];
  });
  if (traceRows.length > 0) {
    return traceRows;
  }
  return extractFallbackProcessRows(parts);
}

function sanitizeMessageParts(
  parts: unknown,
  role: "user" | "assistant",
  hasStructuredProcess = false
): ThreadPublicShareSnapshotPart[] {
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

  if (sanitized.length === 0 && unsupportedOnly && !hasStructuredProcess) {
    pushTextPart(sanitized, role === "user" ? "[This message contains non-public content]" : "[This reply contains non-public content]");
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

    const processRows = role === "assistant" ? extractProcessRows(message.content) : [];
    const parts = sanitizeMessageParts(message.content, role, processRows.length > 0);
    if (parts.length === 0 && processRows.length === 0) continue;

    parsed.push({
      id: asTrimmedString(message.id) || `message-${index + 1}`,
      role,
      parts,
      ...(processRows.length > 0 ? { processRows } : {})
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
    throw new Error("Select at least one shareable conversation turn");
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

export function buildThreadPublicShareSnapshotFromLeadMessageIds(input: {
  thread: Pick<ThreadRecord, "title">;
  repository: { messages: StoredMessageItem[] };
  selectedLeadMessageIds: string[];
}): {
  selectedTurnCount: number;
  title: string;
  snapshot: ThreadPublicShareSnapshot;
} {
  const leadMessageIds = new Set(input.selectedLeadMessageIds.map((value) => asTrimmedString(value)).filter(Boolean));
  const parsedMessages = parseShareableMessages(input.repository.messages);
  const groupedTurns = groupParsedMessagesIntoTurns(parsedMessages);
  const turns = groupedTurns.filter((turn) => leadMessageIds.has(turn.leadMessageId));

  if (turns.length === 0) {
    throw new Error("Unable to restore selected conversation turns from this public link");
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

export function snapshotHasStructuredProcessRows(snapshot: ThreadPublicShareSnapshot): boolean {
  return snapshot.turns.some((turn) => turn.messages.some((message) => Array.isArray(message.processRows) && message.processRows.length > 0));
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
  const processRows = Array.isArray(message.processRows)
    ? message.processRows
        .map((row, rowIndex) => {
          const item = asRecord(row);
          if (!item) return null;
          const title = sanitizeProcessTitle(item.title);
          if (!title) return null;
          return {
            id: asTrimmedString(item.id) || `process-row-${rowIndex + 1}`,
            kind: normalizeProcessKind(item.kind),
            title,
            detail: sanitizeProcessDetail(item.detail),
            at: sanitizeProcessAt(item.at)
          } satisfies ThreadPublicShareSnapshotProcessRow;
        })
        .filter(Boolean) as ThreadPublicShareSnapshotProcessRow[]
    : [];
  if (parts.length === 0 && processRows.length === 0) return null;
  return {
    id: asTrimmedString(message.id) || `message-${index + 1}`,
    role,
    parts,
    ...(processRows.length > 0 ? { processRows } : {})
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
