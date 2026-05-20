import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";

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
  ZendeskBindingRecord,
  ZendeskIntegrationSettings,
  ZendeskOverview,
  ZendeskSetupGuide,
  ZendeskTicketContext,
  ZendeskRunStatus
} from "./types.js";
import type { ReasoningEffort } from "../../model-config.js";

type ZendeskSettingsStoreBridge = {
  get(): Promise<ZendeskIntegrationSettings>;
  getForInstance(instanceId: string): Promise<ZendeskIntegrationSettings>;
  update(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    }
  ): Promise<ZendeskIntegrationSettings>;
  updateForInstance(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId: string
  ): Promise<ZendeskIntegrationSettings>;
  rememberValidation(user: { id: number; name: string; email?: string; role?: string }): Promise<ZendeskIntegrationSettings>;
  rememberValidationForInstance(
    user: { id: number; name: string; email?: string; role?: string },
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

type ZendeskAgentRuntimeOptions = {
  runtime?: CodexRuntime;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
};

type ZendeskRuntimeThread = Awaited<ReturnType<CodexRuntime["startThreadWithOptions"]>>;

type ZendeskRuntimeLike = {
  startThreadWithOptions(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<ZendeskRuntimeThread>;
  resumeThreadWithOptions(options: {
    threadId: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<ZendeskRuntimeThread>;
  runStreamed(thread: ZendeskRuntimeThread, message: string): AsyncGenerator<{ type: string; delta?: string; text?: string; raw?: unknown }>;
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
  return context.comments.find(
    (item) => item.public && item.authorId === requesterId && (item.body.trim() || (item.attachments?.length ?? 0) > 0)
  );
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractCodexThreadIdFromThread(thread: unknown): string | undefined {
  if (!thread || typeof thread !== "object") return undefined;
  return trimOrUndefined((thread as { id?: unknown }).id);
}

function extractCodexThreadIdFromEvent(event: { type?: string; raw?: unknown }): string | undefined {
  if (event.type !== "thread.started") return undefined;
  const raw = event.raw && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : undefined;
  return trimOrUndefined(raw?.thread_id);
}

function sanitizePathSegment(value: string | number | undefined, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function sanitizeFileName(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:\0]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return normalized || fallback;
}

function isMimeAllowed(contentType: string | undefined, allowed: string[]): boolean {
  const normalized = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return allowed.some((item) => {
    const pattern = item.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === "*/*" || pattern === normalized) return true;
    if (pattern.endsWith("/*")) {
      return normalized.startsWith(`${pattern.slice(0, -1)}`);
    }
    return false;
  });
}

function attachmentDisplaySize(bytes: number | undefined): string {
  if (!Number.isFinite(bytes)) return "";
  const value = Number(bytes);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function cloneContext(context: ZendeskTicketContext): ZendeskTicketContext {
  return {
    ticket: { ...context.ticket, tags: [...context.ticket.tags] },
    comments: context.comments.map((comment) => ({
      ...comment,
      attachments: (comment.attachments ?? []).map((attachment) => ({ ...attachment }))
    }))
  };
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

function buildSetupGuide(settings: ZendeskIntegrationSettings, instanceId?: string): ZendeskSetupGuide {
  return {
    webhookUrl: computeWebhookUrl(settings, instanceId),
    legacyWebhookUrl: instanceId ? computeWebhookUrl(settings) : undefined,
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
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dependencies: {
      resolveRuntime?: () => Promise<CodexRuntime>;
      resolveAgentRuntime?: (input: {
        settings: ZendeskIntegrationSettings;
        instanceId?: string;
        ticketId: string;
        runId: string;
        source: "webhook" | "manual";
      }) => Promise<ZendeskAgentRuntimeOptions>;
    } = {},
    private readonly settingsStore = new ZendeskSettingsStore(),
    private readonly bindingStore = new ZendeskBindingStore(),
    private readonly runStore = new ZendeskRunStore()
  ) {}

  private async loadSettings(instanceId?: string): Promise<ZendeskIntegrationSettings> {
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId) {
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
    if (instanceId) {
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
      setup: buildSetupGuide(settings, instanceId),
      runs: await this.runStore.listForInstance(50, instanceId)
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

  async validateConnection(instanceId?: string): Promise<{ ok: true; overview: ZendeskOverview }> {
    const settings = await this.loadSettings(instanceId);
    const missing = findZendeskReadinessGaps(settings).filter(
      (item) => !["public_base_url", "agent_mode_id"].includes(item)
    );
    if (missing.length > 0) {
      throw new Error(`Zendesk 配置不完整: ${missing.join(", ")}`);
    }

    const client = new ZendeskClient(settings);
    const me = await client.getMe();
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId) {
      await store.rememberValidationForInstance(me, instanceId);
    } else {
      await store.rememberValidation(me);
    }
    return {
      ok: true,
      overview: await this.getOverview(instanceId)
    };
  }

  async handleWebhook(
    rawBody: string,
    headers: IncomingHttpHeaders,
    instanceId?: string
  ): Promise<{ accepted: true; result: ProcessTicketResult }> {
    const settings = await this.loadSettings(instanceId);
    if (!settings.enabled) {
      throw new Error("Zendesk 自动答复未启用");
    }
    this.verifyWebhookSignature(headers, rawBody, settings.webhookSigningSecret);
    const payload = safeParseJson(rawBody);
    const ticketId = sanitizeTicketId((payload as { ticket_id?: string | number }).ticket_id || "");
    const run = await this.runStore.create({
      instanceId,
      ticketId,
      source: "webhook",
      status: "received",
      detail: "已接收 Zendesk webhook，后台处理中"
    });
    void this.enqueue(instanceId, ticketId, () => this.processTicket(ticketId, "webhook", settings, instanceId, run.id))
      .catch((error) => {
        console.error("[zendesk] background webhook run failed", error);
      });
    return {
      accepted: true,
      result: {
        status: "received",
        detail: "已接收 Zendesk webhook，后台处理中",
        runId: run.id
      }
    };
  }

  async runTicket(ticketIdInput: string | number, instanceId?: string): Promise<ProcessTicketResult> {
    const ticketId = sanitizeTicketId(ticketIdInput);
    return await this.enqueue(instanceId, ticketId, async () => {
      const settings = await this.loadSettings(instanceId);
      return await this.processTicket(ticketId, "manual", settings, instanceId);
    });
  }

  private async enqueue(
    instanceId: string | undefined,
    ticketId: string,
    task: () => Promise<ProcessTicketResult>
  ): Promise<ProcessTicketResult> {
    const key = `${instanceId?.trim() || "legacy"}:${ticketId}`;
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.queues.get(key) === next) {
          this.queues.delete(key);
        }
      });
    this.queues.set(key, next);
    return await next;
  }

  private async processTicket(
    ticketId: string,
    source: "webhook" | "manual",
    settings: ZendeskIntegrationSettings,
    instanceId?: string,
    existingRunId?: string
  ): Promise<ProcessTicketResult> {
    const runId =
      existingRunId ||
      (
        await this.runStore.create({
          instanceId,
          ticketId,
          source,
          status: "received",
          detail: source === "manual" ? "手动触发处理中" : "收到 Zendesk webhook"
        })
      ).id;

    try {
      const missing = findZendeskReadinessGaps(settings).filter((item) => item !== "public_base_url");
      if (missing.length > 0) {
        throw new Error(`Zendesk 配置不完整: ${missing.join(", ")}`);
      }

      const client = new ZendeskClient(settings);
      const context = await client.getTicketContext(ticketId, settings.maxCommentHistory);
      await this.runStore.update(runId, {
        ticketSubject: context.ticket.subject,
        detail: `已读取工单 #${ticketId} 上下文`
      });

      if (this.isExcludedByTags(settings, context.ticket.tags)) {
        await this.bindingStore.upsert(ticketId, {
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: runId
        }, instanceId);
        await this.runStore.update(runId, {
          status: "skipped",
          detail: "命中排除标签，已跳过"
        });
        return {
          status: "skipped",
          detail: "命中排除标签，已跳过",
          runId
        };
      }

      const requesterComment = selectLatestRequesterComment(context);
      if (!requesterComment) {
        await this.bindingStore.upsert(ticketId, {
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: runId
        }, instanceId);
        await this.runStore.update(runId, {
          status: "skipped",
          detail: "未找到可处理的客户公开评论"
        });
        return {
          status: "skipped",
          detail: "未找到可处理的客户公开评论",
          runId
        };
      }

      const binding = await this.bindingStore.get(ticketId, instanceId);
      if (
        binding?.lastProcessedRequesterCommentId &&
        binding.lastProcessedRequesterCommentId >= requesterComment.id
      ) {
        await this.runStore.update(runId, {
          status: "skipped",
          detail: `请求者评论 ${requesterComment.id} 已处理，跳过重复执行`,
          requesterCommentId: requesterComment.id
        });
        return {
          status: "skipped",
          detail: "重复 webhook，已跳过",
          runId,
          requesterCommentId: requesterComment.id
        };
      }

      await this.runStore.update(runId, {
        status: "processing",
        detail: "正在调用 agent 生成答复",
        requesterCommentId: requesterComment.id
      });

      const answerText = await this.runAgent(context, settings, client, binding, {
        instanceId,
        ticketId,
        runId,
        source
      });
      const decision = parseZendeskAgentDecision(answerText);
      const action = resolveAction(settings, decision);

      if (action.mode === "skip") {
        await this.bindingStore.upsert(ticketId, {
          lastProcessedRequesterCommentId: requesterComment.id,
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: runId
        }, instanceId);
        await this.runStore.update(runId, {
          status: action.status,
          detail: action.detail,
          decision: action.decision,
          requesterCommentId: requesterComment.id
        });
        return {
          status: action.status,
          detail: action.detail,
          runId,
          requesterCommentId: requesterComment.id,
          decision: action.decision
        };
      }

      const commentResult = await this.addCommentWithRetry(client, context, action, settings);
      await this.bindingStore.upsert(ticketId, {
        lastProcessedRequesterCommentId: requesterComment.id,
        lastAction: action.decision,
        lastRunAt: new Date().toISOString(),
        lastRunId: runId
      }, instanceId);
      await this.runStore.update(runId, {
        status: action.status,
        detail: action.detail,
        decision: action.decision,
        requesterCommentId: requesterComment.id,
        commentId: commentResult.commentId
      });

      return {
        status: action.status,
        detail: action.detail,
        runId,
        commentId: commentResult.commentId,
        requesterCommentId: requesterComment.id,
        decision: action.decision
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Zendesk 自动答复失败";
      await this.bindingStore.upsert(ticketId, {
        lastAction: "error",
        lastRunAt: new Date().toISOString(),
        lastRunId: runId
      }, instanceId);
      await this.runStore.update(runId, {
        status: "failed",
        detail: "执行失败",
        error: detail
      });
      throw error;
    }
  }

  private async runAgent(
    context: ZendeskTicketContext,
    settings: ZendeskIntegrationSettings,
    client: ZendeskClient,
    binding: ZendeskBindingRecord | undefined,
    run: {
      instanceId?: string;
      ticketId: string;
      runId: string;
      source: "webhook" | "manual";
    }
  ): Promise<string> {
    const runtimeOptions = this.dependencies.resolveAgentRuntime
      ? await this.dependencies.resolveAgentRuntime({
          settings,
          instanceId: run.instanceId,
          ticketId: run.ticketId,
          runId: run.runId,
          source: run.source
        })
      : {
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          workspace: settings.workspace,
          codexRunConfig: buildRunConfig(settings)
        };
    const runtime = (runtimeOptions.runtime ||
      (this.dependencies.resolveRuntime ? await this.dependencies.resolveRuntime() : new CodexRuntime())) as ZendeskRuntimeLike;
    const preparedContext = await this.prepareContextAttachments(context, settings, client, runtimeOptions.workspace, run.runId);
    let observedCodexThreadId = trimOrUndefined(binding?.codexThreadId);
    let thread: ZendeskRuntimeThread | undefined;

    if (observedCodexThreadId) {
      try {
        thread = await runtime.resumeThreadWithOptions({
          threadId: observedCodexThreadId,
          model: runtimeOptions.model,
          reasoningEffort: runtimeOptions.reasoningEffort,
          workspace: runtimeOptions.workspace,
          codexRunConfig: runtimeOptions.codexRunConfig
        });
      } catch (error) {
        console.warn("[zendesk] failed to resume codex thread, starting a new one", {
          ticketId: run.ticketId,
          instanceId: run.instanceId,
          codexThreadId: observedCodexThreadId,
          detail: error instanceof Error ? error.message : String(error)
        });
        observedCodexThreadId = undefined;
      }
    }

    if (!thread) {
      thread = await runtime.startThreadWithOptions({
        model: runtimeOptions.model,
        reasoningEffort: runtimeOptions.reasoningEffort,
        workspace: runtimeOptions.workspace,
        codexRunConfig: runtimeOptions.codexRunConfig
      });
      observedCodexThreadId = extractCodexThreadIdFromThread(thread) || observedCodexThreadId;
    }

    await this.rememberRuntimeBinding(run.ticketId, run.instanceId, {
      codexThreadId: observedCodexThreadId,
      workspacePath: runtimeOptions.workspace,
      runId: run.runId
    });

    const prompt = buildZendeskAgentPrompt(preparedContext, settings);
    let output = "";
    for await (const event of runtime.runStreamed(thread, prompt)) {
      observedCodexThreadId = extractCodexThreadIdFromEvent(event) || observedCodexThreadId;
      if (event.delta) output += event.delta;
      else if (!output && event.text) output += event.text;
    }

    await this.rememberRuntimeBinding(run.ticketId, run.instanceId, {
      codexThreadId: observedCodexThreadId,
      workspacePath: runtimeOptions.workspace,
      runId: run.runId
    });
    return output.trim();
  }

  private async rememberRuntimeBinding(
    ticketId: string,
    instanceId: string | undefined,
    input: {
      codexThreadId?: string;
      workspacePath?: string;
      runId: string;
    }
  ): Promise<void> {
    if (!trimOrUndefined(input.codexThreadId) && !trimOrUndefined(input.workspacePath)) return;
    await this.bindingStore.upsert(
      ticketId,
      {
        codexThreadId: trimOrUndefined(input.codexThreadId),
        workspacePath: trimOrUndefined(input.workspacePath),
        lastRunId: input.runId
      },
      instanceId
    );
  }

  private async prepareContextAttachments(
    context: ZendeskTicketContext,
    settings: ZendeskIntegrationSettings,
    client: ZendeskClient,
    workspacePath: string,
    runId: string
  ): Promise<ZendeskTicketContext> {
    const next = cloneContext(context);
    if (!settings.attachmentReadingEnabled) {
      for (const comment of next.comments) {
        comment.attachments = comment.attachments.map((attachment) => ({
          ...attachment,
          downloadStatus: "skipped",
          downloadReason: "后台未启用附件读取"
        }));
      }
      return next;
    }

    const allowed = settings.allowedAttachmentMimeTypes;
    const baseDir = path.join(workspacePath, ".zendesk", "attachments", `run-${sanitizePathSegment(runId, "run")}`);
    await fs.mkdir(baseDir, { recursive: true });

    let downloadedOrSelected = 0;
    for (const comment of next.comments.slice(0, settings.maxCommentHistory)) {
      if (comment.attachments.length === 0) continue;
      const commentDir = path.join(baseDir, `comment-${sanitizePathSegment(comment.id, "comment")}`);
      let index = 0;
      for (const attachment of comment.attachments) {
        index += 1;
        if (downloadedOrSelected >= settings.maxAttachmentCount) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = "超过本次最大附件数量";
          continue;
        }

        const metadataContentType = attachment.contentType;
        if (metadataContentType && !isMimeAllowed(metadataContentType, allowed)) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = `附件类型不在白名单: ${metadataContentType}`;
          continue;
        }

        if (attachment.size !== undefined && attachment.size > settings.maxAttachmentBytes) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = `附件大小超过限制: ${attachmentDisplaySize(attachment.size)}`;
          continue;
        }

        const url = attachment.contentUrl || attachment.mappedContentUrl;
        if (!url) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = "附件缺少可下载地址";
          continue;
        }

        downloadedOrSelected += 1;
        try {
          const result = await client.downloadAttachment({
            url,
            maxBytes: settings.maxAttachmentBytes
          });
          const resolvedContentType = result.contentType || metadataContentType;
          if (!isMimeAllowed(resolvedContentType, allowed)) {
            attachment.downloadStatus = "skipped";
            attachment.downloadReason = `附件类型不在白名单: ${resolvedContentType || "unknown"}`;
            continue;
          }

          await fs.mkdir(commentDir, { recursive: true });
          const fileName = `${String(index).padStart(2, "0")}-${sanitizeFileName(attachment.fileName, "attachment")}`;
          const filePath = path.join(commentDir, fileName);
          await fs.writeFile(filePath, result.content);
          attachment.contentType = resolvedContentType;
          attachment.size = result.content.byteLength;
          attachment.localPath = filePath;
          attachment.relativePath = path.relative(workspacePath, filePath);
          attachment.downloadStatus = "downloaded";
        } catch (error) {
          attachment.downloadStatus = "failed";
          attachment.downloadReason = error instanceof Error ? error.message : "附件下载失败";
        }
      }
    }

    await this.writeAttachmentManifest(next, baseDir);
    return next;
  }

  private async writeAttachmentManifest(
    context: ZendeskTicketContext,
    baseDir: string
  ): Promise<void> {
    const attachments = context.comments.flatMap((comment) =>
      comment.attachments.map((attachment) => ({
        commentId: comment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        inline: attachment.inline,
        status: attachment.downloadStatus,
        reason: attachment.downloadReason,
        path: attachment.relativePath
      }))
    );
    if (attachments.length === 0) return;
    const manifestPath = path.join(baseDir, "manifest.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          ticketId: context.ticket.id,
          generatedAt: new Date().toISOString(),
          attachments
        },
        null,
        2
      ),
      "utf8"
    );
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
