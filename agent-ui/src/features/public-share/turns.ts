import type { ThreadMessage } from "@assistant-ui/react";

export type ThreadPublicShareTurn = {
  id: string;
  leadMessageId: string;
  messageIds: string[];
};

function isHttpUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function messageHasShareableContent(message: ThreadMessage): boolean {
  if (message.role !== "user" && message.role !== "assistant") {
    return false;
  }

  for (const part of message.content) {
    if (part.type === "text" && part.text.trim()) {
      return true;
    }
    if (part.type === "source" && isHttpUrl(part.url)) {
      return true;
    }
    if (part.type === "file" || part.type === "image" || part.type === "audio") {
      return true;
    }
  }

  return false;
}

export function groupThreadMessagesIntoPublicShareTurns(messages: readonly ThreadMessage[]): ThreadPublicShareTurn[] {
  const turns: ThreadPublicShareTurn[] = [];

  for (const message of messages) {
    if (!messageHasShareableContent(message)) {
      continue;
    }

    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
    if (message.role === "user" || !lastTurn) {
      turns.push({
        id: `turn-${turns.length + 1}`,
        leadMessageId: message.id,
        messageIds: [message.id]
      });
      continue;
    }

    lastTurn.messageIds.push(message.id);
  }

  return turns;
}
