/**
 * A thread is one linear timeline shared by every client (phone, desktop, other tabs,
 * DingTalk, ...). The model context behind it (the Codex thread) is linear and cannot
 * be rewound, so the stored conversation must not branch either: every new message is
 * attached after the thread's last message, whatever parent the writer asked for.
 *
 * When the writer asked for a different parent (a stale client view, or an assistant
 * answering a question that is no longer the last message), that parent is kept in the
 * run config. For assistants it is the question they answer; for user messages it
 * records which view the message was sent from.
 */
export const REQUESTED_PARENT_RUN_CONFIG_KEY = "_agentStudioRequestedParentId";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalized(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function requestedParentIdOf(runConfig: unknown): string | null {
  return normalized(asRecord(runConfig)?.[REQUESTED_PARENT_RUN_CONFIG_KEY]);
}

/** The run config to store when a message asked for `requested` but is attached after `actual`. */
export function runConfigWithRequestedParent<T>(
  runConfig: T,
  requested: string | null | undefined,
  actual: string | null
): T | Record<string, unknown> {
  const requestedId = normalized(requested);
  if (!requestedId || requestedId === actual) return runConfig;
  return { ...(asRecord(runConfig) ?? {}), [REQUESTED_PARENT_RUN_CONFIG_KEY]: requestedId };
}

/** The message an item replies to: its requested parent when the timeline moved it, else its parent. */
export function replyToMessageId(item: { parentId?: string | null; runConfig?: unknown }): string | null {
  return requestedParentIdOf(item.runConfig) ?? normalized(item.parentId);
}

/** The last message of a timeline ordered by position; new messages attach to it. */
export function timelineTailId(messages: Array<{ externalId: string | null; position: number }>): string | null {
  let tail: { externalId: string | null; position: number } | undefined;
  for (const message of messages) {
    if (!message.externalId) continue;
    if (!tail || message.position > tail.position) tail = message;
  }
  return tail?.externalId ?? null;
}
