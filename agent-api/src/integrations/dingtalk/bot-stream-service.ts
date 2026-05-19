import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream, type RobotMessage } from "dingtalk-stream";

export type DingTalkBotRuntimeConfig = {
  enabled: boolean;
  receiveMode: "stream";
  agentModeId?: string;
  knowledgeSetIds: string[];
  singleChatEnabled: boolean;
  groupChatEnabled: boolean;
  groupReplyMode: "mention_only";
  autoSyncUsers: boolean;
  resetCommands: string[];
  unauthorizedMessage: string;
  busyMessage: string;
  resetConfirmationMessage: string;
  unsupportedMessage: string;
  errorMessage: string;
};

export type DingTalkBotInstance = {
  id: string;
  slug: string;
  name: string;
  status: string;
  organizationId?: string | null;
  clientId: string;
  clientSecret: string;
  robot: DingTalkBotRuntimeConfig;
};

export type DingTalkBotIncomingMessage = {
  instance: DingTalkBotInstance;
  downstream: DWClientDownStream;
  robotMessage: RobotMessage;
  text: string;
};

export type DingTalkBotHandleResult = {
  status: "replied" | "ignored" | "failed";
  replyText?: string;
  detail?: string;
};

export type DingTalkBotClientStatus = {
  instanceId: string;
  slug: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  registered: boolean;
  startedAt?: string;
  lastEventAt?: string;
  lastReplyAt?: string;
  lastError?: string;
  processedCount: number;
  ignoredCount: number;
};

type ManagedClient = {
  instance: DingTalkBotInstance;
  fingerprint: string;
  client?: DWClient;
  connected: boolean;
  registered: boolean;
  startedAt?: string;
  lastEventAt?: string;
  lastReplyAt?: string;
  lastError?: string;
  processedCount: number;
  ignoredCount: number;
};

const DEFAULT_BUSY_MESSAGE = "上一条消息还在处理中，请稍后再发。";
const DEFAULT_ERROR_MESSAGE = "这条消息处理失败，请稍后重试。";
const MAX_DINGTALK_TEXT_LENGTH = 4800;
const MAX_DINGTALK_MARKDOWN_TITLE_LENGTH = 64;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asRobotMessage(value: unknown): RobotMessage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const msgId = trimOrUndefined(typeof record.msgId === "string" ? record.msgId : undefined);
  const conversationId = trimOrUndefined(typeof record.conversationId === "string" ? record.conversationId : undefined);
  const msgtype = trimOrUndefined(typeof record.msgtype === "string" ? record.msgtype : undefined);
  if (!msgId || !conversationId || !msgtype) return undefined;
  return value as RobotMessage;
}

function parseDownstreamData(data: string): unknown {
  if (!data.trim()) return {};
  return JSON.parse(data);
}

function robotTextContent(message: RobotMessage): string {
  if (message.msgtype !== "text") return "";
  return trimOrUndefined(message.text?.content) ?? "";
}

function conversationScope(message: RobotMessage): "single" | "group" {
  return message.conversationType === "1" ? "single" : "group";
}

function conversationLockKey(instanceId: string, message: RobotMessage): string {
  return [
    "dingtalk_bot",
    instanceId,
    conversationScope(message),
    trimOrUndefined(message.conversationId) ?? "unknown"
  ].join(":");
}

function fingerprint(instance: DingTalkBotInstance): string {
  return JSON.stringify({
    id: instance.id,
    status: instance.status,
    clientId: instance.clientId,
    robot: instance.robot
  });
}

function truncateDingTalkText(value: string): string {
  const text = value.trim();
  if (text.length <= MAX_DINGTALK_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_DINGTALK_TEXT_LENGTH - 20).trimEnd()}\n\n[内容过长，已截断]`;
}

function dingtalkMarkdownTitle(text: string, fallback: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? fallback;
  const normalized = firstLine
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[#>*\-\d.\s]+/, "")
    .replace(/[*_`~]/g, "")
    .trim();
  const title = normalized || fallback || "机器人回复";
  return title.length <= MAX_DINGTALK_MARKDOWN_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_DINGTALK_MARKDOWN_TITLE_LENGTH - 1).trimEnd()}…`;
}

function dingtalkMarkdownPayload(content: string, title: string): Record<string, unknown> {
  return {
    msgtype: "markdown",
    markdown: {
      title,
      text: content
    }
  };
}

function dingtalkTextPayload(content: string): Record<string, unknown> {
  return {
    msgtype: "text",
    text: {
      content
    }
  };
}

function statusFromManaged(item: ManagedClient): DingTalkBotClientStatus {
  return {
    instanceId: item.instance.id,
    slug: item.instance.slug,
    name: item.instance.name,
    enabled: item.instance.robot.enabled,
    configured: Boolean(item.instance.clientId && item.instance.clientSecret && item.instance.robot.agentModeId),
    connected: item.connected,
    registered: item.registered,
    startedAt: item.startedAt,
    lastEventAt: item.lastEventAt,
    lastReplyAt: item.lastReplyAt,
    lastError: item.lastError,
    processedCount: item.processedCount,
    ignoredCount: item.ignoredCount
  };
}

export class DingTalkBotStreamService {
  private readonly clients = new Map<string, ManagedClient>();
  private readonly inFlight = new Set<string>();
  private syncTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dependencies: {
      listInstances(): Promise<DingTalkBotInstance[]>;
      handleMessage(input: DingTalkBotIncomingMessage): Promise<DingTalkBotHandleResult>;
      fetchImpl?: typeof fetch;
      logger?: Pick<Console, "info" | "warn" | "error">;
    }
  ) {}

  start(input?: { intervalMs?: number }): void {
    void this.refresh();
    const intervalMs = Math.max(10_000, input?.intervalMs ?? 60_000);
    this.syncTimer = setInterval(() => {
      void this.refresh();
    }, intervalMs);
    this.syncTimer.unref?.();
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    for (const instanceId of [...this.clients.keys()]) {
      this.stopClient(instanceId);
    }
  }

  async restart(instanceId?: string): Promise<DingTalkBotClientStatus[]> {
    if (instanceId) {
      this.stopClient(instanceId);
    } else {
      for (const id of [...this.clients.keys()]) {
        this.stopClient(id);
      }
    }
    await this.refresh();
    return this.getStatuses(instanceId);
  }

  getStatuses(instanceId?: string): DingTalkBotClientStatus[] {
    const items = [...this.clients.values()].filter((item) => !instanceId || item.instance.id === instanceId);
    return items.map(statusFromManaged);
  }

  async refresh(): Promise<void> {
    let instances: DingTalkBotInstance[] = [];
    try {
      instances = await this.dependencies.listInstances();
    } catch (error) {
      this.dependencies.logger?.warn("failed to list DingTalk bot stream instances", error);
      return;
    }

    const activeIds = new Set(instances.map((item) => item.id));
    for (const instanceId of [...this.clients.keys()]) {
      if (!activeIds.has(instanceId)) {
        this.stopClient(instanceId);
      }
    }

    for (const instance of instances) {
      const nextFingerprint = fingerprint(instance);
      const existing = this.clients.get(instance.id);
      if (existing?.fingerprint === nextFingerprint) {
        existing.connected = Boolean(existing.client?.connected);
        existing.registered = Boolean(existing.client?.registered);
        continue;
      }
      if (existing) {
        this.stopClient(instance.id);
      }
      await this.startClient(instance, nextFingerprint);
    }
  }

  private stopClient(instanceId: string): void {
    const existing = this.clients.get(instanceId);
    if (!existing) return;
    try {
      existing.client?.disconnect();
    } catch (error) {
      this.dependencies.logger?.warn("failed to disconnect DingTalk bot stream client", {
        instanceId,
        error
      });
    }
    this.clients.delete(instanceId);
  }

  private async startClient(instance: DingTalkBotInstance, nextFingerprint: string): Promise<void> {
    const managed: ManagedClient = {
      instance,
      fingerprint: nextFingerprint,
      connected: false,
      registered: false,
      startedAt: new Date().toISOString(),
      processedCount: 0,
      ignoredCount: 0
    };
    this.clients.set(instance.id, managed);

    if (!instance.robot.enabled || !instance.clientId || !instance.clientSecret || !instance.robot.agentModeId) {
      managed.lastError = "机器人对话未启用或配置不完整";
      return;
    }

    try {
      const client = new DWClient({
        clientId: instance.clientId,
        clientSecret: instance.clientSecret,
        keepAlive: true,
        ua: `agent-studio/${instance.slug}`
      });
      client.config.subscriptions = [];
      client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
        this.ackCallback(client, managed, downstream);
        this.onDownstream(managed, downstream);
      });
      managed.client = client;
      await client.connect();
      managed.connected = Boolean(client.connected);
      managed.registered = Boolean(client.registered);
      this.dependencies.logger?.info("DingTalk bot stream client started", {
        instanceId: instance.id,
        slug: instance.slug
      });
    } catch (error) {
      managed.lastError = error instanceof Error ? error.message : String(error);
      this.dependencies.logger?.warn("failed to start DingTalk bot stream client", {
        instanceId: instance.id,
        detail: managed.lastError
      });
    }
  }

  private ackCallback(client: DWClient, managed: ManagedClient, downstream: DWClientDownStream): void {
    try {
      client.socketCallBackResponse(downstream.headers.messageId, {
        status: EventAck.SUCCESS
      });
    } catch (error) {
      managed.lastError = error instanceof Error ? error.message : String(error);
      this.dependencies.logger?.warn("failed to ack DingTalk bot callback", {
        instanceId: managed.instance.id,
        messageId: downstream.headers.messageId,
        detail: managed.lastError
      });
    }
  }

  private onDownstream(managed: ManagedClient, downstream: DWClientDownStream): void {
    managed.lastEventAt = new Date().toISOString();
    managed.connected = Boolean(managed.client?.connected);
    managed.registered = Boolean(managed.client?.registered);
    if (downstream.headers.topic !== TOPIC_ROBOT) {
      managed.ignoredCount += 1;
      return;
    }

    let robotMessage: RobotMessage | undefined;
    try {
      robotMessage = asRobotMessage(parseDownstreamData(downstream.data));
    } catch (error) {
      managed.ignoredCount += 1;
      managed.lastError = error instanceof Error ? error.message : String(error);
      return;
    }
    if (!robotMessage) {
      managed.ignoredCount += 1;
      managed.lastError = "收到无法识别的钉钉机器人消息";
      return;
    }
    this.dependencies.logger?.info("DingTalk bot callback received", {
      instanceId: managed.instance.id,
      slug: managed.instance.slug,
      msgId: robotMessage.msgId,
      conversationId: robotMessage.conversationId,
      conversationType: robotMessage.conversationType,
      msgtype: robotMessage.msgtype
    });

    const text = robotTextContent(robotMessage);
    if (!text || robotMessage.msgtype !== "text") {
      managed.ignoredCount += 1;
      void this.reply(robotMessage, managed.instance.robot.unsupportedMessage || "暂时只支持文本消息。", managed);
      return;
    }

    const scope = conversationScope(robotMessage);
    if ((scope === "single" && !managed.instance.robot.singleChatEnabled) || (scope === "group" && !managed.instance.robot.groupChatEnabled)) {
      managed.ignoredCount += 1;
      return;
    }

    const lockKey = conversationLockKey(managed.instance.id, robotMessage);
    if (this.inFlight.has(lockKey)) {
      managed.ignoredCount += 1;
      void this.reply(robotMessage, managed.instance.robot.busyMessage || DEFAULT_BUSY_MESSAGE, managed);
      return;
    }

    this.inFlight.add(lockKey);
    void Promise.resolve()
      .then(() =>
        this.dependencies.handleMessage({
          instance: managed.instance,
          downstream,
          robotMessage,
          text
        })
      )
      .then(async (result) => {
        if (result.replyText) {
          await this.reply(robotMessage!, result.replyText, managed);
        }
        if (result.status === "ignored") {
          managed.ignoredCount += 1;
        } else {
          managed.processedCount += 1;
        }
        if (result.status === "failed") {
          managed.lastError = result.detail || "DingTalk bot message failed";
        }
      })
      .catch(async (error) => {
        const detail = error instanceof Error ? error.message : String(error);
        managed.lastError = detail;
        managed.processedCount += 1;
        await this.reply(robotMessage!, managed.instance.robot.errorMessage || DEFAULT_ERROR_MESSAGE, managed).catch(() => undefined);
      })
      .finally(() => {
        this.inFlight.delete(lockKey);
      });
  }

  private async reply(message: RobotMessage, content: string, managed: ManagedClient): Promise<void> {
    const webhook = trimOrUndefined(message.sessionWebhook);
    if (!webhook) {
      throw new Error("DingTalk sessionWebhook is missing");
    }
    const text = truncateDingTalkText(content);
    if (!text) return;
    const markdownResponse = await this.postReply(webhook, dingtalkMarkdownPayload(text, dingtalkMarkdownTitle(text, managed.instance.name)));
    if (!markdownResponse.ok) {
      const textResponse = await this.postReply(webhook, dingtalkTextPayload(text));
      if (!textResponse.ok) {
        throw new Error(`DingTalk sessionWebhook reply failed (${markdownResponse.status}, fallback ${textResponse.status})`);
      }
    }
    managed.lastReplyAt = new Date().toISOString();
  }

  private async postReply(webhook: string, payload: Record<string, unknown>): Promise<Response> {
    return await (this.dependencies.fetchImpl ?? fetch)(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }
}
