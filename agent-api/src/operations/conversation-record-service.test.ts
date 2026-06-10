import { describe, expect, it, vi } from "vitest";

import { ConversationRecordService } from "./conversation-record-service.js";

describe("ConversationRecordService", () => {
  it("delegates message writes through the canonical thread repository contract", async () => {
    const appendMessage = vi.fn(async (threadId: string, item: unknown) => ({
      id: threadId,
      headId: "message-1",
      messages: [item]
    }));
    const service = new ConversationRecordService({
      threads: {
        appendMessage,
        create: vi.fn(),
        get: vi.fn(),
        getByExternalId: vi.fn(),
        getRepository: vi.fn(),
        list: vi.fn(),
        listForUser: vi.fn(),
        replaceMessages: vi.fn(),
        update: vi.fn()
      } as never,
      externalConversations: {
        getByExternalConversationKey: vi.fn(),
        listByThreadIds: vi.fn(),
        listRecentForIntegration: vi.fn(),
        touch: vi.fn(),
        updateThread: vi.fn(),
        upsert: vi.fn()
      } as never
    });

    const updated = await service.appendMessage({
      threadId: "thread-1",
      parentId: null,
      message: { id: "message-1", role: "user", content: [{ type: "text", text: "hello" }] },
      runConfig: { channel: "web" }
    });

    expect(updated.headId).toBe("message-1");
    expect(appendMessage).toHaveBeenCalledWith("thread-1", {
      parentId: null,
      message: { id: "message-1", role: "user", content: [{ type: "text", text: "hello" }] },
      runConfig: { channel: "web" },
      createdAt: undefined,
      updatedAt: undefined
    });
  });

  it("centralizes external conversation binding writes", async () => {
    const upsert = vi.fn(async (input: unknown) => ({
      id: "binding-1",
      ...(input as object)
    }));
    const service = new ConversationRecordService({
      threads: {
        appendMessage: vi.fn(),
        create: vi.fn(),
        get: vi.fn(),
        getByExternalId: vi.fn(),
        getRepository: vi.fn(),
        list: vi.fn(),
        listForUser: vi.fn(),
        replaceMessages: vi.fn(),
        update: vi.fn()
      } as never,
      externalConversations: {
        getByExternalConversationKey: vi.fn(),
        listByThreadIds: vi.fn(),
        listRecentForIntegration: vi.fn(),
        touch: vi.fn(),
        updateThread: vi.fn(),
        upsert
      } as never
    });

    await service.upsertExternalConversation({
      integrationInstanceId: "integration-1",
      threadId: "thread-1",
      channel: "dingtalk_bot",
      externalConversationKey: "dingtalk:conversation-1",
      externalConversationId: "conversation-1",
      conversationType: "single"
    });

    expect(upsert).toHaveBeenCalledWith({
      integrationInstanceId: "integration-1",
      threadId: "thread-1",
      channel: "dingtalk_bot",
      externalConversationKey: "dingtalk:conversation-1",
      externalConversationId: "conversation-1",
      conversationType: "single"
    });
  });
});
