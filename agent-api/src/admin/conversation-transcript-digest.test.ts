import { describe, expect, it } from "vitest";

import { buildConversationTranscriptDigest } from "./conversation-audit-router.js";

function item(id: string, role: "user" | "assistant", text: string) {
  return { parentId: null, message: { id, role, content: [{ type: "text", text }] } };
}

describe("buildConversationTranscriptDigest", () => {
  it("summarizes counts and previews from the transcript", () => {
    const digest = buildConversationTranscriptDigest("t1", [
      item("m1", "user", "第一个问题"),
      item("m2", "assistant", "回答一"),
      item("m3", "user", "追问")
    ] as never);
    expect(digest).toMatchObject({
      firstUserText: "第一个问题",
      latestText: "追问",
      messageCount: 3,
      userMessageCount: 2,
      assistantMessageCount: 1,
      userAttachmentCount: 0
    });
  });

  it("handles threads without messages", () => {
    expect(buildConversationTranscriptDigest("t2", [])).toMatchObject({ firstUserText: null, latestText: null, messageCount: 0 });
  });
});
