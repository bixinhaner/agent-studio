type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function assistantContentPartRank(part: unknown): number {
  const item = asRecord(part);
  if (!item) return 3;

  const type = typeof item.type === "string" ? item.type : "";
  const name = typeof item.name === "string" ? item.name : "";

  if (type === "data" && name === "codex_instruction_reads") return 0;
  if (type === "reasoning" || (type === "data" && name === "codex_commentary")) return 1;
  if (
    type === "tool-call"
    || type === "tool-result"
    || (type === "data" && [
      "codex_trace_batch",
      "codex_process",
      "codex_process_audit",
      "codex_connection_recovery",
      "codex_recovery_failure"
    ].includes(name))
  ) {
    return 2;
  }
  if (type === "file" || (type === "data" && name === "codex_file_change")) return 4;
  return 3;
}

export function orderAssistantContentParts(parts: readonly unknown[]): unknown[] {
  return parts
    .map((part, index) => ({ part, index, rank: assistantContentPartRank(part) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ part }) => part);
}

export function normalizeAssistantMessageContentOrder(message: unknown): unknown {
  const item = asRecord(message);
  if (!item || item.role !== "assistant" || !Array.isArray(item.content)) return message;

  const content = item.content;
  const orderedContent = orderAssistantContentParts(content);
  if (orderedContent.every((part, index) => part === content[index])) return message;
  return {
    ...item,
    content: orderedContent
  };
}
