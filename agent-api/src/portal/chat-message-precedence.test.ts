import { describe, expect, it } from "vitest";

import {
  portalAssistantMessageIsComplete,
  preserveCompletedPortalAssistantMessage,
  repairPortalAssistantCompletionStatus
} from "./chat-message-precedence.js";

describe("portal assistant message precedence", () => {
  it("recognizes both current and legacy completed status values", () => {
    expect(portalAssistantMessageIsComplete({ status: { type: "complete" } })).toBe(true);
    expect(portalAssistantMessageIsComplete({ status: { type: "completed" } })).toBe(true);
    expect(portalAssistantMessageIsComplete({ status: { type: "incomplete" } })).toBe(false);
  });

  it("does not let a stale client failure overwrite a server-completed answer", () => {
    const existing = { id: "assistant-1", content: [{ type: "text", text: "完整回答" }], status: { type: "complete" } };
    const incoming = { id: "assistant-1", content: [], status: { type: "incomplete", reason: "error" } };
    expect(preserveCompletedPortalAssistantMessage({ existing, incoming })).toBe(existing);
  });

  it("allows a completed server answer to replace an earlier incomplete message", () => {
    const existing = { id: "assistant-1", status: { type: "incomplete" } };
    const incoming = { id: "assistant-1", status: { type: "complete" } };
    expect(preserveCompletedPortalAssistantMessage({ existing, incoming })).toBe(incoming);
  });

  it("repairs historical stale failures only when a completed process event is present", () => {
    const completed = {
      role: "assistant",
      status: { type: "incomplete", reason: "error" },
      content: [
        { type: "text", text: "完整回答" },
        { type: "data", name: "codex_process", data: { kind: "done", title: "Response completed" } }
      ]
    };
    expect(repairPortalAssistantCompletionStatus(completed)).toMatchObject({
      status: { type: "complete", reason: "stop" }
    });
    expect(repairPortalAssistantCompletionStatus({
      ...completed,
      content: [{ type: "text", text: "只有过程内容" }]
    })).toMatchObject({ status: { type: "incomplete" } });
  });
});
