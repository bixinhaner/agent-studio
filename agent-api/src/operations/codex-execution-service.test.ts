import { describe, expect, it, vi } from "vitest";

import {
  CodexExecutionService,
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
          title: "Tool call completed"
        })
      ]
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
});
