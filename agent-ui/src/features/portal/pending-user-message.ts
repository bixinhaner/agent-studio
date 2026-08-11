type MessageRecord = Record<string, unknown>;

function asRecord(value: unknown): MessageRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MessageRecord
    : undefined;
}

export function pendingPortalUserMessageAppend(input: {
  messageId?: string;
  parentId?: string | null;
  message: unknown;
}): {
  parent_id: string | null;
  message: MessageRecord;
  run_config: { channel: "portal"; pendingUserMessage: true };
} {
  const messageId = input.messageId?.trim();
  const message = asRecord(input.message);
  if (!messageId || !message || message.role !== "user") {
    throw new Error("The user message could not be prepared for sending. Please retry.");
  }
  return {
    parent_id: input.parentId?.trim() || null,
    message: {
      ...message,
      id: messageId,
      role: "user"
    },
    run_config: {
      channel: "portal",
      pendingUserMessage: true
    }
  };
}
