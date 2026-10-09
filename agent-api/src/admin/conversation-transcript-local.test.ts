import { describe, expect, it } from "vitest";
import { attachLocalActivity, type LocalBindingEventRow, type LocalOperationLogRow } from "./conversation-transcript-local.js";

const t = (minute: number) => new Date(Date.UTC(2026, 9, 9, 10, minute)).toISOString();

function op(id: string, minute: number, extra: Partial<LocalOperationLogRow> = {}): LocalOperationLogRow {
  return {
    id, threadId: "thread-1", deviceName: "Like MacBook", platform: "darwin", rootPath: "/Users/like/proj",
    source: "agent", op: "exec", args: { command: "npm test -- --watch=false" }, status: "completed",
    result: { ok: true, exit_code: 1, output: "fail" }, createdAt: t(minute), completedAt: t(minute), ...extra
  };
}

function bindingEvent(id: string, minute: number, extra: Partial<LocalBindingEventRow>): LocalBindingEventRow {
  return {
    id, kind: "bound", fromPath: null, fromLabel: null, fromDeviceName: null, fromPlatform: null,
    toPath: null, toLabel: null, toDeviceName: null, toPlatform: null, createdAt: t(minute), ...extra
  };
}

const transcript = [
  { id: "u1", role: "user", parentId: null, createdAt: t(0) },
  { id: "a1", role: "assistant", parentId: "u1", createdAt: t(4) },
  { id: "u2", role: "user", parentId: "a1", createdAt: t(10) },
  { id: "a2", role: "assistant", parentId: "u2", createdAt: t(15) }
];

describe("attachLocalActivity", () => {
  it("attaches agent operations to the turn they ran in and keeps portal actions as events", () => {
    const result = attachLocalActivity(transcript, transcript.map(() => ({ message: {} })), {
      operations: [
        op("op-1", 1),
        op("op-2", 11, { op: "write", args: { path: "a.txt", content: "full" }, result: { ok: true, path: "/Users/like/proj/a.txt" } }),
        op("op-3", 12, { source: "portal", op: "open", args: { path: "a.txt" } }),
        op("op-4", 13, { status: "pending", result: null })
      ],
      bindingEvents: [],
      now: Date.parse(t(60))
    });
    expect(result.messages[1]?.localOperations).toMatchObject([
      { id: "op-1", op: "exec", target: "npm test -- --watch=false", exitCode: 1, ok: true, hasDetail: true }
    ]);
    expect(result.messages[3]?.localOperations?.map((item) => [item.id, item.status])).toEqual([
      ["op-2", "completed"],
      ["op-4", "expired"]
    ]);
    expect(result.messages[3]?.localOperations?.[0]).toMatchObject({ target: "/Users/like/proj/a.txt" });
    expect(result.events).toMatchObject([{ kind: "operation", operation: { id: "op-3", source: "portal", target: "a.txt" } }]);
  });

  it("prefers the recorded location and otherwise derives it from switch history", () => {
    const result = attachLocalActivity(
      transcript,
      [
        { message: {}, runConfig: {} },
        { message: {} },
        { message: {}, runConfig: { _agentStudioExecutionLocation: { mode: "local", deviceName: "Lab PC", path: "C:\\work", label: "work" } } },
        { message: {} }
      ],
      {
        operations: [],
        bindingEvents: [
          bindingEvent("evt-1", 2, { kind: "switched", fromPath: "/a", toPath: "/Users/like/b", toLabel: "b", toDeviceName: "Like MacBook" })
        ]
      }
    );
    expect(result.messages[0]?.executionLocation).toBeUndefined();
    expect(result.messages[2]?.executionLocation).toMatchObject({ mode: "local", deviceName: "Lab PC", source: "recorded" });
    expect(result.events).toMatchObject([
      { kind: "switched", from: { path: "/a" }, to: { path: "/Users/like/b", deviceName: "Like MacBook" } }
    ]);
  });

  it("treats turns before a real first bind as cloud but not before a backfilled one", () => {
    const real = attachLocalActivity(transcript, transcript.map(() => ({ message: {} })), {
      operations: [],
      bindingEvents: [bindingEvent("evt-1", 5, { toPath: "/Users/like/proj", toLabel: "proj" })]
    });
    expect(real.messages[0]?.executionLocation).toMatchObject({ mode: "cloud", source: "derived" });
    expect(real.messages[2]?.executionLocation).toMatchObject({ mode: "local", path: "/Users/like/proj" });

    const backfilled = attachLocalActivity(transcript, transcript.map(() => ({ message: {} })), {
      operations: [],
      bindingEvents: [bindingEvent("backfill-b1", 5, { toPath: "/Users/like/proj" })]
    });
    expect(backfilled.messages[0]?.executionLocation).toBeUndefined();
    expect(backfilled.events[0]).toMatchObject({ kind: "bound", backfilled: true });

    const unbound = attachLocalActivity(transcript, transcript.map(() => ({ message: {} })), {
      operations: [],
      bindingEvents: [bindingEvent("evt-2", 5, { kind: "unbound", fromPath: "/Users/like/proj" })]
    });
    expect(unbound.messages[2]?.executionLocation).toMatchObject({ mode: "cloud" });
    expect(unbound.events[0]).toMatchObject({ kind: "unbound", to: { mode: "cloud" } });
  });

  it("falls back to the chat card for turns older than the audit log", () => {
    const result = attachLocalActivity(
      transcript,
      [
        { message: {} },
        {
          message: {
            content: [
              { type: "tool-call", toolCallId: "call-1", toolName: "local_computer.local_write", result: { ok: true, path: "/p/a.txt", device_name: "Old PC" } },
              { type: "tool-call", toolCallId: "call-2", toolName: "local_computer.local_read", isError: true, result: { ok: false, error: "ENOENT" } },
              { type: "tool-call", toolCallId: "call-3", toolName: "web.search", result: {} }
            ]
          }
        },
        { message: {} },
        { message: {} }
      ],
      { operations: [], bindingEvents: [] }
    );
    expect(result.messages[1]?.localOperations).toMatchObject([
      { id: "call-1", op: "write", source: "message", ok: true, target: "/p/a.txt", deviceName: "Old PC", hasDetail: false },
      { id: "call-2", op: "read", ok: false, error: "ENOENT" }
    ]);
  });
});
