import { createContext, useContext, useMemo, type FC } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike
} from "@assistant-ui/react";

import { reviveMessage } from "./thread-message-persistence";
import type { ThreadLiveOut } from "./portal-api-types";

/**
 * A task is one conversation on every device. When its response runs on another device
 * or tab, this page does not stream it; it polls what the response has produced so far
 * and shows it read-only below the question, until the finished answer is loaded.
 */
export type PortalLiveAnswer = {
  threadId: string;
  runId: string;
  /** The question being answered; the live answer shows only right after it. */
  userMessageId: string;
  message: ThreadMessageLike;
};

/** Set only for the open task. */
export const PortalLiveAnswerContext = createContext<PortalLiveAnswer | undefined>(undefined);

export function portalLiveAnswerFromOut(threadId: string, out: ThreadLiveOut): PortalLiveAnswer | undefined {
  if (!out.running) return undefined;
  const userMessageId = String(out.user_message_id || "").trim();
  const message = reviveMessage(out.message) as ThreadMessageLike | undefined;
  if (!userMessageId || !message || typeof message !== "object" || message.role !== "assistant") return undefined;
  return {
    threadId,
    runId: out.run_id,
    userMessageId,
    // Always shown as running: the finished answer comes from the history.
    message: { ...message, status: { type: "running" } }
  };
}

/** Whether the live answer belongs right after the last message of this page's timeline. */
export function shouldShowLiveAnswer(
  answer: PortalLiveAnswer | undefined,
  lastMessage: { id: string; role: string } | undefined
): answer is PortalLiveAnswer {
  return Boolean(
    answer &&
      lastMessage?.role === "user" &&
      lastMessage.id === answer.userMessageId
  );
}

const LiveAnswerThread: FC<{ answer: PortalLiveAnswer; AssistantMessage: FC }> = ({ answer, AssistantMessage }) => {
  const messages = useMemo(() => [answer.message], [answer.message]);
  // A separate runtime keeps the mirrored answer out of this page's own timeline: it is
  // never sent, edited, rated or used as the parent of a new message.
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: true,
    convertMessage: (message) => message,
    onNew: async () => undefined
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ UserMessage: () => null, AssistantMessage }} />
    </AssistantRuntimeProvider>
  );
};

/** Renders the live answer with the regular assistant message view, inside the thread viewport. */
export const PortalLiveAnswerView: FC<{ AssistantMessage: FC }> = ({ AssistantMessage }) => {
  const answer = useContext(PortalLiveAnswerContext);
  const lastMessageId = useAuiState((state) => state.thread.messages.at(-1)?.id ?? "");
  const lastMessageRole = useAuiState((state) => state.thread.messages.at(-1)?.role ?? "");
  const visibleAnswer = shouldShowLiveAnswer(
    answer,
    lastMessageId ? { id: lastMessageId, role: lastMessageRole } : undefined
  )
    ? answer
    : undefined;
  if (!visibleAnswer) return null;
  return (
    <div className="portal-live-answer" aria-busy="true">
      <LiveAnswerThread key={visibleAnswer.runId} answer={visibleAnswer} AssistantMessage={AssistantMessage} />
    </div>
  );
};
