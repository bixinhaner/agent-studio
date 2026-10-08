import { describe, expect, it } from "vitest";

import { codexUserInputRequestToContentPart } from "../operations/codex-user-input-request.js";
import type { PortalSteerEventRecord } from "../persistence/portal-steer-event-repository.js";
import {
  attachTranscriptInteractions,
  type TranscriptSteerEvent,
  type TranscriptUserInputRequest
} from "./conversation-transcript-interactions.js";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  parentId: string | null;
  createdAt: string | null;
  steerEvents?: TranscriptSteerEvent[];
  userInputRequests?: TranscriptUserInputRequest[];
};

function steer(input: Partial<PortalSteerEventRecord> & Pick<PortalSteerEventRecord, "id" | "message">): PortalSteerEventRecord {
  return {
    threadId: "t1",
    organizationId: "o1",
    userId: "u1",
    sessionId: "s1",
    status: "accepted",
    createdAt: "2026-10-08T01:00:10.000Z",
    updatedAt: "2026-10-08T01:00:10.000Z",
    ...input
  } as PortalSteerEventRecord;
}

const question = codexUserInputRequestToContentPart({
  id: "call_1",
  questions: [{ title: "Which region?", options: ["Jakarta", "Singapore"] }],
  text: "Which region?",
  askedAt: "2026-10-08T01:00:05.000Z"
});

describe("attachTranscriptInteractions", () => {
  it("attaches steers to the response they guided and resolves steer answers", () => {
    const transcript: Message[] = [
      { id: "u1", role: "user", text: "Deploy it", parentId: null, createdAt: "2026-10-08T01:00:00.000Z" },
      { id: "a1", role: "assistant", text: "Done", parentId: "u1", createdAt: "2026-10-08T01:01:00.000Z" }
    ];
    const raw = [{ content: [] }, { content: [{ type: "text", text: "Done" }, question] }];
    const result = attachTranscriptInteractions(transcript, raw, [
      steer({ id: "s-answer", message: "Jakarta", sourceUserMessageId: "u1", userInputRequestId: "call_1" }),
      steer({ id: "s-guide", message: "Skip tests", sourceUserMessageId: "u1" }),
      steer({ id: "s-pending", message: "ignored", status: "pending", sourceUserMessageId: "u1" })
    ]);
    expect(result[0]).toEqual(transcript[0]);
    expect(result[1]!.steerEvents?.map((event) => event.id)).toEqual(["s-answer", "s-guide"]);
    expect(result[1]!.userInputRequests).toEqual([
      expect.objectContaining({
        id: "call_1",
        status: "answered",
        answer: expect.objectContaining({ text: "Jakarta", via: "steer" })
      })
    ]);
  });

  it("resolves follow-up message answers and marks unanswered questions", () => {
    const transcript: Message[] = [
      { id: "u1", role: "user", text: "Deploy it", parentId: null, createdAt: null },
      { id: "a1", role: "assistant", text: "", parentId: "u1", createdAt: null },
      { id: "u2", role: "user", text: "Singapore", parentId: "a1", createdAt: "2026-10-08T01:02:00.000Z" },
      { id: "a2", role: "assistant", text: "", parentId: "u2", createdAt: null }
    ];
    const followUpQuestion = codexUserInputRequestToContentPart({
      id: "call_2",
      questions: [{ title: "Notes?", options: [] }],
      askedAt: ""
    });
    const raw = [
      {},
      { content: [question] },
      { metadata: { custom: { user_input_answer: { request_id: "call_1" } } } },
      { content: [followUpQuestion] }
    ];
    const result = attachTranscriptInteractions(transcript, raw, []);
    expect(result[1]!.userInputRequests?.[0]).toMatchObject({
      status: "answered",
      answer: { text: "Singapore", via: "message", messageId: "u2" }
    });
    expect(result[3]!.userInputRequests?.[0]).toMatchObject({ id: "call_2", status: "pending", answer: null, askedAt: null });
  });

  it("marks questions skipped when the user continued without answering", () => {
    const transcript: Message[] = [
      { id: "a1", role: "assistant", text: "", parentId: null, createdAt: null },
      { id: "u2", role: "user", text: "Never mind", parentId: "a1", createdAt: null }
    ];
    const result = attachTranscriptInteractions(transcript, [{ content: [question] }, {}], []);
    expect(result[0]!.userInputRequests?.[0]?.status).toBe("skipped");
  });
});
