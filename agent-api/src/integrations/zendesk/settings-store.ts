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

export function defaultZendeskSystemPrompt(): string {
  return [
    "你是接入 Zendesk 的自动答复机器人。",
    "优先依据当前工作目录中的资料、脚本和文档回答，不要编造未知信息。",
    "如果工单信息不足以给出可靠答复，应选择 internal_note 或 handoff，不要强行公开回复。",
    "公开回复要简洁、准确、可执行，并尽量使用客户最后一条消息的语言。",
    "不要承诺人工已执行的操作，不要假装自己完成了无法验证的动作。",
    "输出必须是 JSON，不要输出额外说明。"
  ].join("\n");
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
    workspace: appConfig.defaultWorkspace,
    model,
    reasoningEffort: normalizeReasoningEffortForModel(model, appConfig.defaultReasoningEffort),
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "disabled",
    additionalDirectories: [],
    maxCommentHistory: 12,
    systemPrompt: defaultZendeskSystemPrompt()
  };
}

export function redactZendeskSettings(settings: ZendeskIntegrationSettings): ZendeskPublicSettings {
  const { zendeskApiToken: _token, webhookSigningSecret: _secret, ...rest } = settings;
  return {
    ...rest,
    hasZendeskApiToken: Boolean(settings.zendeskApiToken),
    hasWebhookSigningSecret: Boolean(settings.webhookSigningSecret)
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
  if (!settings.workspace) missing.push("workspace");
  if (!settings.model) missing.push("model");
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
          : String(patch.webhookSigningSecret || "").trim()
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
          : String(patch.webhookSigningSecret || "").trim()
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
      workspace,
      model,
      reasoningEffort: normalizeReasoningEffortForModel(model, input.reasoningEffort),
      additionalDirectories: normalizeDirectories(input.additionalDirectories),
      maxCommentHistory: Math.max(1, Math.min(50, Number(input.maxCommentHistory) || 12)),
      systemPrompt: String(input.systemPrompt || defaultZendeskSystemPrompt()).trim() || defaultZendeskSystemPrompt(),
      lastValidatedAt: input.lastValidatedAt,
      lastValidatedUser: input.lastValidatedUser
    };
  }
}
