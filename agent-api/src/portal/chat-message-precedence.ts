function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function portalAssistantMessageIsComplete(message: unknown): boolean {
  const status = asRecord(asRecord(message)?.status);
  const type = typeof status?.type === "string" ? status.type.trim().toLowerCase() : "";
  return type === "complete" || type === "completed" || portalAssistantMessageHasCompletionEvidence(message);
}

export function portalAssistantMessageHasCompletionEvidence(message: unknown): boolean {
  const content = asRecord(message) && Array.isArray(asRecord(message)?.content)
    ? asRecord(message)?.content as unknown[]
    : [];
  return content.some((part) => {
    const item = asRecord(part);
    if (item?.type !== "data") return false;
    const data = asRecord(item.data);
    if (item.name === "codex_process" && data?.kind === "done") return true;
    if (item.name !== "codex_trace_batch") return false;
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    return rows.some((row) => asRecord(row)?.kind === "done");
  });
}

export function repairPortalAssistantCompletionStatus(message: unknown): unknown {
  const record = asRecord(message);
  if (!record || record.role !== "assistant" || !portalAssistantMessageHasCompletionEvidence(message)) return message;
  const status = asRecord(record.status);
  const type = typeof status?.type === "string" ? status.type.trim().toLowerCase() : "";
  if (type === "complete" || type === "completed") return message;
  return {
    ...record,
    status: { type: "complete", reason: "stop" }
  };
}

export function preserveCompletedPortalAssistantMessage(input: {
  existing: unknown;
  incoming: unknown;
}): unknown {
  if (portalAssistantMessageIsComplete(input.existing) && !portalAssistantMessageIsComplete(input.incoming)) {
    return repairPortalAssistantCompletionStatus(input.existing);
  }
  return input.incoming;
}
