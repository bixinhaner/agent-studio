import { describe, expect, it } from "vitest";

import {
  normalizeAssistantMessageContentOrder,
  orderAssistantContentParts
} from "./assistant-content-order.js";

function label(part: unknown): string {
  const item = part as Record<string, unknown>;
  return typeof item.name === "string" ? item.name : String(item.type);
}

describe("assistant content order", () => {
  it("uses one stable instruction-thought-process-answer-file order", () => {
    const parts = [
      { type: "text", text: "answer" },
      { type: "data", name: "codex_file_change", data: {} },
      { type: "data", name: "codex_trace_batch", data: {} },
      { type: "data", name: "codex_instruction_reads", data: {} },
      { type: "data", name: "codex_commentary", data: {} },
      { type: "source", sourceType: "url", url: "https://example.com" },
      { type: "reasoning", text: "reasoning" }
    ];

    expect(orderAssistantContentParts(parts).map(label)).toEqual([
      "codex_instruction_reads",
      "codex_commentary",
      "reasoning",
      "codex_trace_batch",
      "text",
      "source",
      "codex_file_change"
    ]);
    expect(parts[0]).toEqual({ type: "text", text: "answer" });
  });

  it("normalizes only assistant message content and is idempotent", () => {
    const userMessage = { role: "user", content: [{ type: "text", text: "hello" }] };
    expect(normalizeAssistantMessageContentOrder(userMessage)).toBe(userMessage);

    const assistantMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "answer" },
        { type: "data", name: "codex_commentary", data: {} }
      ]
    };
    const normalized = normalizeAssistantMessageContentOrder(assistantMessage);
    expect(normalized).not.toBe(assistantMessage);
    expect(normalizeAssistantMessageContentOrder(normalized)).toBe(normalized);
  });
});
