import { describe, expect, it } from "vitest";

import {
  mergePortalClientRepositoryReplacement,
  shouldIgnorePortalClientMessageAppend
} from "./message-server-authority.js";

describe("portal assistant message server authority", () => {
  it("ignores assistant snapshots posted by current or legacy browsers", () => {
    expect(shouldIgnorePortalClientMessageAppend({ role: "assistant", status: { type: "complete" } })).toBe(true);
    expect(shouldIgnorePortalClientMessageAppend({ role: "user", content: [] })).toBe(false);
  });

  it("keeps the server assistant when a legacy client replaces history with a stale failure", () => {
    const serverAssistant = {
      parentId: "user-1",
      message: {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "完整回答" }],
        status: { type: "complete" }
      },
      runConfig: { channel: "portal", runId: "run-server", serverPersisted: true }
    };
    const merged = mergePortalClientRepositoryReplacement({
      current: {
        headId: "assistant-1",
        messages: [
          { parentId: null, message: { id: "user-1", role: "user", content: [] } },
          serverAssistant
        ]
      },
      incoming: {
        headId: "assistant-1",
        messages: [
          { parentId: null, message: { id: "user-1", role: "user", content: [{ type: "text", text: "更新后的问题" }] } },
          {
            parentId: "user-1",
            message: { id: "assistant-1", role: "assistant", content: [], status: { type: "incomplete" } }
          }
        ]
      }
    });

    expect(merged.headId).toBe("assistant-1");
    expect(merged.messages[0]?.message).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "更新后的问题" }]
    });
    expect(merged.messages[1]).toBe(serverAssistant);
  });

  it("does not let a client replacement delete a server assistant snapshot", () => {
    const merged = mergePortalClientRepositoryReplacement({
      current: {
        headId: "assistant-1",
        messages: [
          { parentId: null, message: { id: "user-1", role: "user" } },
          { parentId: "user-1", message: { id: "assistant-1", role: "assistant" } }
        ]
      },
      incoming: {
        headId: "user-1",
        messages: [{ parentId: null, message: { id: "user-1", role: "user" } }]
      }
    });

    expect(merged.messages.map((item) => (item.message as { id: string }).id)).toEqual(["user-1", "assistant-1"]);
    expect(merged.headId).toBe("user-1");
  });
});
