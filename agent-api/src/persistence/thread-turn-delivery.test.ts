import { describe, expect, it, vi } from "vitest";

import { ThreadRepository, type ThreadRepositoryDb } from "./thread-repository.js";

type FakeThread = {
  id: string;
  headId: string | null;
  updatedAt: Date;
};

type FakeMessage = {
  id: string;
  threadId: string;
  externalId: string | null;
  role: string;
  content: unknown;
  parentId: string | null;
  runConfig: unknown;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

function createFakeDb(input?: { headId?: string; withLaterHead?: boolean }) {
  const thread: FakeThread = {
    id: "thread-1",
    headId: input?.headId ?? "user-1",
    updatedAt: new Date("2026-08-20T00:00:00.000Z")
  };
  const messages: FakeMessage[] = [
    {
      id: "row-user-1",
      threadId: thread.id,
      externalId: "user-1",
      role: "user",
      content: { id: "user-1", role: "user", content: [{ type: "text", text: "question" }] },
      parentId: null,
      runConfig: { channel: "portal" },
      position: 0,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-20T00:00:00.000Z")
    }
  ];
  if (input?.withLaterHead) {
    messages.push({
      id: "row-user-2",
      threadId: thread.id,
      externalId: "user-2",
      role: "user",
      content: { id: "user-2", role: "user", content: [{ type: "text", text: "later" }] },
      parentId: "user-1",
      runConfig: { channel: "portal" },
      position: 1,
      createdAt: new Date("2026-08-20T00:01:00.000Z"),
      updatedAt: new Date("2026-08-20T00:01:00.000Z")
    });
    thread.headId = "user-2";
  }

  const db = {
    thread: {
      async count() { return 1; },
      async findUnique() { return thread; },
      async findMany() { return [thread]; },
      async create() { return thread; },
      async update({ data }: any) {
        Object.assign(thread, data);
        return thread;
      },
      async delete() { return thread; }
    },
    message: {
      async findMany() { return [...messages].sort((left, right) => left.position - right.position); },
      async create({ data }: any) {
        const created = data as FakeMessage;
        messages.push(created);
        return created;
      },
      async update({ where, data }: any) {
        const message = messages.find((item) => item.id === where.id);
        if (!message) throw new Error("missing message");
        Object.assign(message, data);
        return message;
      },
      async deleteMany() { return { count: 0 }; }
    },
    runtimeSession: {
      async findFirst() { return null; },
      async deleteMany() { return { count: 0 }; }
    },
    async $transaction<T>(callback: (tx: ThreadRepositoryDb) => Promise<T>) {
      return callback(db as unknown as ThreadRepositoryDb);
    }
  };
  return { db: db as unknown as ThreadRepositoryDb, thread, messages };
}

function assistant(id: string, text = "answer") {
  return {
    parentId: "user-1",
    message: { id, role: "assistant", content: [{ type: "text", text }] },
    runConfig: { channel: "portal" }
  };
}

describe("thread turn delivery", () => {
  it("sanitizes ordinary message and feedback writes at the same repository boundary", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = createFakeDb();
    const repository = new ThreadRepository(state.db);

    await repository.appendMessage("thread-1", {
      parentId: "user-1",
      message: {
        id: "assistant-appended",
        role: "assistant",
        content: [{ type: "text", text: "append\u0000safe" }]
      },
      runConfig: { checkpoint: "one\u0000two" }
    });
    const feedback = await repository.addFeedback("thread-1", {
      type: "negative",
      messageId: "assistant-appended",
      comment: "bad\u0000response"
    });

    const appended = state.messages.find((item) => item.externalId === "assistant-appended");
    expect(appended?.content).toMatchObject({ content: [{ text: "append\\u0000safe" }] });
    expect(appended?.runConfig).toMatchObject({ checkpoint: "one\\u0000two" });
    expect(feedback.comment).toBe("bad\\u0000response");
    expect((state.thread as FakeThread & { feedback?: unknown }).feedback).toEqual([
      expect.objectContaining({ comment: "bad\\u0000response" })
    ]);
    expect(warning).toHaveBeenCalledTimes(3);
    warning.mockRestore();
  });

  it.each(["portal", "crest", "dingtalk_bot", "zendesk", "openai_compatible_api", "action_connector"])(
    "sanitizes terminal content for the shared %s persistence path",
    async (channel) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const state = createFakeDb();
      const repository = new ThreadRepository(state.db);

      await repository.claimTurnDelivery({
        threadId: "thread-1",
        userMessageId: "user-1",
        runId: `run-${channel}`,
        channel,
        acceptedAt: "2026-08-20T00:00:01.000Z"
      });
      await repository.finalizeTurnDelivery({
        threadId: "thread-1",
        userMessageId: "user-1",
        runId: `run-${channel}`,
        channel,
        acceptedAt: "2026-08-20T00:00:01.000Z",
        status: "completed",
        assistant: {
          parentId: "user-1",
          message: {
            id: `assistant-${channel}`,
            role: "assistant",
            content: [
              { type: "text", text: "before\u0000after" },
              { type: "tool-result", output: { stdout: "log\u0000tail" } }
            ]
          },
          runConfig: { channel, toolState: "safe\u0000state" }
        }
      });

      const stored = state.messages.find((item) => item.externalId === `assistant-${channel}`);
      const storedContent = (stored?.content as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? [];
      expect(storedContent.find((item) => item.type === "text")).toMatchObject({
        text: "before\\u0000after"
      });
      expect(storedContent.find((item) => item.type === "tool-result")).toMatchObject({
        output: { stdout: "log\\u0000tail" }
      });
      expect(stored?.runConfig).toMatchObject({ channel, toolState: "safe\\u0000state" });
      expect(warning).toHaveBeenCalledWith(
        "agent_studio_conversation_json_sanitized",
        expect.objectContaining({
          threadId: "thread-1",
          operation: "finalizeTurnDelivery",
          channel,
          replacementCount: expect.any(Number)
        })
      );
      warning.mockRestore();
    }
  );

  it("persists one terminal assistant idempotently", async () => {
    const state = createFakeDb();
    const repository = new ThreadRepository(state.db);
    const claim = await repository.claimTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-1",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z"
    });
    expect(claim.outcome).toBe("claimed");

    const first = await repository.finalizeTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-1",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z",
      status: "completed",
      assistant: assistant("assistant-1")
    });
    const duplicate = await repository.finalizeTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-1",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z",
      status: "completed",
      assistant: assistant("assistant-1")
    });

    expect(first.outcome).toBe("persisted");
    expect(duplicate.outcome).toBe("already_persisted");
    expect(state.messages.filter((item) => item.role === "assistant")).toHaveLength(1);
    expect(state.thread.headId).toBe("assistant-1");
  });

  it("rejects an older run after a newer run claims the same user message", async () => {
    const state = createFakeDb();
    const repository = new ThreadRepository(state.db);
    await repository.claimTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-new",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:02.000Z"
    });

    const result = await repository.finalizeTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-old",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z",
      status: "completed",
      assistant: assistant("assistant-old")
    });

    expect(result).toMatchObject({ outcome: "superseded", latestRunId: "run-new" });
    expect(state.messages.filter((item) => item.role === "assistant")).toHaveLength(0);
  });

  it("advances from an older assistant when the same turn is rerun", async () => {
    const state = createFakeDb();
    const repository = new ThreadRepository(state.db);
    await repository.claimTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-old",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z"
    });
    await repository.finalizeTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-old",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z",
      status: "completed",
      assistant: assistant("assistant-old")
    });
    await repository.claimTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-new",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:02.000Z"
    });
    await repository.finalizeTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-new",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:02.000Z",
      status: "completed",
      assistant: assistant("assistant-new")
    });

    expect(state.thread.headId).toBe("assistant-new");
  });

  it("survives repository recreation and does not rewind a later conversation head", async () => {
    const state = createFakeDb({ withLaterHead: true });
    await new ThreadRepository(state.db).claimTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-1",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z"
    });

    const result = await new ThreadRepository(state.db).finalizeTurnDelivery({
      threadId: "thread-1",
      userMessageId: "user-1",
      runId: "run-1",
      channel: "portal",
      acceptedAt: "2026-08-20T00:00:01.000Z",
      status: "failed",
      assistant: assistant("assistant-failed", "failed")
    });

    expect(result.outcome).toBe("persisted");
    expect(state.thread.headId).toBe("user-2");
    expect(state.messages.find((item) => item.externalId === "assistant-failed")?.parentId).toBe("user-1");
  });
});
