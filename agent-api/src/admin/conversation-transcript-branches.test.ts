import { describe, expect, it } from "vitest";

import { computeTranscriptBranches } from "./conversation-transcript-branches.js";
import { buildTranscriptMessages } from "./conversation-audit-router.js";

const text = (id: string, role: "user" | "assistant", body: string) => ({
  id,
  role,
  content: [{ type: "text", text: body }],
  ...(role === "assistant" ? { status: { type: "complete" } } : {})
});

describe("computeTranscriptBranches", () => {
  it("marks the head path active and maps an edited branch to its active sibling", () => {
    const info = computeTranscriptBranches(
      [
        { id: "u1", parentId: null },
        { id: "a1", parentId: "u1" },
        { id: "u2-old", parentId: "a1" },
        { id: "a2-old", parentId: "u2-old" },
        { id: "u2", parentId: "a1" },
        { id: "a2", parentId: "u2" }
      ],
      "a2"
    )!;
    expect([...info].filter(([, value]) => value.active).map(([id]) => id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(info.get("u2")).toMatchObject({ siblingIndex: 2, siblingCount: 2, divergesFromId: null });
    expect(info.get("u2-old")).toMatchObject({ active: false, siblingIndex: 1, divergesFromId: "u2" });
    expect(info.get("a2-old")).toMatchObject({ active: false, divergesFromId: "u2" });
  });

  it("handles root edits and falls back to the last message when the head is unknown", () => {
    const info = computeTranscriptBranches(
      [
        { id: "u1", parentId: null },
        { id: "u1b", parentId: null }
      ],
      "missing"
    )!;
    expect(info.get("u1b")?.active).toBe(true);
    expect(info.get("u1")).toMatchObject({ active: false, divergesFromId: "u1b", siblingCount: 2 });
  });

  it("returns null for a cyclic graph so callers keep the flat list", () => {
    expect(computeTranscriptBranches([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], "a")).toBeNull();
  });
});

describe("buildTranscriptMessages with a thread head", () => {
  it("does not mark an orphan rejected send as running and keeps the answered turn completed", () => {
    const messages = buildTranscriptMessages(
      "t1",
      [
        { parentId: null, message: text("u1", "user", "write a report") },
        { parentId: "u1", message: text("a1", "assistant", "report") },
        { parentId: "a1", message: text("u2", "user", "long essay") },
        // Rejected send from another tab: sibling of the assistant answer, became the head.
        { parentId: "u2", message: text("u3", "user", "add summary") },
        { parentId: "u2", message: text("a2", "assistant", "essay") }
      ],
      { headId: "u3", activeTurn: false }
    );
    const byId = new Map(messages.map((message) => [message.id, message]));
    expect(byId.get("u2")?.turnStatus).toBe("completed");
    expect(byId.get("u3")?.branch).toMatchObject({ active: true, siblingIndex: 1, siblingCount: 2 });
    expect(byId.get("a2")?.branch).toMatchObject({ active: false, divergesFromId: "u3" });
  });

  it("keeps the flat behaviour when no head is provided", () => {
    const messages = buildTranscriptMessages("t1", [
      { parentId: null, message: text("u1", "user", "hi") },
      { parentId: "u1", message: text("a1", "assistant", "hello") }
    ]);
    expect(messages.every((message) => message.branch === undefined)).toBe(true);
  });

  it("exposes stop/failure outcomes and memory use on assistant messages", () => {
    const messages = buildTranscriptMessages(
      "t1",
      [
        { parentId: null, message: text("u1", "user", "hi") },
        {
          parentId: "u1",
          message: {
            id: "a1",
            role: "assistant",
            content: [
              { type: "data", name: "agent_studio_memory_context", data: { used: true } },
              { type: "data", name: "codex_trace_batch", data: { rows: [{ id: "r1", kind: "tool", title: "Run", at: "2026-10-08T01:00:00.000Z" }] } },
              { type: "text", text: "The system is being updated." },
              {
                type: "data",
                name: "codex_process_audit",
                data: { kind: "error", title: "Needs attention", rawDetail: "Interrupted by a system update", code: "SYSTEM_UPDATE_INTERRUPTED", reasonCode: "system_update" }
              }
            ],
            status: { type: "incomplete", reason: "error" },
            metadata: { custom: { failed: true, autoRecoveryAttempted: false } }
          }
        }
      ],
      { headId: "a1" }
    );
    const assistant = messages[1]!;
    expect(assistant.memoryUsed).toBe(true);
    expect(assistant.turnStatus).toBe("failed");
    expect(assistant.turnOutcome).toMatchObject({ kind: "system_update", code: "SYSTEM_UPDATE_INTERRUPTED", rawDetail: "Interrupted by a system update" });
    expect(assistant.turnStatusReason).toBe(assistant.turnOutcome?.reason);
    // Audit row stays in the timeline even when trace batches exist.
    expect(assistant.processRows?.map((row) => row.title)).toContain("Needs attention");
  });
});
