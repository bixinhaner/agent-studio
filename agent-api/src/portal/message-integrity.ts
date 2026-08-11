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
  const seen: PortalMessageSummary[] = [];
  for (const message of messages) {
    assertPortalAssistantHasUserParent({
      role: message.role,
      parentId: message.parentId,
      existingMessages: seen
    });
    seen.push(message);
  }
}
