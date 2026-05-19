import { afterEach, describe, expect, it, vi } from "vitest";

import { DingTalkBotStreamService, type DingTalkBotInstance } from "./bot-stream-service.js";

const streamMock = vi.hoisted(() => {
  const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";
  const EventAck = {
    SUCCESS: "SUCCESS",
    LATER: "LATER"
  };

  class MockDWClient {
    static instances: MockDWClient[] = [];

    readonly callbackResponses: Array<{ messageId: string; result: unknown }> = [];
    readonly callbacks = new Map<string, (value: unknown) => void>();
    allEventListener?: (value: unknown) => unknown;
    connected = false;
    registered = false;
    config = {
      subscriptions: [{ type: "EVENT", topic: "*" }]
    };

    constructor(readonly opts: unknown) {
      MockDWClient.instances.push(this);
    }

    registerAllEventListener(listener: (value: unknown) => unknown): this {
      this.allEventListener = listener;
      return this;
    }

    registerCallbackListener(topic: string, callback: (value: unknown) => void): this {
      if (!this.config.subscriptions.some((subscription) => subscription.type === "CALLBACK" && subscription.topic === topic)) {
        this.config.subscriptions.push({ type: "CALLBACK", topic });
      }
      this.callbacks.set(topic, callback);
      return this;
    }

    async connect(): Promise<void> {
      this.connected = true;
      this.registered = true;
    }

    disconnect(): void {
      this.connected = false;
      this.registered = false;
    }

    socketCallBackResponse(messageId: string, result: unknown): void {
      this.callbackResponses.push({ messageId, result });
    }

    emitCallback(topic: string, value: unknown): void {
      const callback = this.callbacks.get(topic);
      if (!callback) throw new Error(`Missing callback for topic ${topic}`);
      callback(value);
    }
  }

  return { EventAck, MockDWClient, TOPIC_ROBOT };
});

vi.mock("dingtalk-stream", () => ({
  DWClient: streamMock.MockDWClient,
  EventAck: streamMock.EventAck,
  TOPIC_ROBOT: streamMock.TOPIC_ROBOT
}));

const TEST_INSTANCE: DingTalkBotInstance = {
  id: "instance-1",
  slug: "dingtalk-main",
  name: "DingTalk Main",
  status: "active",
  clientId: "client-id",
  clientSecret: "client-secret",
  robot: {
    enabled: true,
    receiveMode: "stream",
    agentModeId: "agent-mode-1",
    knowledgeSetIds: [],
    singleChatEnabled: true,
    groupChatEnabled: true,
    groupReplyMode: "mention_only",
    autoSyncUsers: true,
    resetCommands: ["新对话"],
    unauthorizedMessage: "无权限",
    busyMessage: "处理中",
    resetConfirmationMessage: "已开启新对话",
    unsupportedMessage: "暂时只支持文本消息。",
    errorMessage: "处理失败"
  }
};

function robotDownstream(input?: { messageId?: string; text?: string }): unknown {
  return {
    specVersion: "1.0",
    type: "CALLBACK",
    headers: {
      appId: "app-id",
      connectionId: "connection-id",
      contentType: "application/json",
      messageId: input?.messageId ?? "stream-message-1",
      time: "2026-05-19T00:00:00.000Z",
      topic: streamMock.TOPIC_ROBOT
    },
    data: JSON.stringify({
      conversationId: "conversation-1",
      chatbotCorpId: "corp-1",
      chatbotUserId: "bot-user-1",
      msgId: "ding-message-1",
      senderNick: "Alice",
      isAdmin: false,
      senderStaffId: "staff-1",
      sessionWebhookExpiredTime: Date.now() + 60_000,
      createAt: Date.now(),
      senderCorpId: "corp-1",
      conversationType: "1",
      senderId: "sender-1",
      sessionWebhook: "https://example.com/session-webhook",
      robotCode: "robot-1",
      msgtype: "text",
      text: {
        content: input?.text ?? "你好"
      }
    })
  };
}

describe("DingTalkBotStreamService", () => {
  afterEach(() => {
    streamMock.MockDWClient.instances = [];
    vi.restoreAllMocks();
  });

  it("registers robot messages as callbacks, acks immediately, and handles the message", async () => {
    const handleMessage = vi.fn(async (_input: unknown) => ({
      status: "replied" as const,
      replyText: "你好，我在。"
    }));
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }));
    const service = new DingTalkBotStreamService({
      listInstances: async () => [TEST_INSTANCE],
      handleMessage,
      fetchImpl: fetchMock as typeof fetch
    });

    await service.refresh();

    const client = streamMock.MockDWClient.instances[0];
    expect(client.config.subscriptions).toEqual([{ type: "CALLBACK", topic: streamMock.TOPIC_ROBOT }]);
    expect(client.allEventListener).toBeUndefined();

    client.emitCallback(streamMock.TOPIC_ROBOT, robotDownstream());

    expect(client.callbackResponses).toEqual([
      {
        messageId: "stream-message-1",
        result: { status: streamMock.EventAck.SUCCESS }
      }
    ]);
    await vi.waitFor(() => expect(handleMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      msgtype: "markdown",
      markdown: {
        title: "你好，我在。",
        text: "你好，我在。"
      }
    });
    expect(handleMessage.mock.calls[0]?.[0]).toMatchObject({
      instance: { id: "instance-1" },
      text: "你好",
      robotMessage: {
        msgId: "ding-message-1",
        conversationId: "conversation-1"
      }
    });

    service.stop();
  });

  it("falls back to text when markdown replies are rejected", async () => {
    const fetchMock = vi
      .fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("bad markdown", { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const service = new DingTalkBotStreamService({
      listInstances: async () => [TEST_INSTANCE],
      handleMessage: async () => ({
        status: "replied",
        replyText: "**加粗回复**"
      }),
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    await service.refresh();

    streamMock.MockDWClient.instances[0].emitCallback(streamMock.TOPIC_ROBOT, robotDownstream());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      msgtype: "markdown"
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      msgtype: "text",
      text: {
        content: "**加粗回复**"
      }
    });

    service.stop();
  });
});
