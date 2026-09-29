import { describe, expect, it } from "vitest";
import { CodexRunProjection } from "../operations/codex-execution-service.js";
import { normalizeAssistantMessageContentOrder } from "../messages/assistant-content-order.js";
import type { RuntimeStreamEvent } from "../live-runtime-session.js";
import { portalFailedAssistantMessage } from "./chat-failure-message.js";
import { createPortalPartialSnapshot, PortalPartialAnswerCollector } from "./chat-partial-answer.js";
import { portalStoppedAssistantMessage } from "./chat-stopped-message.js";

function agentMessageEvent(
  type: string,
  input: { id: string; phase?: string; delta?: string; text?: string }
): RuntimeStreamEvent {
  return {
    type,
    ...(input.delta !== undefined ? { delta: input.delta } : {}),
    raw: {
      type,
      item: {
        id: input.id,
        type: "agent_message",
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.phase ? { phase: input.phase } : {})
      }
    }
  } as RuntimeStreamEvent;
}

function webSearchCompleted(id: string, query: string): RuntimeStreamEvent {
  return {
    type: "item.completed",
    raw: { type: "item.completed", item: { id, type: "web_search", query } }
  } as RuntimeStreamEvent;
}

function createRun() {
  const projection = new CodexRunProjection({ now: () => 1781100000000 });
  const answer = new PortalPartialAnswerCollector();
  const push = (event: RuntimeStreamEvent) => answer.push(projection.push(event));
  const snapshot = createPortalPartialSnapshot({
    projection,
    answer,
    instructionReadPart: () => undefined,
    answerProtected: false
  });
  return { projection, answer, push, snapshot };
}

function startCommentaryAndAnswer(push: (event: RuntimeStreamEvent) => void) {
  push(agentMessageEvent("item.started", { id: "commentary-1", phase: "commentary", text: "" }));
  push(agentMessageEvent("item.agent_message.delta", { id: "commentary-1", delta: "I will search for sources." }));
  push(agentMessageEvent("item.completed", {
    id: "commentary-1",
    phase: "commentary",
    text: "I will search for sources."
  }));
  push(webSearchCompleted("search-1", "history of tea"));
  push(agentMessageEvent("item.started", { id: "final-1", phase: "final_answer", text: "" }));
  push(agentMessageEvent("item.agent_message.delta", { id: "final-1", delta: "# The history" }));
  push(agentMessageEvent("item.agent_message.delta", { id: "final-1", delta: " of tea" }));
}

describe("PortalPartialAnswerCollector", () => {
  it("keeps the streamed final answer and leaves commentary out of it", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);

    expect(run.answer.text()).toBe("# The history of tea");
  });

  it("replaces streamed deltas with the completed final answer text", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);
    run.push(agentMessageEvent("item.completed", {
      id: "final-1",
      phase: "final_answer",
      text: "# The history of tea\n\nTea began in China."
    }));

    expect(run.answer.text()).toBe("# The history of tea\n\nTea began in China.");
  });

  it("does not adopt a completed commentary message as the answer", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);
    run.push(agentMessageEvent("item.completed", {
      id: "commentary-2",
      phase: "commentary",
      text: "Checking one more source."
    }));

    expect(run.answer.text()).toBe("# The history of tea");
  });

  it("is empty before any answer text and after a reset", () => {
    const run = createRun();
    expect(run.answer.text()).toBe("");
    startCommentaryAndAnswer(run.push);
    run.answer.reset();
    expect(run.answer.text()).toBe("");
  });
});

describe("createPortalPartialSnapshot", () => {
  it("returns the answer so far with the process parts collected until the stop", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);

    const snapshot = run.snapshot();

    expect(snapshot.answerText).toBe("# The history of tea");
    expect(snapshot.contentParts.map((part) => part.name)).toEqual(
      expect.arrayContaining(["codex_commentary", "codex_trace_batch"])
    );
    expect(JSON.stringify(snapshot.contentParts)).toContain("history of tea");
  });

  it("can be taken repeatedly without changing what it returns", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);

    expect(run.snapshot()).toEqual(run.snapshot());
  });

  it("keeps only the process parts when the answer is protected", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);
    const protectedSnapshot = createPortalPartialSnapshot({
      projection: run.projection,
      answer: run.answer,
      instructionReadPart: () => ({ type: "data", name: "codex_instruction_reads", data: { reads: [] } }),
      answerProtected: true
    })();

    expect(protectedSnapshot.answerText).toBe("");
    expect(protectedSnapshot.contentParts.map((part) => part.name)).toEqual(
      expect.arrayContaining(["codex_instruction_reads", "codex_commentary"])
    );
  });
});

describe("portalStoppedAssistantMessage", () => {
  const base = { id: "assistant-1", sessionId: "session-1", runId: "run-1", reason: "explicit_cancel" };

  it("keeps the partial answer and the process parts, with the answer after the process", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);

    const message = normalizeAssistantMessageContentOrder(
      portalStoppedAssistantMessage({ ...base, partial: run.snapshot() })
    ) as ReturnType<typeof portalStoppedAssistantMessage>;

    const summary = message.content.map((part) => ("name" in part ? part.name : part.type));
    expect(summary).toEqual(["codex_commentary", "codex_trace_batch", "codex_process_audit", "text"]);
    expect(message.content.find((part) => part.type === "text")).toEqual({
      type: "text",
      text: "# The history of tea"
    });
    expect(message.status).toEqual({ type: "incomplete", reason: "cancelled" });
    expect(message.metadata.custom).toMatchObject({ stopped: true, stopReason: "explicit_cancel" });
  });

  it("keeps the process and a placeholder when nothing was answered yet", () => {
    const run = createRun();
    run.push(agentMessageEvent("item.completed", { id: "commentary-1", phase: "commentary", text: "Searching." }));

    const message = portalStoppedAssistantMessage({ ...base, partial: run.snapshot() });

    expect(message.content.find((part) => part.type === "text")).toEqual({
      type: "text",
      text: "Response stopped."
    });
    expect(message.content.some((part) => "name" in part && part.name === "codex_commentary")).toBe(true);
  });

  it("falls back to the plain placeholder when no snapshot is available", () => {
    const message = portalStoppedAssistantMessage(base);

    expect(message.content).toEqual([
      { type: "text", text: "Response stopped." },
      expect.objectContaining({ type: "data", name: "codex_process_audit" })
    ]);
  });
});

describe("portalFailedAssistantMessage with a partial run", () => {
  const presentation = {
    userMessage: "The answer could not be completed. Please try again.",
    rawDetail: "runtime exited"
  };

  it("keeps the process and the streamed answer ahead of the failure notice", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);

    const message = portalFailedAssistantMessage({
      id: "assistant-1",
      runId: "run-1",
      presentation,
      partial: run.snapshot()
    });

    const texts = message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text);
    expect(texts).toEqual(["# The history of tea", presentation.userMessage]);
    expect(message.content.some((part) => "name" in part && part.name === "codex_commentary")).toBe(true);
    expect(message.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("is unchanged without a partial run", () => {
    const message = portalFailedAssistantMessage({ id: "assistant-1", runId: "run-1", presentation });

    expect(message.content.map((part) => part.type)).toEqual(["text", "data"]);
  });

  it("keeps the process ahead of the recovery failure marker after auto recovery is exhausted", () => {
    const run = createRun();
    startCommentaryAndAnswer(run.push);

    const message = portalFailedAssistantMessage({
      id: "assistant-1",
      runId: "run-1",
      presentation,
      autoRecoveryAttempted: true,
      partial: run.snapshot()
    });

    expect(message.status).toMatchObject({ type: "incomplete", reason: "error", error: "portal_auto_recovery_exhausted" });
    expect(message.content.some((part) => "name" in part && part.name === "codex_recovery_failure")).toBe(true);
    expect(message.content.some((part) => "name" in part && part.name === "codex_commentary")).toBe(true);
  });
});
