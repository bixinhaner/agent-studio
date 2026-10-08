import { describe, expect, it } from "vitest";

import { composeUserInputAnswer, parseUserInputRequestData, userInputAnswerFromMetadata } from "./user-input-request";

describe("ask-while-working question cards", () => {
  it("parses stored question parts and drops empty or duplicate options", () => {
    expect(
      parseUserInputRequestData({
        id: "call_1",
        questions: [{ title: " Region? ", options: ["Jakarta", "Jakarta", "", "Singapore"] }, { title: "" }],
        text: "Region?",
        asked_at: "2026-10-08T01:00:00.000Z"
      })
    ).toEqual({
      id: "call_1",
      questions: [{ title: "Region?", options: ["Jakarta", "Singapore"] }],
      text: "Region?",
      askedAt: "2026-10-08T01:00:00.000Z"
    });
    expect(parseUserInputRequestData({ id: "call_1", questions: [] })).toBeNull();
    expect(parseUserInputRequestData(null)).toBeNull();
  });

  it("answers one question plainly and several questions line by line", () => {
    const line = (title: string, answer: string) => `Re ${title}: ${answer}`;
    expect(composeUserInputAnswer([{ title: "Region?", options: [] }], ["Jakarta"], (_title, answer) => answer)).toBe("Jakarta");
    expect(
      composeUserInputAnswer(
        [
          { title: "Region?", options: ["Jakarta"] },
          { title: "Notes?", options: [] }
        ],
        ["Jakarta", "Use spot instances"],
        line
      )
    ).toBe("Re Region?: Jakarta\nRe Notes?: Use spot instances");
  });

  it("reads answer metadata from follow-up messages", () => {
    expect(userInputAnswerFromMetadata({ custom: { user_input_answer: { request_id: "call_1", assistant_message_id: "a1" } } }))
      .toEqual({ request_id: "call_1", assistant_message_id: "a1" });
    expect(userInputAnswerFromMetadata({ custom: {} })).toBeNull();
  });
});
