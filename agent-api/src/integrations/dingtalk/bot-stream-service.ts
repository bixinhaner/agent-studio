import { createHash, randomUUID } from "node:crypto";

import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream, type RobotMessage } from "dingtalk-stream";

export type DingTalkBotReplyMode = "markdown" | "ai_card_stream";

export type DingTalkBotStreamingCardReply = {
  update(content: string): Promise<void>;
  finish(content: string): Promise<void>;
  fail(content?: string): Promise<void>;
};

export type DingTalkBotReplyApi = {
  replyText(content: string): Promise<void>;
  createStreamingCard(input?: {
    contentKey?: string;
    initialData?: Record<string, unknown>;
    templateId?: string;
  }): Promise<DingTalkBotStreamingCardReply>;
};

export type DingTalkBotRuntimeConfig = {
  enabled: boolean;
  receiveMode: "stream";
  replyMode: DingTalkBotReplyMode;
  agentModeId?: string;
  knowledgeSetIds: string[];
  singleChatEnabled: boolean;
  groupChatEnabled: boolean;
  groupReplyMode: "mention_only";
  autoSyncUsers: boolean;
  streamingCardTemplateId?: string;
  streamingCardContentKey: string;
  streamingCardUpdateIntervalMs: number;
  streamingCardMinUpdateChars: number;
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
  apiBaseUrl: string;
  robot: DingTalkBotRuntimeConfig;
};

export type DingTalkBotIncomingMessage = {
  instance: DingTalkBotInstance;
  downstream: DWClientDownStream;
  robotMessage: RobotMessage;
  text: string;
  reply: DingTalkBotReplyApi;
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
  appAccessToken?: {
    token: string;
    expiresAt: number;
  };
  appAccessTokenPromise?: Promise<{ token: string; expiresAt: number }>;
};

const DEFAULT_BUSY_MESSAGE = "上一条消息还在处理中，请稍后再发。";
const DEFAULT_ERROR_MESSAGE = "这条消息处理失败，请稍后重试。";
const MAX_DINGTALK_TEXT_LENGTH = 4800;
const MAX_DINGTALK_MARKDOWN_TITLE_LENGTH = 64;
const MAX_DINGTALK_CARD_CONTENT_LENGTH = 12000;
const DEFAULT_DINGTALK_API_BASE_URL = "https://api.dingtalk.com";
const APP_ACCESS_TOKEN_REFRESH_WINDOW_MS = 60 * 1000;
const APP_ACCESS_TOKEN_FALLBACK_TTL_MS = 60 * 60 * 1000;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function getString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getNumber(record: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
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
    apiBaseUrl: instance.apiBaseUrl,
    robot: instance.robot
  });
}

function truncateDingTalkText(value: string): string {
  const text = value.trim();
  if (text.length <= MAX_DINGTALK_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_DINGTALK_TEXT_LENGTH - 20).trimEnd()}\n\n[内容过长，已截断]`;
}

function truncateDingTalkCardContent(value: string): string {
  if (value.length <= MAX_DINGTALK_CARD_CONTENT_LENGTH) return value;
  return `${value.slice(0, MAX_DINGTALK_CARD_CONTENT_LENGTH - 22).trimEnd()}\n\n[内容过长，已截断]`;
}

function createDingTalkCardOutTrackId(instanceId: string, message: RobotMessage): string {
  return createHash("sha256")
    .update([instanceId, message.conversationId, message.msgId, randomUUID()].join(":"))
    .digest("hex");
}

function dingTalkApiBaseUrl(instance: DingTalkBotInstance): string {
  return trimOrUndefined(instance.apiBaseUrl) ?? DEFAULT_DINGTALK_API_BASE_URL;
}

function getAppAccessTokenExpiresAt(payload: unknown): number {
  const expiresInSeconds = getNumber(asRecord(payload), ["expireIn", "expire_in", "expiresIn", "expires_in"]);
  if (!expiresInSeconds || expiresInSeconds <= 0) {
    return Date.now() + APP_ACCESS_TOKEN_FALLBACK_TTL_MS;
  }
  const expiresInMs = expiresInSeconds * 1000;
  const effectiveTtlMs =
    expiresInMs > APP_ACCESS_TOKEN_REFRESH_WINDOW_MS
      ? expiresInMs - APP_ACCESS_TOKEN_REFRESH_WINDOW_MS
      : expiresInMs;
  return Date.now() + Math.max(1000, effectiveTtlMs);
}

function isInvalidAccessTokenPayload(payload: unknown, status?: number): boolean {
  if (status === 401 || status === 403) return true;
  const record = asRecord(payload);
  const code = getString(record, ["errcode", "code", "subcode", "sub_code"]);
  const message = getString(record, ["message", "msg", "errmsg", "error_description", "sub_msg", "submsg"]);
  return /40014|invalid|illegal|not legal|不合法/i.test([code, message].filter(Boolean).join(" "));
}

function dingTalkApiErrorMessage(payload: unknown, fallback: string): string {
  return getString(asRecord(payload), ["message", "msg", "errmsg", "error_description", "sub_msg", "submsg"]) ?? fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
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

function stringifyCardParamMap(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    ])
  );
}

function isDingTalkBotConfigured(instance: DingTalkBotInstance): boolean {
  if (!instance.clientId || !instance.clientSecret || !instance.robot.agentModeId) return false;
  if (instance.robot.replyMode === "ai_card_stream" && !instance.robot.streamingCardTemplateId) return false;
  return true;
}

function statusFromManaged(item: ManagedClient): DingTalkBotClientStatus {
  return {
    instanceId: item.instance.id,
    slug: item.instance.slug,
    name: item.instance.name,
    enabled: item.instance.robot.enabled,
    configured: isDingTalkBotConfigured(item.instance),
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

    if (!instance.robot.enabled || !isDingTalkBotConfigured(instance)) {
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
          text,
          reply: {
            replyText: (content) => this.reply(robotMessage!, content, managed),
            createStreamingCard: (input) => this.createStreamingCard(robotMessage!, managed, input)
          }
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

  private async createStreamingCard(
    message: RobotMessage,
    managed: ManagedClient,
    input?: {
      contentKey?: string;
      initialData?: Record<string, unknown>;
      templateId?: string;
    }
  ): Promise<DingTalkBotStreamingCardReply> {
    const templateId = trimOrUndefined(input?.templateId) ?? managed.instance.robot.streamingCardTemplateId;
    if (!templateId) {
      throw new Error("DingTalk AI card template id is missing");
    }
    const contentKey = trimOrUndefined(input?.contentKey) ?? managed.instance.robot.streamingCardContentKey;
    const outTrackId = createDingTalkCardOutTrackId(managed.instance.id, message);
    const initialData = {
      ...(input?.initialData ?? {}),
      [contentKey]: String(input?.initialData?.[contentKey] ?? "")
    };

    await this.createAndDeliverCard(message, managed, {
      outTrackId,
      cardTemplateId: templateId,
      cardData: initialData
    });

    let lastSentContent = "";
    let lastSentAt = 0;
    let queue = Promise.resolve();
    const updateIntervalMs = Math.max(250, managed.instance.robot.streamingCardUpdateIntervalMs);
    const minUpdateChars = Math.max(1, managed.instance.robot.streamingCardMinUpdateChars);

    const handleQueuedError = (error: unknown) => {
      managed.lastError = error instanceof Error ? error.message : String(error);
      this.dependencies.logger?.warn("DingTalk AI card streaming update failed", {
        instanceId: managed.instance.id,
        outTrackId,
        detail: managed.lastError
      });
    };
    const enqueue = (task: () => Promise<void>, options?: { propagateError?: boolean }) => {
      const run = queue.then(task);
      queue = run.catch(handleQueuedError);
      if (options?.propagateError) {
        return run;
      }
      return queue;
    };

    const sendStreamingUpdate = (content: string, options: { finalize: boolean; error: boolean; force?: boolean }) => {
      const nextContent = truncateDingTalkCardContent(content);
      const now = Date.now();
      const charDelta = Math.abs(nextContent.length - lastSentContent.length);
      if (!options.force && !options.finalize && !options.error) {
        if (!nextContent.trim()) return queue;
        if (charDelta < minUpdateChars && now - lastSentAt < updateIntervalMs) return queue;
      }

      lastSentContent = nextContent;
      lastSentAt = now;
      return enqueue(
        () =>
          this.streamingUpdateCard(managed, {
            outTrackId,
            contentKey,
            content: nextContent,
            isFinalize: options.finalize,
            isError: options.error
          }),
        { propagateError: options.finalize }
      );
    };

    return {
      update(content: string) {
        return sendStreamingUpdate(content, { finalize: false, error: false });
      },
      finish(content: string) {
        return sendStreamingUpdate(content, { finalize: true, error: false, force: true });
      },
      fail(content?: string) {
        return sendStreamingUpdate(content ?? "", { finalize: false, error: true, force: true });
      }
    };
  }

  private async createAndDeliverCard(
    message: RobotMessage,
    managed: ManagedClient,
    input: {
      outTrackId: string;
      cardTemplateId: string;
      cardData: Record<string, unknown>;
    }
  ): Promise<void> {
    const supportForward = true;
    const body: Record<string, unknown> = {
      cardTemplateId: input.cardTemplateId,
      outTrackId: input.outTrackId,
      callbackType: "STREAM",
      cardData: {
        cardParamMap: stringifyCardParamMap(input.cardData)
      }
    };

    if (conversationScope(message) === "group") {
      body.openSpaceId = `dtv1.card//IM_GROUP.${message.conversationId}`;
      body.imGroupOpenSpaceModel = { supportForward };
      body.imGroupOpenDeliverModel = {
        robotCode: managed.instance.clientId
      };
    } else {
      const senderStaffId = trimOrUndefined(message.senderStaffId);
      if (!senderStaffId) {
        throw new Error("DingTalk AI card single-chat delivery requires senderStaffId");
      }
      body.openSpaceId = `dtv1.card//IM_ROBOT.${senderStaffId}`;
      body.imRobotOpenSpaceModel = { supportForward };
      body.imRobotOpenDeliverModel = {
        spaceType: "IM_ROBOT"
      };
    }

    await this.requestDingTalkOpenApi(managed, "/v1.0/card/instances/createAndDeliver", {
      method: "POST",
      body
    });
    managed.lastReplyAt = new Date().toISOString();
  }

  private async streamingUpdateCard(
    managed: ManagedClient,
    input: {
      outTrackId: string;
      contentKey: string;
      content: string;
      isFinalize: boolean;
      isError: boolean;
    }
  ): Promise<void> {
    await this.requestDingTalkOpenApi(managed, "/v1.0/card/streaming", {
      method: "PUT",
      body: {
        outTrackId: input.outTrackId,
        key: input.contentKey,
        content: input.content,
        isFull: true,
        isFinalize: input.isFinalize,
        isError: input.isError,
        guid: randomUUID()
      }
    });
    managed.lastReplyAt = new Date().toISOString();
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

  private async getAppAccessToken(managed: ManagedClient, options?: { forceRefresh?: boolean }): Promise<string> {
    const forceRefresh = options?.forceRefresh === true;
    if (forceRefresh) {
      managed.appAccessToken = undefined;
      managed.appAccessTokenPromise = undefined;
    } else if (managed.appAccessToken && managed.appAccessToken.expiresAt > Date.now()) {
      return managed.appAccessToken.token;
    }

    if (!managed.appAccessTokenPromise) {
      managed.appAccessTokenPromise = (async () => {
        try {
          const payload = await this.postDingTalkTokenRequest(managed);
          const token = getString(asRecord(payload), ["accessToken", "access_token"]);
          if (!token) {
            throw new Error("DingTalk app access token request did not return an access token");
          }
          const cached = {
            token,
            expiresAt: getAppAccessTokenExpiresAt(payload)
          };
          managed.appAccessToken = cached;
          return cached;
        } finally {
          managed.appAccessTokenPromise = undefined;
        }
      })();
    }

    return (await managed.appAccessTokenPromise).token;
  }

  private async postDingTalkTokenRequest(managed: ManagedClient): Promise<unknown> {
    const response = await (this.dependencies.fetchImpl ?? fetch)(`${dingTalkApiBaseUrl(managed.instance)}/v1.0/oauth2/accessToken`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        appKey: managed.instance.clientId,
        appSecret: managed.instance.clientSecret
      })
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(dingTalkApiErrorMessage(payload, `DingTalk app access token request failed (${response.status})`));
    }
    return payload;
  }

  private async requestDingTalkOpenApi(
    managed: ManagedClient,
    path: string,
    input: {
      method: "POST" | "PUT";
      body: Record<string, unknown>;
    }
  ): Promise<unknown> {
    const requestWithToken = async (forceRefresh = false): Promise<unknown> => {
      const accessToken = await this.getAppAccessToken(managed, { forceRefresh });
      const response = await (this.dependencies.fetchImpl ?? fetch)(`${dingTalkApiBaseUrl(managed.instance)}${path}`, {
        method: input.method,
        headers: {
          "content-type": "application/json",
          accept: "*/*",
          "x-acs-dingtalk-access-token": accessToken
        },
        body: JSON.stringify(input.body)
      });
      const payload = await readJson(response);
      if (!response.ok) {
        const error = new Error(dingTalkApiErrorMessage(payload, `DingTalk OpenAPI request failed (${response.status})`));
        if (isInvalidAccessTokenPayload(payload, response.status) && !forceRefresh) {
          throw Object.assign(error, { invalidAccessToken: true });
        }
        throw error;
      }

      const record = asRecord(payload);
      const success = record?.success;
      const code = getString(record, ["errcode", "code"]);
      const hasErrorCode = code !== undefined && code !== "0" && code.toLowerCase() !== "ok";
      if (success === false || hasErrorCode) {
        const error = new Error(dingTalkApiErrorMessage(payload, `DingTalk OpenAPI request failed (${code ?? "unknown"})`));
        if (isInvalidAccessTokenPayload(payload) && !forceRefresh) {
          throw Object.assign(error, { invalidAccessToken: true });
        }
        throw error;
      }
      return payload;
    };

    try {
      return await requestWithToken();
    } catch (error) {
      if ((error as { invalidAccessToken?: boolean })?.invalidAccessToken) {
        return requestWithToken(true);
      }
      throw error;
    }
  }
}
