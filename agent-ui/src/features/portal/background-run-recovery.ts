type ThreadMessagesPayload = {
  messages?: Array<{
    parent_id?: string | null;
    message?: unknown;
    run_config?: Record<string, unknown>;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function isPortalTransportDisconnect(error: unknown): boolean {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /network|fetch|socket|connection|stream|load failed|failed to fetch|terminated|closed/i.test(detail);
}

export function completedAssistantContentForParent(
  payload: ThreadMessagesPayload,
  parentId: string | undefined,
  runId?: string
): unknown[] | null {
  const normalizedParentId = String(parentId || "").trim();
  const normalizedRunId = String(runId || "").trim();
  if (!normalizedParentId) return null;
  for (let index = (payload.messages || []).length - 1; index >= 0; index -= 1) {
    const item = payload.messages?.[index];
    if (String(item?.parent_id || "").trim() !== normalizedParentId) continue;
    const message = asRecord(item?.message);
    if (message?.role !== "assistant") continue;
    if (normalizedRunId) {
      const metadata = asRecord(message.metadata);
      const custom = asRecord(metadata?.custom);
      const storedRunId = String(item?.run_config?.runId ?? item?.run_config?.run_id ?? custom?.runId ?? custom?.run_id ?? "").trim();
      if (storedRunId !== normalizedRunId) continue;
    }
    const status = asRecord(message.status);
    const statusType = typeof status?.type === "string" ? status.type.trim().toLowerCase() : "";
    if (statusType !== "complete" && statusType !== "completed") continue;
    return Array.isArray(message.content) ? message.content : [];
  }
  return null;
}
