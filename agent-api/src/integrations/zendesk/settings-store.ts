import { appConfig, resolveWorkspace } from "../../config.js";
import { getDbClient } from "../../db/client.js";
import { DEFAULT_MODEL, normalizeModel, normalizeReasoningEffortForModel } from "../../model-config.js";
import {
  IntegrationRepository,
  type IntegrationRepositoryDb
} from "../../persistence/integration-repository.js";
import type {
  ZendeskIntegrationSettings,
  ZendeskPublicSettings,
  ZendeskValidatedUser
} from "./types.js";

function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";

  const normalized = raw.includes("://")
    ? raw
    : raw.includes(".")
      ? `https://${raw}`
      : `https://${raw}.zendesk.com`;

  const url = new URL(normalized);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizePublicBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizeDirectories(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const trimmed = String(item || "").trim();
    if (!trimmed) continue;
    const resolved = resolveWorkspace(trimmed);
    if (!result.includes(resolved)) result.push(resolved);
  }
  return result;
}

function normalizeIdList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const trimmed = String(item || "").trim();
    if (!trimmed || result.includes(trimmed)) continue;
    result.push(trimmed);
  }
  return result;
}

function normalizeMimeTypes(value: string[] | undefined): string[] {
  const defaults = defaultAllowedAttachmentMimeTypes();
  if (!Array.isArray(value)) return defaults;
  const result: string[] = [];
  for (const item of value) {
    const normalized = String(item || "")
      .trim()
      .toLowerCase();
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result.length > 0 ? result : defaults;
}

function normalizeAttachmentBytes(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 10 * 1024 * 1024;
  return Math.max(1024, Math.min(50 * 1024 * 1024, Math.floor(numeric)));
}

function normalizeAttachmentCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(1, Math.min(100, Math.floor(numeric)));
}

function uniqueLowercaseTags(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const normalized = String(item || "")
      .trim()
      .toLowerCase();
    if (!normalized) continue;
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

export function defaultAllowedAttachmentMimeTypes(): string[] {
  return [
    "image/*",
    "text/*",
    "application/json",
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];
}

export function defaultDingTalkNotificationTemplate(): string {
  return [
    "### Zendesk #{{ticketId}} · {{result}}",
    "",
    "[#{{ticketId}}]({{ticketUrl}})",
    "{{subject}}",
    "",
    "**Requester:** {{requester}}",
    "**Assignee:** {{assignee}}",
    "",
    "---",
    "",
    "{{zendeskCommentMarkdown}}",
    "",
    "---",
    "{{mention}}"
  ].join("\n");
}

export function defaultZendeskSystemPrompt(): string {
  return [
    "You are an automated support agent connected to Zendesk.",
    "Use the current workspace, attached files, mounted knowledge sets, scripts, and documents as the source of truth. Do not invent unknown facts.",
    "If the ticket context is insufficient for a reliable customer-facing answer, choose internal_note or handoff instead of forcing a public reply.",
    "Public replies must be concise, accurate, actionable, and written in the language of the customer's latest message whenever possible.",
    "Do not claim that a human action was completed, and do not pretend to have performed an operation that cannot be verified from the context.",
    "Return JSON only. Do not include any extra prose outside the JSON object."
  ].join("\n");
}

function isLegacyDefaultZendeskSystemPrompt(prompt: string): boolean {
  return (
    prompt.charCodeAt(0) === 0x4f60 &&
    prompt.includes("Zendesk") &&
    prompt.includes("internal_note") &&
    prompt.includes("handoff") &&
    prompt.includes("JSON")
  );
}

function normalizeSystemPrompt(value: unknown): string {
  const prompt = String(value || "").trim();
  if (!prompt || isLegacyDefaultZendeskSystemPrompt(prompt)) return defaultZendeskSystemPrompt();
  return prompt;
}

function normalizeDingTalkNotificationTemplate(value: unknown): string {
  const template = String(value || "").trim();
  return template || defaultDingTalkNotificationTemplate();
}

function defaultSettings(): ZendeskIntegrationSettings {
  const model = normalizeModel(appConfig.defaultModel || DEFAULT_MODEL);
  return {
    enabled: false,
    publicBaseUrl: "",
    zendeskBaseUrl: "",
    zendeskEmail: "",
    zendeskApiToken: "",
    webhookSigningSecret: "",
    responseMode: "internal_note",
    fallbackMode: "internal_note",
    autoStatus: "pending",
    excludedTags: [],
    agentModeId: "",
    knowledgeSetIds: [],
    workspace: appConfig.defaultWorkspace,
    model,
    reasoningEffort: normalizeReasoningEffortForModel(model, appConfig.defaultReasoningEffort),
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "disabled",
    additionalDirectories: [],
    maxCommentHistory: 12,
    attachmentReadingEnabled: true,
    attachmentTypeRestrictionEnabled: true,
    maxAttachmentCount: 5,
    maxAttachmentBytes: 10 * 1024 * 1024,
    allowedAttachmentMimeTypes: defaultAllowedAttachmentMimeTypes(),
    dingtalkNotificationEnabled: false,
    dingtalkNotificationManualRunsEnabled: false,
    dingtalkNotificationWebhookUrl: "",
    dingtalkNotificationRobotSecret: "",
    dingtalkNotificationFallbackUserIds: [],
    dingtalkNotificationTemplate: defaultDingTalkNotificationTemplate(),
    systemPrompt: defaultZendeskSystemPrompt()
  };
}

export function redactZendeskSettings(settings: ZendeskIntegrationSettings): ZendeskPublicSettings {
  const {
    zendeskApiToken: _token,
    webhookSigningSecret: _secret,
    dingtalkNotificationWebhookUrl: _dingtalkWebhook,
    dingtalkNotificationRobotSecret: _dingtalkSecret,
    ...rest
  } = settings;
  return {
    ...rest,
    hasZendeskApiToken: Boolean(settings.zendeskApiToken),
    hasWebhookSigningSecret: Boolean(settings.webhookSigningSecret),
    hasDingTalkNotificationWebhookUrl: Boolean(settings.dingtalkNotificationWebhookUrl),
    hasDingTalkNotificationRobotSecret: Boolean(settings.dingtalkNotificationRobotSecret)
  };
}

export function computeWebhookUrl(settings: ZendeskIntegrationSettings, instanceId?: string): string {
  if (!settings.publicBaseUrl) return "";
  const normalizedInstanceId = typeof instanceId === "string" ? instanceId.trim() : "";
  if (!normalizedInstanceId) {
    return `${settings.publicBaseUrl}/api/integrations/zendesk/webhook`;
  }
  return `${settings.publicBaseUrl}/api/integrations/zendesk/${encodeURIComponent(normalizedInstanceId)}/webhook`;
}

export function findZendeskReadinessGaps(settings: ZendeskIntegrationSettings): string[] {
  const missing: string[] = [];
  if (!settings.publicBaseUrl) missing.push("public_base_url");
  if (!settings.zendeskBaseUrl) missing.push("zendesk_base_url");
  if (!settings.zendeskEmail) missing.push("zendesk_email");
  if (!settings.zendeskApiToken) missing.push("zendesk_api_token");
  if (!settings.webhookSigningSecret) missing.push("webhook_signing_secret");
  if (!settings.agentModeId) missing.push("agent_mode_id");
  return missing;
}

export class ZendeskSettingsStore {
  constructor(
    private readonly integrations = new IntegrationRepository(getDbClient() as unknown as IntegrationRepositoryDb)
  ) {}

  async get(): Promise<ZendeskIntegrationSettings> {
    const loaded = await this.integrations.getZendeskSettings();
    return this.normalize({
      ...defaultSettings(),
      ...loaded
    });
  }

  async update(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    }
  ): Promise<ZendeskIntegrationSettings> {
    const current = await this.get();
    const next = this.normalize({
      ...current,
      ...patch,
      zendeskApiToken:
        patch.zendeskApiToken === undefined
          ? current.zendeskApiToken
          : String(patch.zendeskApiToken || "").trim(),
      webhookSigningSecret:
        patch.webhookSigningSecret === undefined
          ? current.webhookSigningSecret
          : String(patch.webhookSigningSecret || "").trim(),
      dingtalkNotificationWebhookUrl:
        patch.dingtalkNotificationWebhookUrl === undefined
          ? current.dingtalkNotificationWebhookUrl
          : String(patch.dingtalkNotificationWebhookUrl || "").trim(),
      dingtalkNotificationRobotSecret:
        patch.dingtalkNotificationRobotSecret === undefined
          ? current.dingtalkNotificationRobotSecret
          : String(patch.dingtalkNotificationRobotSecret || "").trim()
    });
    return this.integrations.upsertZendeskSettings(next);
  }

  async getForInstance(instanceId: string): Promise<ZendeskIntegrationSettings> {
    const loaded = await this.integrations.getZendeskSettingsForInstance(instanceId);
    return this.normalize({
      ...defaultSettings(),
      ...loaded
    });
  }

  async updateForInstance(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId: string
  ): Promise<ZendeskIntegrationSettings> {
    const current = await this.getForInstance(instanceId);
    const next = this.normalize({
      ...current,
      ...patch,
      zendeskApiToken:
        patch.zendeskApiToken === undefined
          ? current.zendeskApiToken
          : String(patch.zendeskApiToken || "").trim(),
      webhookSigningSecret:
        patch.webhookSigningSecret === undefined
          ? current.webhookSigningSecret
          : String(patch.webhookSigningSecret || "").trim(),
      dingtalkNotificationWebhookUrl:
        patch.dingtalkNotificationWebhookUrl === undefined
          ? current.dingtalkNotificationWebhookUrl
          : String(patch.dingtalkNotificationWebhookUrl || "").trim(),
      dingtalkNotificationRobotSecret:
        patch.dingtalkNotificationRobotSecret === undefined
          ? current.dingtalkNotificationRobotSecret
          : String(patch.dingtalkNotificationRobotSecret || "").trim()
    });
    return this.integrations.upsertZendeskSettingsForInstance(instanceId, next);
  }

  async rememberValidation(user: ZendeskValidatedUser): Promise<ZendeskIntegrationSettings> {
    return await this.update({
      lastValidatedAt: new Date().toISOString(),
      lastValidatedUser: user
    });
  }

  async rememberValidationForInstance(user: ZendeskValidatedUser, instanceId: string): Promise<ZendeskIntegrationSettings> {
    return await this.updateForInstance(
      {
        lastValidatedAt: new Date().toISOString(),
        lastValidatedUser: user
      },
      instanceId
    );
  }

  private normalize(input: ZendeskIntegrationSettings): ZendeskIntegrationSettings {
    const model = normalizeModel(input.model || DEFAULT_MODEL);
    const workspace = resolveWorkspace(input.workspace || appConfig.defaultWorkspace);
    return {
      ...input,
      enabled: Boolean(input.enabled),
      publicBaseUrl: normalizePublicBaseUrl(input.publicBaseUrl || ""),
      zendeskBaseUrl: normalizeBaseUrl(input.zendeskBaseUrl || ""),
      zendeskEmail: String(input.zendeskEmail || "").trim(),
      zendeskApiToken: String(input.zendeskApiToken || "").trim(),
      webhookSigningSecret: String(input.webhookSigningSecret || "").trim(),
      excludedTags: uniqueLowercaseTags(input.excludedTags),
      agentModeId: String(input.agentModeId || "").trim(),
      knowledgeSetIds: normalizeIdList(input.knowledgeSetIds),
      workspace,
      model,
      reasoningEffort: normalizeReasoningEffortForModel(model, input.reasoningEffort),
      additionalDirectories: normalizeDirectories(input.additionalDirectories),
      maxCommentHistory: Math.max(1, Math.min(50, Number(input.maxCommentHistory) || 12)),
      attachmentReadingEnabled: input.attachmentReadingEnabled !== false,
      attachmentTypeRestrictionEnabled: input.attachmentTypeRestrictionEnabled !== false,
      maxAttachmentCount: normalizeAttachmentCount(input.maxAttachmentCount),
      maxAttachmentBytes: normalizeAttachmentBytes(input.maxAttachmentBytes),
      allowedAttachmentMimeTypes: normalizeMimeTypes(input.allowedAttachmentMimeTypes),
      dingtalkNotificationEnabled: Boolean(input.dingtalkNotificationEnabled),
      dingtalkNotificationManualRunsEnabled: Boolean(input.dingtalkNotificationManualRunsEnabled),
      dingtalkNotificationWebhookUrl: String(input.dingtalkNotificationWebhookUrl || "").trim(),
      dingtalkNotificationRobotSecret: String(input.dingtalkNotificationRobotSecret || "").trim(),
      dingtalkNotificationFallbackUserIds: normalizeIdList(input.dingtalkNotificationFallbackUserIds),
      dingtalkNotificationTemplate: normalizeDingTalkNotificationTemplate(input.dingtalkNotificationTemplate),
      systemPrompt: normalizeSystemPrompt(input.systemPrompt),
      lastValidatedAt: input.lastValidatedAt,
      lastValidatedUser: input.lastValidatedUser
    };
  }
}
