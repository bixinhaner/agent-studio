import { describe, expect, it, vi } from "vitest";

import { ActionConnectorConversationRecorder } from "./conversation-recorder.js";
import type { StoredMessageItem, ThreadRecord } from "../../persistence/thread-repository.js";

function createConversationStore() {
  const threads = new Map<string, ThreadRecord>();
  const bindings = new Map<string, any>();
  const calls = {
    createThread: [] as unknown[],
    upsertExternalConversation: [] as unknown[],
    usage: [] as unknown[]
  };

  return {
    calls,
    store: {
      async getExternalConversationBinding(key: string) {
        return bindings.get(key);
      },
      async getThread(threadId: string) {
        return threads.get(threadId);
      },
      async createThread(input: any) {
        calls.createThread.push(input);
        const thread: ThreadRecord = {
          id: input.id || "thread-1",
          organizationId: input.organizationId,
          userId: input.userId,
          externalId: input.externalId,
          status: "regular",
          title: input.title,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          workspace: input.workspace,
          codexRunConfig: input.codexRunConfig,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          headId: input.headId ?? null,
          messages: [],
          feedback: []
        };
        threads.set(thread.id, thread);
        return thread;
      },
      async upsertExternalConversation(input: any) {
        calls.upsertExternalConversation.push(input);
        const binding = {
          id: "binding-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...input
        };
        bindings.set(input.externalConversationKey, binding);
        return binding;
      },
      async touchExternalConversation(input: any) {
        const existing = bindings.get(input.externalConversationKey);
        const updated = { ...existing, ...input, updatedAt: new Date().toISOString() };
        bindings.set(input.externalConversationKey, updated);
        return updated;
      },
      async getMessageRepository(threadId: string) {
        const thread = threads.get(threadId);
        return { headId: thread?.headId ?? null, messages: thread?.messages ?? [] };
      },
      async appendMessage(input: { threadId: string; parentId: string | null; message: any; runConfig?: Record<string, unknown> }) {
        const thread = threads.get(input.threadId);
        if (!thread) throw new Error("missing thread");
        const item: StoredMessageItem = {
          parentId: input.parentId,
          message: input.message,
          runConfig: input.runConfig
        };
        thread.messages.push(item);
        thread.headId = input.message.id;
        thread.updatedAt = new Date().toISOString();
        return thread;
      }
    }
  };
}

describe("ActionConnectorConversationRecorder", () => {
  it("records connector turns without mapping to an Agent Studio user", async () => {
    const conversations = createConversationStore();
    const usageRecorder = {
      recordDirectUsage: vi.fn(async (input: unknown) => {
        conversations.calls.usage.push(input);
        return {};
      })
    };
    const recorder = new ActionConnectorConversationRecorder({
      conversations: conversations.store as never,
      usageRecorder: usageRecorder as never
    });

    const result = await recorder.recordTurn({
      connector: {
        id: "connector-1",
        name: "Operations System",
        slug: "external-ops",
        organizationId: "org-1"
      },
      displayName: "Operations System",
      conversationId: "conversation-1",
      runId: "run-1",
      callId: "call-1",
      request: {
        message: "show online devices",
        mode: "execute",
        locale: "en-US",
        timezone: "UTC",
        context: { path: "/devices", title: "Devices" }
      },
      identity: {
        externalUserId: "external-user-1",
        externalUserName: "External Operator",
        roles: ["operator"],
        scopes: ["agent-runtime"]
      },
      selectedAction: { actionId: "device.search", input: { isOnline: true } },
      descriptor: {
        id: "device.search",
        title: "Search devices",
        description: "Search visible devices",
        risk: "read"
      },
      preview: { summary: "Read online devices" },
      result: { actionId: "device.search", status: "ok", result: { total: 1 } },
      summaryText: "Read 1 device.",
      status: "completed"
    });

    expect(result.threadId).toBeTruthy();
    expect(conversations.calls.createThread[0]).toMatchObject({
      organizationId: "org-1",
      model: "action-connector",
      workspace: "external-action-connector"
    });
    expect((conversations.calls.createThread[0] as { userId?: string }).userId).toBeUndefined();
    expect(conversations.calls.upsertExternalConversation[0]).toMatchObject({
      userId: null,
      channel: "action_connector",
      externalUserId: "external-user-1",
      externalUserName: "External Operator"
    });
    expect(conversations.calls.usage[0]).toMatchObject({
      organizationId: "org-1",
      model: "action-connector",
      featureType: "action_connector",
      resultStatus: "success"
    });
    expect((conversations.calls.usage[0] as { userId?: string }).userId).toBeUndefined();
  });
});
