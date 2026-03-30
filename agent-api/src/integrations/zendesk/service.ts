import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { CodexRuntime } from "../../codex-runtime.js";
import { ZendeskApiError, ZendeskClient } from "./client.js";
import { ZendeskBindingStore } from "./binding-store.js";
import {
  buildInternalNoteFromDecision,
  buildZendeskAgentPrompt,
  parseZendeskAgentDecision
} from "./prompt.js";
import {
  computeWebhookUrl,
  findZendeskReadinessGaps,
  redactZendeskSettings,
  ZendeskSettingsStore
} from "./settings-store.js";
import { ZendeskRunStore } from "./run-store.js";
import type {
  ZendeskAgentDecision,
  ZendeskIntegrationSettings,
  ZendeskOverview,
  ZendeskSetupGuide,
  ZendeskTicketContext,
  ZendeskRunStatus
} from "./types.js";

type ZendeskSettingsStoreBridge = {
  get(): Promise<ZendeskIntegrationSettings>;
  update(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    }
  ): Promise<ZendeskIntegrationSettings>;
  getForInstance?(instanceId: string): Promise<ZendeskIntegrationSettings>;
  updateForInstance?(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId: string
  ): Promise<ZendeskIntegrationSettings>;
};

type ProcessTicketResult = {
  status: ZendeskRunStatus;
  detail: string;
  runId: string;
  commentId?: number;
  requesterCommentId?: number;
  decision?: ZendeskAgentDecision["decision"];
};

function sanitizeTicketId(value: string | number): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("ticket_id 不能为空");
  return normalized;
}

function buildRunConfig(settings: ZendeskIntegrationSettings): Record<string, unknown> {
  const runConfig: Record<string, unknown> = {
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    networkAccessEnabled: settings.networkAccessEnabled,
    webSearchMode: settings.webSearchMode
  };
  if (settings.additionalDirectories.length > 0) {
    runConfig.additionalDirectories = settings.additionalDirectories;
  }
  return runConfig;
}

function normalizeMultilineBody(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 20000);
}

function selectLatestRequesterComment(context: ZendeskTicketContext) {
  const requesterId = context.ticket.requesterId;
  if (!requesterId) return undefined;
  return context.comments.find((item) => item.public && item.authorId === requesterId && item.body.trim());
}

type ResolvedAction =
  | {
      mode: "skip";
      status: ZendeskRunStatus;
      detail: string;
      decision: ZendeskAgentDecision["decision"];
    }
  | {
      mode: "comment";
      publicReply: boolean;
      body: string;
      status: ZendeskRunStatus;
      detail: string;
      decision: ZendeskAgentDecision["decision"];
    };

function resolveAction(settings: ZendeskIntegrationSettings, decision: ZendeskAgentDecision): ResolvedAction {
  if (settings.responseMode === "internal_note") {
    const body = normalizeMultilineBody(buildInternalNoteFromDecision(decision));
    return {
      mode: "comment",
      publicReply: false,
      body,
      status: decision.decision === "handoff" ? "handoff" : "noted",
      detail: decision.decision === "handoff" ? "已记录内部备注，等待人工接管" : "已记录内部备注",
      decision: decision.decision
    };
  }

  if (decision.decision === "public_reply" && decision.body.trim()) {
    return {
      mode: "comment",
      publicReply: true,
      body: normalizeMultilineBody(decision.body),
      status: "replied",
      detail: "已发送公开回复",
      decision: decision.decision
    };
  }

  if (settings.fallbackMode === "internal_note") {
    return {
      mode: "comment",
      publicReply: false,
      body: normalizeMultilineBody(buildInternalNoteFromDecision(decision)),
      status: decision.decision === "handoff" ? "handoff" : "noted",
      detail: decision.decision === "handoff" ? "模型建议转人工，已写入内部备注" : "已降级为内部备注",
      decision: decision.decision
    };
  }

  return {
    mode: "skip",
    status: "skipped",
    detail: "模型未给出公开回复，且当前配置为跳过兜底动作",
    decision: decision.decision
  };
}

function buildSetupGuide(settings: ZendeskIntegrationSettings): ZendeskSetupGuide {
  return {
    webhookUrl: computeWebhookUrl(settings),
    payloadExample: JSON.stringify(
      {
        ticket_id: "{{ticket.id}}",
        event: "ticket_updated",
        trigger_name: "Agent Studio Auto Reply"
      },
      null,
      2
    ),
    triggers: [
      {
        name: "Agent Studio Auto Reply - New Ticket",
        description: "新工单创建后触发自动答复。",
        conditions: [
          "触发条件建议：Ticket is Created",
          "Action：Notify active webhook",
          "Payload 最少只需包含 ticket_id"
        ]
      },
      {
        name: "Agent Studio Auto Reply - Requester Reply",
        description: "客户追加公开评论后触发自动答复。",
        conditions: [
          "触发条件建议：Ticket is Updated",
          "附加条件建议：Current user is end-user",
          "Action：Notify active webhook"
        ]
      }
    ]
  };
}

export class ZendeskIntegrationService {
  private readonly runtime = new CodexRuntime();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly settingsStore = new ZendeskSettingsStore(),
    private readonly bindingStore = new ZendeskBindingStore(),
    private readonly runStore = new ZendeskRunStore()
  ) {}

  private async loadSettings(instanceId?: string): Promise<ZendeskIntegrationSettings> {
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId && typeof store.getForInstance === "function") {
      return await store.getForInstance(instanceId);
    }
    return await store.get();
  }

  private async saveSettings(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId?: string
  ): Promise<ZendeskIntegrationSettings> {
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId && typeof store.updateForInstance === "function") {
      return await store.updateForInstance(patch, instanceId);
    }
    return await store.update(patch);
  }

  async getOverview(instanceId?: string): Promise<ZendeskOverview> {
    const settings = await this.loadSettings(instanceId);
    const missing = findZendeskReadinessGaps(settings);
    return {
      settings: redactZendeskSettings(settings),
      ready: missing.length === 0,
      missing,
      setup: buildSetupGuide(settings),
      runs: await this.runStore.list(50)
    };
  }

  async updateSettings(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId?: string
  ): Promise<ZendeskOverview> {
    await this.saveSettings(patch, instanceId);
    return await this.getOverview(instanceId);
  }

  async validateConnection(): Promise<{ ok: true; overview: ZendeskOverview }> {
    const settings = await this.settingsStore.get();
    const missing = findZendeskReadinessGaps(settings).filter(
      (item) => !["public_base_url", "workspace", "model"].includes(item)
    );
    if (missing.length > 0) {
      throw new Error(`Zendesk 配置不完整: ${missing.join(", ")}`);
    }

    const client = new ZendeskClient(settings);
    const me = await client.getMe();
    await this.settingsStore.rememberValidation(me);
    return {
      ok: true,
      overview: await this.getOverview()
    };
  }

  async handleWebhook(rawBody: string, headers: IncomingHttpHeaders): Promise<{ accepted: true; result: ProcessTicketResult }> {
    const settings = await this.settingsStore.get();
    if (!settings.enabled) {
      throw new Error("Zendesk 自动答复未启用");
    }
    this.verifyWebhookSignature(headers, rawBody, settings.webhookSigningSecret);
    const payload = safeParseJson(rawBody);
    const ticketId = sanitizeTicketId((payload as { ticket_id?: string | number }).ticket_id || "");
    const result = await this.enqueue(ticketId, () => this.processTicket(ticketId, "webhook", settings));
    return { accepted: true, result };
  }

  async runTicket(ticketIdInput: string | number): Promise<ProcessTicketResult> {
    const ticketId = sanitizeTicketId(ticketIdInput);
    return await this.enqueue(ticketId, async () => {
      const settings = await this.settingsStore.get();
      return await this.processTicket(ticketId, "manual", settings);
    });
  }

  private async enqueue(ticketId: string, task: () => Promise<ProcessTicketResult>): Promise<ProcessTicketResult> {
    const previous = this.queues.get(ticketId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.queues.get(ticketId) === next) {
          this.queues.delete(ticketId);
        }
      });
    this.queues.set(ticketId, next);
    return await next;
  }

  private async processTicket(
    ticketId: string,
    source: "webhook" | "manual",
    settings: ZendeskIntegrationSettings
  ): Promise<ProcessTicketResult> {
    const missing = findZendeskReadinessGaps(settings).filter((item) => item !== "public_base_url");
    if (missing.length > 0) {
      throw new Error(`Zendesk 配置不完整: ${missing.join(", ")}`);
    }

    const run = await this.runStore.create({
      ticketId,
      source,
      status: "received",
      detail: source === "manual" ? "手动触发处理中" : "收到 Zendesk webhook"
    });

    try {
      const client = new ZendeskClient(settings);
      const context = await client.getTicketContext(ticketId, settings.maxCommentHistory);
      await this.runStore.update(run.id, {
        ticketSubject: context.ticket.subject,
        detail: `已读取工单 #${ticketId} 上下文`
      });

      if (this.isExcludedByTags(settings, context.ticket.tags)) {
        await this.bindingStore.upsert(ticketId, {
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: run.id
        });
        await this.runStore.update(run.id, {
          status: "skipped",
          detail: "命中排除标签，已跳过"
        });
        return {
          status: "skipped",
          detail: "命中排除标签，已跳过",
          runId: run.id
        };
      }

      const requesterComment = selectLatestRequesterComment(context);
      if (!requesterComment) {
        await this.bindingStore.upsert(ticketId, {
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: run.id
        });
        await this.runStore.update(run.id, {
          status: "skipped",
          detail: "未找到可处理的客户公开评论"
        });
        return {
          status: "skipped",
          detail: "未找到可处理的客户公开评论",
          runId: run.id
        };
      }

      const binding = await this.bindingStore.get(ticketId);
      if (
        binding?.lastProcessedRequesterCommentId &&
        binding.lastProcessedRequesterCommentId >= requesterComment.id
      ) {
        await this.runStore.update(run.id, {
          status: "skipped",
          detail: `请求者评论 ${requesterComment.id} 已处理，跳过重复执行`,
          requesterCommentId: requesterComment.id
        });
        return {
          status: "skipped",
          detail: "重复 webhook，已跳过",
          runId: run.id,
          requesterCommentId: requesterComment.id
        };
      }

      await this.runStore.update(run.id, {
        status: "processing",
        detail: "正在调用 agent 生成答复",
        requesterCommentId: requesterComment.id
      });

      const answerText = await this.runAgent(context, settings);
      const decision = parseZendeskAgentDecision(answerText);
      const action = resolveAction(settings, decision);

      if (action.mode === "skip") {
        await this.bindingStore.upsert(ticketId, {
          lastProcessedRequesterCommentId: requesterComment.id,
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: run.id
        });
        await this.runStore.update(run.id, {
          status: action.status,
          detail: action.detail,
          decision: action.decision,
          requesterCommentId: requesterComment.id
        });
        return {
          status: action.status,
          detail: action.detail,
          runId: run.id,
          requesterCommentId: requesterComment.id,
          decision: action.decision
        };
      }

      const commentResult = await this.addCommentWithRetry(client, context, action, settings);
      await this.bindingStore.upsert(ticketId, {
        lastProcessedRequesterCommentId: requesterComment.id,
        lastAction: action.decision,
        lastRunAt: new Date().toISOString(),
        lastRunId: run.id
      });
      await this.runStore.update(run.id, {
        status: action.status,
        detail: action.detail,
        decision: action.decision,
        requesterCommentId: requesterComment.id,
        commentId: commentResult.commentId
      });

      return {
        status: action.status,
        detail: action.detail,
        runId: run.id,
        commentId: commentResult.commentId,
        requesterCommentId: requesterComment.id,
        decision: action.decision
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Zendesk 自动答复失败";
      await this.bindingStore.upsert(ticketId, {
        lastAction: "error",
        lastRunAt: new Date().toISOString(),
        lastRunId: run.id
      });
      await this.runStore.update(run.id, {
        status: "failed",
        detail: "执行失败",
        error: detail
      });
      throw error;
    }
  }

  private async runAgent(context: ZendeskTicketContext, settings: ZendeskIntegrationSettings): Promise<string> {
    const thread = await this.runtime.startThreadWithOptions({
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      workspace: settings.workspace,
      codexRunConfig: buildRunConfig(settings)
    });
    const prompt = buildZendeskAgentPrompt(context, settings);
    let output = "";
    for await (const event of this.runtime.runStreamed(thread, prompt)) {
      if (event.delta) output += event.delta;
      else if (!output && event.text) output += event.text;
    }
    return output.trim();
  }

  private async addCommentWithRetry(
    client: ZendeskClient,
    context: ZendeskTicketContext,
    action: Extract<ResolvedAction, { mode: "comment" }>,
    settings: ZendeskIntegrationSettings
  ): Promise<{ commentId?: number }> {
    try {
      return await client.addTicketComment({
        ticketId: String(context.ticket.id),
        body: action.body,
        publicReply: action.publicReply,
        autoStatus:
          context.ticket.status === "closed"
            ? "unchanged"
            : this.resolveAutoStatus(settings, context, action),
        updatedAt: context.ticket.updatedAt
      });
    } catch (error) {
      if (!(error instanceof ZendeskApiError) || error.status !== 409) {
        throw error;
      }
      const refreshed = await client.getTicketContext(String(context.ticket.id), 1);
      return await client.addTicketComment({
        ticketId: String(context.ticket.id),
        body: action.body,
        publicReply: action.publicReply,
        autoStatus:
          refreshed.ticket.status === "closed"
            ? "unchanged"
            : this.resolveAutoStatus(settings, refreshed, action),
        updatedAt: refreshed.ticket.updatedAt
      });
    }
  }

  private resolveAutoStatus(
    settings: ZendeskIntegrationSettings,
    context: ZendeskTicketContext,
    action: Extract<ResolvedAction, { mode: "comment" }>
  ): ZendeskIntegrationSettings["autoStatus"] {
    if (context.ticket.status === "solved" || context.ticket.status === "closed") return "unchanged";
    if (!action.publicReply) return "unchanged";
    return settings.autoStatus;
  }

  private isExcludedByTags(settings: ZendeskIntegrationSettings, ticketTags: string[]): boolean {
    if (settings.excludedTags.length === 0) return false;
    const tags = new Set(ticketTags.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
    return settings.excludedTags.some((item) => tags.has(item));
  }

  private verifyWebhookSignature(
    headers: IncomingHttpHeaders,
    rawBody: string,
    secret: string
  ): void {
    if (!secret) {
      throw new Error("Webhook 签名密钥未配置");
    }
    const signature = String(headers["x-zendesk-webhook-signature"] || "").trim();
    const timestamp = String(headers["x-zendesk-webhook-signature-timestamp"] || "").trim();
    if (!signature || !timestamp) {
      throw new Error("缺少 Zendesk webhook 签名头");
    }

    const tsValue = Date.parse(timestamp);
    if (Number.isFinite(tsValue)) {
      const ageMs = Math.abs(Date.now() - tsValue);
      if (ageMs > 10 * 60 * 1000) {
        throw new Error("Zendesk webhook 时间戳已过期");
      }
    }

    const expected = createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("base64");
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new Error("Zendesk webhook 签名校验失败");
    }
  }
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("Webhook payload 不是有效 JSON");
  }
}
