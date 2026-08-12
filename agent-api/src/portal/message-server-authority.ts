export type PortalRepositoryMessage = {
  parentId?: string | null;
  message: unknown;
  runConfig?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

type PortalRepositorySnapshot = {
  headId?: string | null;
  messages: PortalRepositoryMessage[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalized(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim() : "";
  return result || undefined;
}

export function portalRepositoryMessageId(message: unknown): string | undefined {
  return normalized(asRecord(message)?.id);
}

export function isPortalAssistantMessage(message: unknown): boolean {
  return normalized(asRecord(message)?.role) === "assistant";
}

/**
 * Portal assistant messages are runtime output. Browsers may render a live
 * projection, but only the API process is allowed to persist that projection.
 */
export function shouldIgnorePortalClientMessageAppend(message: unknown): boolean {
  return isPortalAssistantMessage(message);
}

/**
 * Older assistant-ui clients can still issue a repository replacement. Keep
 * every server-owned assistant snapshot byte-for-byte, allow user messages to
 * be updated or appended, and ignore client-provided assistant projections.
 */
export function mergePortalClientRepositoryReplacement(input: {
  current: PortalRepositorySnapshot;
  incoming: PortalRepositorySnapshot;
}): PortalRepositorySnapshot {
  const incomingUsersById = new Map<string, PortalRepositoryMessage>();
  const incomingUserOrder: string[] = [];

  for (const item of input.incoming.messages) {
    if (isPortalAssistantMessage(item.message)) continue;
    const id = portalRepositoryMessageId(item.message);
    if (!id) continue;
    incomingUsersById.set(id, item);
    incomingUserOrder.push(id);
  }

  const merged = input.current.messages.map((item) => {
    if (isPortalAssistantMessage(item.message)) return item;
    const id = portalRepositoryMessageId(item.message);
    if (!id) return item;
    const incoming = incomingUsersById.get(id);
    if (!incoming) return item;
    incomingUsersById.delete(id);
    return incoming;
  });

  for (const id of incomingUserOrder) {
    const incoming = incomingUsersById.get(id);
    if (!incoming) continue;
    merged.push(incoming);
    incomingUsersById.delete(id);
  }

  const knownIds = new Set(merged.map((item) => portalRepositoryMessageId(item.message)).filter(Boolean));
  const requestedHeadId = normalized(input.incoming.headId);
  return {
    headId: requestedHeadId && knownIds.has(requestedHeadId)
      ? requestedHeadId
      : normalized(input.current.headId) ?? null,
    messages: merged
  };
}
