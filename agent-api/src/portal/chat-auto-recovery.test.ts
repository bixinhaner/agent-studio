import { describe, expect, it } from "vitest";

import {
  isRetryablePortalNetworkError,
  portalAutoRecoveryFailureAssistantMessage,
  portalAutoRecoveryPrompt,
  portalRuntimeEventHasNonResumableSideEffect,
  portalRuntimeEventIndicatesTurnStarted,
  portalRuntimeEventStartsFinalAnswer,
  shouldAutoRecoverPortalChat
} from "./chat-auto-recovery.js";

describe("portal chat automatic recovery", () => {
  it.each([
    new Error("fetch failed", { cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }) }),
    Object.assign(new Error("upstream connection disconnected"), { code: "UND_ERR_SOCKET" }),
    new Error("WebSocket was closed before the response completed")
  ])("recognizes transient network failures", (error) => {
    expect(isRetryablePortalNetworkError(error)).toBe(true);
  });

  it.each([
    new Error("AI request limit reached"),
    new Error("Permission denied"),
    new Error("Session does not exist or has expired")
  ])("does not retry business or authorization failures", (error) => {
    expect(isRetryablePortalNetworkError(error)).toBe(false);
  });

  it("allows exactly one retry before final answer or external side effects", () => {
    const base = {
      error: new Error("fetch failed"),
      attempted: false,
      finalAnswerStarted: false,
      nonResumableSideEffectStarted: false,
      aborted: false
    };
    expect(shouldAutoRecoverPortalChat(base)).toBe(true);
    expect(shouldAutoRecoverPortalChat({ ...base, attempted: true })).toBe(false);
    expect(shouldAutoRecoverPortalChat({ ...base, finalAnswerStarted: true })).toBe(false);
    expect(shouldAutoRecoverPortalChat({ ...base, nonResumableSideEffectStarted: true })).toBe(false);
    expect(shouldAutoRecoverPortalChat({ ...base, aborted: true })).toBe(false);
  });

  it("recognizes when user-visible final answer text has started", () => {
    expect(portalRuntimeEventStartsFinalAnswer({
      delta: "Answer",
      raw: { item: { type: "agent_message", phase: "final-answer" } }
    })).toBe(true);
    expect(portalRuntimeEventStartsFinalAnswer({
      delta: "Working",
      raw: { item: { type: "agent_message", phase: "commentary" } }
    })).toBe(false);
  });

  it("continues an already-started runtime turn without repeating the user's instruction", () => {
    expect(portalAutoRecoveryPrompt({ originalPrompt: "check the site", firstAttemptRuntimeEventSeen: true })).toBe("continue");
    expect(portalAutoRecoveryPrompt({ originalPrompt: "check the site", firstAttemptRuntimeEventSeen: false })).toBe("check the site");
  });

  it("does not treat a thread bootstrap event as an accepted turn", () => {
    expect(portalRuntimeEventIndicatesTurnStarted({ raw: { type: "thread.started" } })).toBe(false);
    expect(portalRuntimeEventIndicatesTurnStarted({ raw: { type: "turn.started" } })).toBe(true);
    expect(portalRuntimeEventIndicatesTurnStarted({ raw: { type: "item.started" } })).toBe(true);
  });

  it.each([
    "mcp_tool_call",
    "image_generation_call",
    "collabAgentToolCall",
    "subAgentActivity"
  ])("blocks automatic replay after %s starts", (type) => {
    expect(portalRuntimeEventHasNonResumableSideEffect({ raw: { item: { type } } })).toBe(true);
  });

  it.each(["command_execution", "file_change"])(
    "allows a continuation turn after local workspace event %s",
    (type) => {
      expect(portalRuntimeEventHasNonResumableSideEffect({ raw: { item: { type } } })).toBe(false);
    }
  );

  it("persists the actionable recovery failure state for task reloads", () => {
    const message = portalAutoRecoveryFailureAssistantMessage({ id: "assistant-1", sessionId: "session-1", runId: "run-1" });
    expect(message.status).toEqual({
      type: "incomplete",
      reason: "error",
      error: "portal_auto_recovery_exhausted"
    });
    expect(message.content).toContainEqual({
      type: "data",
      name: "codex_recovery_failure",
      data: { attempted: true }
    });
    expect(message.metadata.custom.autoRecoveryAttempted).toBe(true);
    expect(message.metadata.custom.runId).toBe("run-1");
  });

});
