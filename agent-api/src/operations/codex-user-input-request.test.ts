import { describe, expect, it } from "vitest";

import {
  CODEX_USER_INPUT_REQUEST_PART_NAME,
  codexUserInputAnswerFromMessageMetadata,
  codexUserInputRequestFromItem,
  codexUserInputRequestToContentPart,
  codexUserInputRequestsFromContent,
  normalizeCodexUserInputQuestions
} from "./codex-user-input-request.js";

describe("codex user input requests", () => {
  it("reads question requests from agent message items", () => {
    const request = codexUserInputRequestFromItem(
      {
        id: "call_1",
        type: "agentMessage",
        text: "Which region should I use?",
        phase: "final_answer",
        questions: [{ title: " Which region? ", options: ["Jakarta", "Jakarta", " ", "Singapore"] }, { title: "Notes", options: null }]
      },
      "2026-10-08T01:00:00.000Z"
    );
    expect(request).toEqual({
      id: "call_1",
      questions: [
        { title: "Which region?", options: ["Jakarta", "Singapore"] },
        { title: "Notes", options: [] }
      ],
      text: "Which region should I use?",
      askedAt: "2026-10-08T01:00:00.000Z"
    });
  });

  it("ignores agent messages without questions or ids and other items", () => {
    expect(codexUserInputRequestFromItem({ id: "m1", type: "agent_message", text: "hi", questions: null })).toBeUndefined();
    expect(codexUserInputRequestFromItem({ type: "agent_message", questions: [{ title: "Q" }] })).toBeUndefined();
    expect(codexUserInputRequestFromItem({ id: "r", type: "reasoning", questions: [{ title: "Q" }] })).toBeUndefined();
  });

  it("caps question and option counts", () => {
    const questions = normalizeCodexUserInputQuestions(
      Array.from({ length: 12 }, (_, index) => ({
        title: `Q${index}`,
        options: Array.from({ length: 12 }, (_, option) => `O${option}`)
      }))
    );
    expect(questions).toHaveLength(8);
    expect(questions[0]!.options).toHaveLength(8);
  });

  it("round-trips requests through stored content parts", () => {
    const request = { id: "call_2", questions: [{ title: "Pick one", options: ["A", "B"] }], askedAt: "2026-10-08T01:00:00.000Z" };
    const part = codexUserInputRequestToContentPart(request);
    expect(part).toMatchObject({ type: "data", name: CODEX_USER_INPUT_REQUEST_PART_NAME });
    expect(codexUserInputRequestsFromContent([{ type: "text", text: "x" }, part])).toEqual([request]);
    expect(codexUserInputRequestsFromContent("not-an-array")).toEqual([]);
  });

  it("reads answer metadata from portal follow-up messages", () => {
    expect(
      codexUserInputAnswerFromMessageMetadata({
        metadata: { custom: { user_input_answer: { request_id: "call_2", assistant_message_id: "a1" } } }
      })
    ).toEqual({ request_id: "call_2", assistant_message_id: "a1" });
    expect(codexUserInputAnswerFromMessageMetadata({ metadata: { custom: {} } })).toBeUndefined();
  });
});
