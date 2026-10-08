import {
  codexUserInputAnswerFromMessageMetadata,
  codexUserInputRequestsFromContent,
  type CodexUserInputQuestion
} from "../operations/codex-user-input-request.js";
import type { PortalSteerEventRecord } from "../persistence/portal-steer-event-repository.js";

/**
 * Mirrors the portal's live interaction (mid-run steers and "ask while working"
 * question cards) onto the admin transcript so administrators see the same process
 * the user saw, including how each assistant question was answered.
 */

export type TranscriptSteerEvent = {
  id: string;
  message: string;
  status: PortalSteerEventRecord["status"];
  errorCode: string | null;
  userInputRequestId: string | null;
  createdAt: string;
};

export type TranscriptUserInputAnswer = {
  text: string;
  /** steer = answered while the response was still running; message = answered as a follow-up message. */
  via: "steer" | "message";
  at: string | null;
  messageId: string | null;
};

export type TranscriptUserInputRequest = {
  id: string;
  questions: CodexUserInputQuestion[];
  text: string | null;
  askedAt: string | null;
  answer: TranscriptUserInputAnswer | null;
  /** answered | pending (no later user input yet) | skipped (user continued without answering) */
  status: "answered" | "pending" | "skipped";
};

type TranscriptMessageLike = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  parentId: string | null;
  createdAt: string | null;
  steerEvents?: TranscriptSteerEvent[];
  userInputRequests?: TranscriptUserInputRequest[];
};

function steerOut(event: PortalSteerEventRecord): TranscriptSteerEvent {
  return {
    id: event.id,
    message: event.message,
    status: event.status,
    errorCode: event.errorCode ?? null,
    userInputRequestId: event.userInputRequestId ?? null,
    createdAt: event.createdAt
  };
}

export function attachTranscriptInteractions<T extends TranscriptMessageLike>(
  transcript: T[],
  rawMessages: unknown[],
  steerEvents: PortalSteerEventRecord[] = []
): T[] {
  const assistantIndexByParent = new Map<string, number>();
  transcript.forEach((message, index) => {
    if (message.role === "assistant" && message.parentId && !assistantIndexByParent.has(message.parentId)) {
      assistantIndexByParent.set(message.parentId, index);
    }
  });
  const lastAssistantIndex = transcript.map((message) => message.role).lastIndexOf("assistant");

  const steersByIndex = new Map<number, TranscriptSteerEvent[]>();
  for (const event of steerEvents) {
    // Only steers that reached (or tried to reach) the model are part of the record.
    if (event.status === "pending") continue;
    const anchored = event.sourceUserMessageId ? assistantIndexByParent.get(event.sourceUserMessageId) : undefined;
    const index = anchored ?? lastAssistantIndex;
    if (index < 0) continue;
    steersByIndex.set(index, [...(steersByIndex.get(index) ?? []), steerOut(event)]);
  }

  const acceptedSteerAnswers = new Map<string, PortalSteerEventRecord>();
  for (const event of steerEvents) {
    if (event.status === "accepted" && event.userInputRequestId && !acceptedSteerAnswers.has(event.userInputRequestId)) {
      acceptedSteerAnswers.set(event.userInputRequestId, event);
    }
  }
  const messageAnswers = new Map<string, { index: number }>();
  rawMessages.forEach((raw, index) => {
    if (transcript[index]?.role !== "user") return;
    const answer = codexUserInputAnswerFromMessageMetadata(raw);
    if (answer && !messageAnswers.has(answer.request_id)) messageAnswers.set(answer.request_id, { index });
  });

  return transcript.map((message, index) => {
    const steers = steersByIndex.get(index);
    if (message.role !== "assistant") return message;
    const requests = codexUserInputRequestsFromContent((rawMessages[index] as { content?: unknown } | undefined)?.content);
    if (!steers && requests.length === 0) return message;
    const hasLaterUserMessage = transcript.slice(index + 1).some((candidate) => candidate.role === "user");
    const userInputRequests = requests.map<TranscriptUserInputRequest>((request) => {
      const steer = acceptedSteerAnswers.get(request.id);
      const followUp = messageAnswers.get(request.id);
      const answer: TranscriptUserInputAnswer | null = steer
        ? { text: steer.message, via: "steer", at: steer.resolvedAt ?? steer.createdAt, messageId: null }
        : followUp
          ? {
              text: transcript[followUp.index]?.text ?? "",
              via: "message",
              at: transcript[followUp.index]?.createdAt ?? null,
              messageId: transcript[followUp.index]?.id ?? null
            }
          : null;
      return {
        id: request.id,
        questions: request.questions,
        text: request.text ?? null,
        askedAt: request.askedAt || null,
        answer,
        status: answer ? "answered" : hasLaterUserMessage ? "skipped" : "pending"
      };
    });
    return {
      ...message,
      ...(steers ? { steerEvents: steers } : {}),
      ...(userInputRequests.length > 0 ? { userInputRequests } : {})
    };
  });
}
