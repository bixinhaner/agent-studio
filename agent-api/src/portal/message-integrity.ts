export type PortalMessageSummary = {
  id?: string;
  role: string;
  parentId?: string | null;
};

function normalized(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

export function assertPortalAssistantHasUserParent(input: {
  role: string;
  parentId?: string | null;
  existingMessages: PortalMessageSummary[];
}): void {
  if (input.role.trim() !== "assistant") return;
  const parentId = normalized(input.parentId);
  if (!parentId) throw new Error("Portal assistant message requires a user message parent");
  const parent = input.existingMessages.find((message) => normalized(message.id) === parentId);
  if (!parent || parent.role.trim() !== "user") {
    throw new Error("Portal assistant message parent must be an existing user message");
  }
}

export function assertPortalMessageRepositoryIntegrity(messages: PortalMessageSummary[]): void {
  const byId = new Map<string, PortalMessageSummary>();
  for (const message of messages) {
    const id = normalized(message.id);
    if (!id) throw new Error("Portal message requires an id");
    if (byId.has(id)) throw new Error("Portal message ids must be unique");
    byId.set(id, message);
  }

  for (const [id, message] of byId) {
    const parentId = normalized(message.parentId);
    if (parentId && !byId.has(parentId)) {
      throw new Error("Portal message parent must exist in the same thread");
    }
    if (parentId === id) {
      throw new Error("Portal message cannot reference itself as parent");
    }

    const visited = new Set([id]);
    let cursor = parentId;
    while (cursor) {
      if (visited.has(cursor)) {
        throw new Error("Portal message graph cannot contain a cycle");
      }
      visited.add(cursor);
      cursor = normalized(byId.get(cursor)?.parentId);
    }

    assertPortalAssistantHasUserParent({
      role: message.role,
      parentId: message.parentId,
      existingMessages: messages
    });
  }
}
