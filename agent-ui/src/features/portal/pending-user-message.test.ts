import { describe, expect, it } from "vitest";

import { pendingPortalUserMessageAppend } from "./pending-user-message";

describe("pending Portal user message", () => {
  it("builds an idempotent user append before session initialization", () => {
    expect(pendingPortalUserMessageAppend({
      messageId: "user-1",
      parentId: "assistant-0",
      message: {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "Compare these PDFs" }]
      }
    })).toEqual({
      parent_id: "assistant-0",
      message: {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "Compare these PDFs" }]
      },
      run_config: {
        channel: "portal",
        pendingUserMessage: true
      }
    });
  });

  it("rejects missing user identity instead of allowing an orphan assistant", () => {
    expect(() => pendingPortalUserMessageAppend({
      message: { role: "user", content: [] }
    })).toThrow("could not be prepared");
  });
});
