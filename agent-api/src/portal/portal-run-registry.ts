import type { SessionRecord } from "../persistence/session-repository.js";
import type { PortalPartialAssistantSnapshot } from "./chat-partial-answer.js";

// In-process registry of portal responses this chat instance is producing. Runs are keyed by
// session; single-request sends are keyed by run id until their session has started.

function trimOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

export type PortalActiveChatRun = {
  userId: string;
  organizationId: string;
  controller: AbortController;
  createdAt: number;
  runId: string;
  traceId?: string;
  session?: SessionRecord;
  threadId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  assistantMessageWritten?: boolean;
  /** Snapshot of what the run has produced so far, kept by a stop so the partial answer survives a refresh. */
  partialSnapshot?: () => PortalPartialAssistantSnapshot;
  /** Aborted when a retiring chat instance reaches its limit; the turn ends as "interrupted by a system update". */
  systemInterrupt?: AbortController;
  acceptedAt: string;
};

export const portalActiveChatRuns = new Map<string, PortalActiveChatRun>();
/**
 * Single-request sends between accepting the message and starting the runtime session
 * (a few seconds), keyed by run id. They block another send on the thread, show as
 * running and can be stopped, like runs registered under their session.
 */
export const portalPreflightChatRuns = new Map<string, PortalActiveChatRun>();
export const PORTAL_ACTIVE_CHAT_RUN_TTL_MS = 2 * 60 * 60_000;

export function gcPortalActiveChatRuns(): void {
  const cutoff = Date.now() - PORTAL_ACTIVE_CHAT_RUN_TTL_MS;
  for (const [sessionId, entry] of portalActiveChatRuns.entries()) {
    if (entry.createdAt < cutoff) {
      portalActiveChatRuns.delete(sessionId);
    }
  }
  for (const [runId, entry] of portalPreflightChatRuns.entries()) {
    if (entry.createdAt < cutoff) {
      portalPreflightChatRuns.delete(runId);
    }
  }
}

/**
 * Returns the response that is still running for this session, if any. A new portal
 * message must not start (and must not abort it); the client queues or steers instead.
 */
export function findBlockingPortalActiveChatRun(
  sessionId: string,
  userId: string,
  threadId?: string,
  /** The caller's own run, which a single-request send registered while starting its session. */
  excludeRunId?: string
): PortalActiveChatRun | undefined {
  gcPortalActiveChatRuns();
  const live = (run: PortalActiveChatRun | undefined) =>
    run && run.userId === userId && !run.controller.signal.aborted && !run.systemInterrupt?.signal.aborted
      ? run
      : undefined;
  const normalizedSessionId = trimOrUndefined(sessionId);
  const bySession = normalizedSessionId ? live(portalActiveChatRuns.get(normalizedSessionId)) : undefined;
  if (bySession) return bySession;
  // Sessions are per tab, so a reloaded or second tab reaches the same thread with a new session id.
  const normalizedThreadId = trimOrUndefined(threadId);
  if (!normalizedThreadId) return undefined;
  for (const run of [...portalActiveChatRuns.values(), ...portalPreflightChatRuns.values()]) {
    if (excludeRunId && run.runId === excludeRunId) continue;
    const runThreadId = trimOrUndefined(run.session?.threadId) ?? run.threadId;
    if (runThreadId === normalizedThreadId && live(run)) return run;
  }
  return undefined;
}

/** A live run of this user with the client's run id: a retried send of a message already accepted. */
export function findPortalChatRunById(runId: string, userId: string): PortalActiveChatRun | undefined {
  gcPortalActiveChatRuns();
  const normalizedRunId = trimOrUndefined(runId);
  if (!normalizedRunId) return undefined;
  const preflight = portalPreflightChatRuns.get(normalizedRunId);
  if (preflight && preflight.userId === userId && !preflight.controller.signal.aborted) return preflight;
  for (const run of portalActiveChatRuns.values()) {
    if (run.runId === normalizedRunId && run.userId === userId && !run.controller.signal.aborted) return run;
  }
  return undefined;
}

export function registerPortalPreflightChatRun(input: {
  runId: string;
  userId: string;
  organizationId: string;
  controller: AbortController;
  systemInterrupt?: AbortController;
  threadId: string;
  userMessageId?: string;
  traceId?: string;
  assistantMessageId?: string;
  acceptedAt?: string;
}): () => void {
  gcPortalActiveChatRuns();
  portalPreflightChatRuns.set(input.runId, {
    userId: input.userId,
    organizationId: input.organizationId,
    controller: input.controller,
    systemInterrupt: input.systemInterrupt,
    createdAt: Date.now(),
    runId: input.runId,
    traceId: trimOrUndefined(input.traceId),
    threadId: input.threadId,
    userMessageId: trimOrUndefined(input.userMessageId),
    assistantMessageId: trimOrUndefined(input.assistantMessageId),
    acceptedAt: trimOrUndefined(input.acceptedAt) ?? new Date().toISOString()
  });
  return () => {
    if (portalPreflightChatRuns.get(input.runId)?.controller === input.controller) {
      portalPreflightChatRuns.delete(input.runId);
    }
  };
}

/** The single-request send on this thread that is still starting its session. */
export function findPortalPreflightChatRun(input: { userId: string; threadId?: string; runId?: string }): PortalActiveChatRun | undefined {
  gcPortalActiveChatRuns();
  const runId = trimOrUndefined(input.runId);
  const threadId = trimOrUndefined(input.threadId);
  for (const run of portalPreflightChatRuns.values()) {
    if (run.userId !== input.userId || run.controller.signal.aborted) continue;
    if (runId ? run.runId === runId : threadId && run.threadId === threadId) return run;
  }
  return undefined;
}

