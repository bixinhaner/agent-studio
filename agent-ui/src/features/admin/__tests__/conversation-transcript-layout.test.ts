import { describe, expect, it } from "vitest";

import { buildTranscriptProcessTimeline, layoutTranscript } from "../conversation-transcript-layout";
import { conversationAuditMarkdownUrlTransform } from "../ConversationAuditView";
import type { AdminConversationTranscriptMessage } from "../types";

function message(
  id: string,
  role: "user" | "assistant",
  extra: Partial<AdminConversationTranscriptMessage> = {}
): AdminConversationTranscriptMessage {
  return { id, role, text: id, attachments: [], parentId: null, createdAt: null, hasRunConfig: false, ...extra };
}

describe("layoutTranscript", () => {
  it("keeps the flat list when no branch info is present", () => {
    const items = layoutTranscript([message("u1", "user"), message("a1", "assistant")]);
    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("shows the active path and folds other versions after their active sibling", () => {
    const active = (index = 1, count = 1) => ({ active: true, siblingIndex: index, siblingCount: count, divergesFromId: null });
    const items = layoutTranscript([
      message("u1", "user", { branch: active() }),
      message("u2-old", "user", { branch: { active: false, siblingIndex: 1, siblingCount: 2, divergesFromId: "u2" } }),
      message("a2-old", "assistant", { branch: { active: false, siblingIndex: 1, siblingCount: 1, divergesFromId: "u2" } }),
      message("u2", "user", { branch: active(2, 2) }),
      message("a2", "assistant", { branch: active() })
    ]);
    expect(items.map((item) => (item.kind === "message" ? item.message.id : `alt:${item.messages.map((m) => m.id).join(",")}`)))
      .toEqual(["u1", "u2", "alt:u2-old,a2-old", "a2"]);
  });
});

describe("buildTranscriptProcessTimeline", () => {
  it("merges questions, answers and steers into the runtime steps by time", () => {
    const rows = buildTranscriptProcessTimeline(message("a1", "assistant", {
      processRows: [
        { id: "p1", kind: "tool", title: "Search", at: "2026-10-08T01:00:00.000Z" },
        { id: "p2", kind: "tool", title: "Write", at: "2026-10-08T01:00:30.000Z" }
      ],
      userInputRequests: [{
        id: "call_1",
        questions: [{ title: "Audience?", options: ["Team", "Leads"] }],
        text: null,
        askedAt: "2026-10-08T01:00:10.000Z",
        answer: { text: "Team", via: "steer", at: "2026-10-08T01:00:20.000Z", messageId: null },
        status: "answered"
      }],
      steerEvents: [{
        id: "s2",
        message: "add a summary",
        status: "accepted",
        errorCode: null,
        userInputRequestId: null,
        createdAt: "2026-10-08T01:00:40.000Z"
      }]
    }));
    expect(rows.map((row) => `${row.source}:${row.title}`)).toEqual([
      "process:Search",
      "question:助手提问：Audience?",
      "answer:用户回答（运行中送达）",
      "process:Write",
      "steer:用户运行中引导"
    ]);
  });
});

describe("conversationAuditMarkdownUrlTransform", () => {
  it("keeps portal inline reference schemes and still strips unsafe ones", () => {
    const transform = conversationAuditMarkdownUrlTransform as (url: string, key: string) => string;
    expect(transform("skill:weekly-report", "href")).toBe("skill:weekly-report");
    expect(transform("attachment:abc123", "href")).toBe("attachment:abc123");
    expect(transform("javascript:alert(1)", "href")).toBe("");
  });
});
