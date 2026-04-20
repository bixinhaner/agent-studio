import { describe, expect, it } from "vitest";

import { extractMessageText } from "./conversation-audit-router.js";

describe("extractMessageText", () => {
  it("appends process error details when regular text content is already present", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "Primary answer" },
        { type: "data", name: "codex_process", data: { kind: "error", title: "Execution failed", detail: "Should not override answer" } }
      ]
    };

    expect(extractMessageText(message)).toBe("Primary answer\n\nExecution failed\n\nShould not override answer");
  });

  it("falls back to codex process error details when assistant text is empty", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_process",
          data: {
            kind: "error",
            title: "Execution failed",
            detail: "Session does not match the requested thread. Please try again."
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe(
      "Execution failed\n\nSession does not match the requested thread. Please try again."
    );
  });

  it("falls back to trace batch error rows when no text part exists", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_trace_batch",
          data: {
            rows: [
              { kind: "process", title: "Planning", detail: "Normal step" },
              { kind: "error", title: "Execution error", detail: "Command exited with code 1" }
            ]
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe("Execution error\n\nCommand exited with code 1");
  });

  it("does not surface non-error process events as transcript text", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "data",
          name: "codex_process",
          data: {
            kind: "process",
            title: "File changes",
            detail: "update: README.md"
          }
        }
      ]
    };

    expect(extractMessageText(message)).toBe("");
  });
});
