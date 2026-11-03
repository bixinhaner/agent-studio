import { describe, expect, it } from "vitest";

import { portalLiveAssistantMessage, portalLiveAssistantMessageId } from "./chat-live-answer.js";

describe("portalLiveAssistantMessage", () => {
  it("shows the process parts and the answer streamed so far as a running message", () => {
    const message = portalLiveAssistantMessage({
      id: "assistant-1",
      runId: "run-1",
      acceptedAt: "2026-11-03T10:00:00.000Z",
      partial: {
        answerText: "正在整理结果",
        contentParts: [{ type: "data", name: "codex_trace", data: { rows: [] } }]
      }
    });
    expect(message.status).toEqual({ type: "running" });
    expect(message.createdAt).toBe("2026-11-03T10:00:00.000Z");
    expect(message.content).toEqual([
      { type: "data", name: "codex_trace", data: { rows: [] } },
      { type: "text", text: "正在整理结果" }
    ]);
    expect(message.metadata.custom).toMatchObject({ runId: "run-1", live: true });
  });

  it("has no text part before the answer starts, so the client shows the running state", () => {
    const message = portalLiveAssistantMessage({ id: "a", runId: "run-1" });
    expect(message.content).toEqual([]);
    expect(message.status.type).toBe("running");
  });

  it("keeps one id per run", () => {
    expect(portalLiveAssistantMessageId({ runId: "run-1", assistantMessageId: "assistant-9" })).toBe("assistant-9");
    expect(portalLiveAssistantMessageId({ runId: "run-1" })).toBe("portal-live-run-1");
  });
});
