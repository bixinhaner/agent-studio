import { describe, expect, it } from "vitest";

import { orderAssistantContentParts } from "./assistant-content-order";

function label(part: unknown): string {
  const item = part as Record<string, unknown>;
  return typeof item.name === "string" ? item.name : String(item.type);
}

describe("orderAssistantContentParts", () => {
  it("matches the persisted instruction-thought-process-answer-file contract", () => {
    const parts = [
      { type: "text", text: "answer" },
      { type: "data", name: "codex_file_change", data: {} },
      { type: "data", name: "codex_trace_batch", data: {} },
      { type: "data", name: "codex_instruction_reads", data: {} },
      { type: "data", name: "codex_commentary", data: {} },
      { type: "reasoning", text: "reasoning" }
    ];

    expect(orderAssistantContentParts(parts).map(label)).toEqual([
      "codex_instruction_reads",
      "codex_commentary",
      "reasoning",
      "codex_trace_batch",
      "text",
      "codex_file_change"
    ]);
  });

  it("keeps the original order inside each display layer", () => {
    const first = { type: "text", text: "first" };
    const second = { type: "source", sourceType: "url", url: "https://example.com" };
    expect(orderAssistantContentParts([first, second])).toEqual([first, second]);
  });
});
