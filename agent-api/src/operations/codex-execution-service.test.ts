import { describe, expect, it, vi } from "vitest";

import {
  CodexExecutionService,
  CodexRunProjection,
  codexCommentaryEntriesToContentPart,
  codexTraceRowsToContentPart,
  projectCodexRuntimeEvent
} from "./codex-execution-service.js";

describe("CodexExecutionService", () => {
  it("delegates runtime stream completion through one execution entrypoint", async () => {
    const service = new CodexExecutionService();
    const events = (async function* () {
      yield {
        type: "message.delta",
        delta: "done"
      };
    })();
    const onDone = vi.fn();

    await service.streamCompletion({
      events,
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone.mock.calls[0]?.[0]).toMatchObject({
      answer: "done"
    });
  });

  it("collects completion from a runtime thread without exposing event parsing to callers", async () => {
    const service = new CodexExecutionService();
    const runtime = {
      async *runStreamed(_thread: { id: string }, message: string) {
        yield {
          type: "message.delta",
          delta: message
        };
      }
    };

    await expect(service.collectFromRuntime({
      runtime,
      thread: { id: "thread-1" },
      prompt: "answer"
    })).resolves.toMatchObject({
      answer: "answer"
    });
  });

  it("prepends enterprise context only to the runtime prompt", async () => {
    const enqueueRun = vi.fn();
    const service = new CodexExecutionService({ memory: { enqueueRun } });
    const runtime = {
      async *runStreamed(_thread: { id: string }, message: string) {
        yield {
          type: "message.delta",
          delta: message
        };
      }
    };

    const result = await service.collectFromRuntime({
      runtime,
      thread: { id: "thread-1" },
      prompt: "user question",
      enterpriseContext: {
        enabled: true,
        markdown: "<enterprise_context>\n- 姓名：李可\n</enterprise_context>",
        hash: "ctx-1"
      },
      memory: {
        channel: "portal",
        prompt: "user question",
        codexHome: "/tmp/codex-home",
        sessionId: "session-1"
      }
    });

    expect(result.answer).toContain("<enterprise_context>");
    expect(result.answer).toContain("user question");
    expect(enqueueRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "user question",
      answerText: expect.stringContaining("<enterprise_context>")
    }));
  });

  it("enqueues memory generation from the common runtime completion path", async () => {
    const enqueueRun = vi.fn();
    const service = new CodexExecutionService({ memory: { enqueueRun } });
    const runtime = {
      async *runStreamed(_thread: { id: string }, message: string) {
        yield {
          type: "message.delta",
          delta: message
        };
      }
    };

    await service.collectFromRuntime({
      runtime,
      thread: { id: "thread-1" },
      prompt: "answer",
      memory: {
        channel: "portal",
        prompt: "question",
        codexHome: "/tmp/codex-home",
        sessionId: "session-1"
      }
    });

    expect(enqueueRun).toHaveBeenCalledWith(expect.objectContaining({
      channel: "portal",
      prompt: "question",
      answerText: "answer",
      codexHome: "/tmp/codex-home",
      sessionId: "session-1"
    }));
  });

  it("tracks streamed runtime turns until completion", async () => {
    const finish = vi.fn();
    const start = vi.fn(() => finish);
    const service = new CodexExecutionService({ runtimeTurnTracker: { start } });
    const runtime = {
      async *runStreamed(_thread: { id: string }, message: string) {
        yield {
          type: "message.delta",
          delta: message
        };
      }
    };

    await service.streamFromRuntime({
      runtime,
      thread: { id: "thread-1" },
      prompt: "answer",
      memory: {
        channel: "portal",
        prompt: "question",
        codexHome: "/tmp/codex-home",
        sessionId: "session-1",
        threadId: "thread-1",
        model: "gpt-5.5",
        hasExternalContext: true
      },
      onEvent: vi.fn(),
      onDone: vi.fn()
    });

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      operation: "stream",
      channel: "portal",
      sessionId: "session-1",
      threadId: "thread-1",
      model: "gpt-5.5",
      hasExternalContext: true
    }));
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("releases tracked runtime turns when runtime collection fails", async () => {
    const finish = vi.fn();
    const service = new CodexExecutionService({
      runtimeTurnTracker: {
        start: vi.fn(() => finish)
      }
    });
    const runtime = {
      async *runStreamed() {
        throw new Error("runtime failed");
      }
    };

    await expect(service.collectFromRuntime({
      runtime,
      thread: { id: "thread-1" },
      prompt: "answer",
      memory: {
        channel: "zendesk",
        prompt: "question",
        codexHome: "/tmp/codex-home",
        sessionId: "session-1"
      }
    })).rejects.toThrow("runtime failed");

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("projects runtime reasoning and tool events into common trace rows", () => {
    const reasoning = projectCodexRuntimeEvent({
      type: "item.completed",
      text: "Checked the customer and opportunity records.",
      raw: {
        type: "item.completed",
        item: {
          id: "reasoning-1",
          type: "reasoning",
          text: "Checked the customer and opportunity records."
        }
      }
    });
    const tool = projectCodexRuntimeEvent({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "tool-1",
          type: "mcp_tool_call",
          server: "crest_crm",
          tool: "customers.search",
          arguments: { q: "ACME" },
          result: { count: 1 }
        }
      }
    });

    expect(reasoning).toMatchObject({
      reasoningText: "Checked the customer and opportunity records.",
      traceRows: [
        expect.objectContaining({
          id: "reasoning-1-reasoning",
          kind: "reasoning",
          title: "Reasoning summary",
          detail: "Checked the customer and opportunity records."
        })
      ]
    });
    expect(tool).toMatchObject({
      toolCall: {
        id: "tool-1",
        name: "crest_crm.customers.search",
        server: "crest_crm",
        tool: "customers.search",
        args: { q: "ACME" },
        result: { count: 1 }
      },
      traceRows: [
        expect.objectContaining({
          id: "tool-1-tool",
          kind: "tool",
          title: "Tool step completed"
        })
      ]
    });
  });

  it("projects app-server lifecycle events into friendly trace rows", () => {
    const compaction = projectCodexRuntimeEvent({
      type: "item.started",
      raw: {
        type: "item.started",
        item: {
          id: "context-1",
          type: "contextCompaction"
        }
      }
    });
    const image = projectCodexRuntimeEvent({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "image-1",
          type: "image_generation_call",
          revised_prompt: "A clean product poster",
          result: "base64-image-content"
        }
      }
    });
    const hiddenUserMessage = projectCodexRuntimeEvent({
      type: "item.started",
      raw: {
        type: "item.started",
        item: {
          id: "user-message-1",
          type: "user_message",
          text: "<enterprise_context>internal</enterprise_context>"
        }
      }
    });

    expect(compaction.traceRows).toEqual([
      expect.objectContaining({
        id: "context-1-context",
        kind: "meta",
        title: "Context window is full. Compressing context."
      })
    ]);
    expect(image.traceRows).toEqual([
      expect.objectContaining({
        id: "image-1-image",
        kind: "tool",
        title: "Image generated",
        detail: "A clean product poster"
      })
    ]);
    expect(JSON.stringify(image.traceRows)).not.toContain("base64-image-content");
    expect(hiddenUserMessage.traceRows).toEqual([]);
  });

  it("projects completed agent messages for run-level commentary", () => {
    expect(projectCodexRuntimeEvent({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-1",
          type: "agent_message",
          text: "I will inspect the CRM records first."
        }
      }
    })).toMatchObject({
      completedAgentMessage: {
        id: "message-1",
        text: "I will inspect the CRM records first."
      }
    });
  });

  it("projects agent message phase from runtime events", () => {
    expect(projectCodexRuntimeEvent({
      type: "item.started",
      raw: {
        type: "item.started",
        item: {
          id: "message-final",
          type: "agent_message",
          text: "",
          phase: "final_answer"
        }
      }
    })).toMatchObject({
      itemType: "agent_message",
      itemId: "message-final",
      agentMessagePhase: "final_answer"
    });
  });

  it("serializes projected trace rows into the shared transcript content format", () => {
    expect(codexTraceRowsToContentPart([
      {
        id: "reasoning-1",
        kind: "reasoning",
        title: "Reasoning summary",
        detail: "Checked the CRM evidence.",
        at: "2026-06-10T10:00:00.000Z"
      }
    ])).toEqual({
      type: "data",
      name: "codex_trace_batch",
      data: {
        batch_id: 1,
        open: false,
        active_row_id: "",
        rows: [
          {
            id: "reasoning-1",
            kind: "reasoning",
            title: "Reasoning summary",
            detail: "Checked the CRM evidence.",
            rawDetail: undefined,
            at: "2026-06-10T10:00:00.000Z"
          }
        ]
      }
    });
  });

  it("serializes completed agent messages as shared commentary content", () => {
    expect(codexCommentaryEntriesToContentPart([
      {
        id: "message-1",
        text: "I checked CRM updates before answering.",
        lines: ["I checked CRM updates before answering."],
        last_event_at: 1781100000000,
        status: "completed"
      },
      {
        id: "message-final",
        text: "Here is the final answer.",
        lines: ["Here is the final answer."],
        last_event_at: 1781100001000,
        status: "completed"
      }
    ], { finalAnswer: "Here is the final answer." })).toEqual({
      type: "data",
      name: "codex_commentary",
      data: {
        id: "assistant-thoughts",
        text: "I checked CRM updates before answering.",
        lines: ["I checked CRM updates before answering."],
        entries: [
          {
            id: "message-1",
            text: "I checked CRM updates before answering.",
            lines: ["I checked CRM updates before answering."],
            last_event_at: 1781100000000,
            status: "completed"
          }
        ],
        open: false,
        status: "completed",
        last_event_at: 1781100000000
      }
    });
  });

  it("removes final answers from commentary suffixes", () => {
    expect(codexCommentaryEntriesToContentPart([
      {
        id: "message-1",
        text: "I checked CRM records.\n\nHere is the final answer.",
        lines: ["I checked CRM records.", "Here is the final answer."],
        last_event_at: 1781100000000,
        status: "completed"
      }
    ], { finalAnswer: "Here is the final answer." })).toMatchObject({
      name: "codex_commentary",
      data: {
        text: "I checked CRM records.",
        entries: [
          {
            id: "message-1",
            text: "I checked CRM records.",
            lines: ["I checked CRM records."]
          }
        ]
      }
    });
  });

  it("emits live commentary only after it is no longer the possible final answer", () => {
    const projection = new CodexRunProjection({ now: () => 1781100000000 });
    const first = projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-1",
          type: "agent_message",
          text: "I will check the CRM records."
        }
      }
    });
    const second = projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-final",
          type: "agent_message",
          text: "Done."
        }
      }
    });

    expect(first.liveCommentaryEntries).toEqual([]);
    expect(second.liveCommentaryEntries).toEqual([
      expect.objectContaining({
        id: "message-1",
        text: "I will check the CRM records."
      })
    ]);
    expect(projection.finalize({ finalAnswer: "Done." }).liveCommentaryEntries).toEqual([]);
  });

  it("can suppress live answer deltas while keeping commentary projection", () => {
    const projection = new CodexRunProjection({
      now: () => 1781100000000,
      streamAnswerDeltas: false
    });
    const streamed = projection.push({
      type: "item.updated",
      delta: "I will generate a draft image first.",
      raw: {
        type: "item.updated",
        item: {
          id: "message-1",
          type: "agent_message",
          text: "I will generate a draft image first."
        }
      }
    });
    const completed = projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-1",
          type: "agent_message",
          text: "I will generate a draft image first."
        }
      }
    });
    const final = projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-final",
          type: "agent_message",
          text: "Done."
        }
      }
    });

    expect(streamed.answerDelta).toBeUndefined();
    expect(completed.liveCommentaryEntries).toEqual([]);
    expect(final.liveCommentaryEntries).toEqual([
      expect.objectContaining({
        id: "message-1",
        text: "I will generate a draft image first."
      })
    ]);
  });

  it("streams only final answer deltas when agent message phases are known", () => {
    const projection = new CodexRunProjection({ now: () => 1781100000000 });
    projection.push({
      type: "item.started",
      raw: {
        type: "item.started",
        item: {
          id: "message-commentary",
          type: "agent_message",
          text: "",
          phase: "commentary"
        }
      }
    });
    const commentaryDelta = projection.push({
      type: "item.agent_message.delta",
      delta: "I will inspect the records.",
      raw: {
        type: "item.agent_message.delta",
        item: {
          id: "message-commentary",
          type: "agent_message"
        }
      }
    });
    projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-commentary",
          type: "agent_message",
          text: "I will inspect the records.",
          phase: "commentary"
        }
      }
    });
    projection.push({
      type: "item.started",
      raw: {
        type: "item.started",
        item: {
          id: "message-final",
          type: "agent_message",
          text: "",
          phase: "final_answer"
        }
      }
    });
    const finalDelta = projection.push({
      type: "item.agent_message.delta",
      delta: "Here is the answer.",
      raw: {
        type: "item.agent_message.delta",
        item: {
          id: "message-final",
          type: "agent_message"
        }
      }
    });
    const finalCompleted = projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-final",
          type: "agent_message",
          text: "Here is the answer.",
          phase: "final_answer"
        }
      }
    });

    expect(commentaryDelta.answerDelta).toBeUndefined();
    expect(finalDelta.answerDelta).toBe("Here is the answer.");
    expect(finalCompleted.liveCommentaryEntries).toEqual([
      expect.objectContaining({
        id: "message-commentary",
        text: "I will inspect the records."
      })
    ]);
    const finalized = projection.finalize({ finalAnswer: "Here is the answer." });
    expect(JSON.stringify(finalized.contentParts)).toContain("I will inspect the records.");
    expect(JSON.stringify(finalized.contentParts)).not.toContain("Here is the answer.");
  });

  it("removes final answers from reasoning trace suffixes", () => {
    const projection = new CodexRunProjection({ now: () => 1781100000000 });
    projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "reasoning-1",
          type: "reasoning",
          text: "I checked CRM records.\n\nHere is the final answer."
        }
      }
    });

    expect(projection.finalize({ finalAnswer: "Here is the final answer." }).traceRows).toEqual([
      expect.objectContaining({
        id: "reasoning-1-reasoning",
        detail: "I checked CRM records."
      })
    ]);
  });

  it("collects a full run projection into commentary and trace content parts", () => {
    const projection = new CodexRunProjection({ now: () => 1781100000000 });
    projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-1",
          type: "agent_message",
          text: "I will search the customer record."
        }
      }
    });
    projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "tool-1",
          type: "mcp_tool_call",
          server: "crest_crm",
          tool: "customers.search",
          arguments: { q: "ACME" },
          result: { count: 1 }
        }
      }
    });
    projection.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          id: "message-final",
          type: "agent_message",
          text: "ACME was updated today."
        }
      }
    });

    const finalized = projection.finalize({ finalAnswer: "ACME was updated today." });
    expect(finalized.traceRows).toHaveLength(1);
    expect(finalized.contentParts.map((part) => part.name)).toEqual(["codex_commentary", "codex_trace_batch"]);
    expect(finalized.contentParts[0]).toMatchObject({
      name: "codex_commentary",
      data: {
        entries: [
          expect.objectContaining({
            id: "message-1",
            text: "I will search the customer record."
          })
        ]
      }
    });
    expect(JSON.stringify(finalized.contentParts[0])).not.toContain("ACME was updated today.");
  });
});
