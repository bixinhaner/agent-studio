import { appConfig } from "./config.js";
import type { CodexRuntimeOptions } from "./codex-runtime.js";
import {
  normalizeModel,
  normalizeReasoningEffortForModel,
  type ReasoningEffort
} from "./model-config.js";
import type { SystemSettingsVersionRecord } from "./system-settings/types.js";

export type ManagedCodexProviderKind = "chatgpt" | "openai_api" | "azure_openai";

const OPENAI_COMPATIBLE_PROVIDER_ID = "agentstudio_openai_compatible";

export type ManagedCodexProviderConfig = {
  providerKind: ManagedCodexProviderKind;
  baseUrl?: string;
  azureApiVersion?: string;
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
};

export type ManagedCodexProviderSecrets = {
  apiKey?: string;
};

export type ManagedCodexProviderSnapshot = {
  version: 1;
  kind: ManagedCodexProviderKind;
  source: "local_auth" | "integration";
  integrationInstanceId?: string;
  integrationSlug?: string;
  integrationUpdatedAt?: string;
  config: ManagedCodexProviderConfig;
  secrets: ManagedCodexProviderSecrets;
  runtimeOptions: CodexRuntimeOptions;
};

export type ManagedCodexProviderInstance = {
  id: string;
  slug: string;
  status: string;
  updatedAt?: string;
  config?: Record<string, unknown>;
  secretState?: Record<string, unknown>;
};

type ProviderConfigInput = {
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackReasoningEffort?: ReasoningEffort;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asReasoningEffort(value: unknown): ReasoningEffort | undefined {
  const normalized = asString(value);
  if (!normalized) return undefined;
  return normalized as ReasoningEffort;
}

function asProviderKind(value: unknown): ManagedCodexProviderKind | undefined {
  const normalized = asString(value);
  if (normalized === "chatgpt" || normalized === "openai_api" || normalized === "azure_openai") {
    return normalized;
  }
  return undefined;
}

function normalizeAzureBaseUrl(baseUrl: unknown): string | undefined {
  const normalized = asString(baseUrl);
  if (!normalized) return undefined;
  return normalized.endsWith("/openai") ? normalized : `${normalized.replace(/\/+$/, "")}/openai`;
}

function normalizeAzureApiVersion(value: unknown): string | undefined {
  return asString(value);
}

function requireField(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function createLocalAuthProviderSnapshot(input?: {
  integrationInstanceId?: string;
  integrationSlug?: string;
  integrationUpdatedAt?: string;
  fallbackModel?: string;
  fallbackReasoningEffort?: ReasoningEffort;
}): ManagedCodexProviderSnapshot {
  const defaultModel = normalizeModel(input?.fallbackModel || appConfig.defaultModel);
  const defaultReasoningEffort = normalizeReasoningEffortForModel(
    defaultModel,
    input?.fallbackReasoningEffort || appConfig.defaultReasoningEffort
  );
  const config: ManagedCodexProviderConfig = {
    providerKind: "chatgpt",
    defaultModel,
    defaultReasoningEffort
  };
  return {
    version: 1,
    kind: "chatgpt",
    source: input?.integrationInstanceId ? "integration" : "local_auth",
    integrationInstanceId: input?.integrationInstanceId,
    integrationSlug: input?.integrationSlug,
    integrationUpdatedAt: input?.integrationUpdatedAt,
    config,
    secrets: {},
    runtimeOptions: {}
  };
}

export function normalizeManagedCodexProviderConfig(input: ProviderConfigInput = {}): ManagedCodexProviderConfig {
  const config = asRecord(input.config) ?? {};
  const kind = asProviderKind(config.providerKind) ?? "chatgpt";
  const fallbackModel = normalizeModel(input.fallbackModel || appConfig.defaultModel);
  const preferredModel = normalizeModel(asString(config.defaultModel) || fallbackModel);
  const defaultReasoningEffort = normalizeReasoningEffortForModel(
    preferredModel,
    asReasoningEffort(config.defaultReasoningEffort) ?? input.fallbackReasoningEffort ?? appConfig.defaultReasoningEffort
  );

  return {
    providerKind: kind,
    baseUrl: kind === "azure_openai" ? normalizeAzureBaseUrl(config.baseUrl) : asString(config.baseUrl),
    azureApiVersion: kind === "azure_openai" ? normalizeAzureApiVersion(config.azureApiVersion) : undefined,
    defaultModel: preferredModel,
    defaultReasoningEffort
  };
}

export function createManagedCodexProviderSnapshot(input: ProviderConfigInput & {
  integrationInstanceId?: string;
  integrationSlug?: string;
  integrationUpdatedAt?: string;
  source?: ManagedCodexProviderSnapshot["source"];
} = {}): ManagedCodexProviderSnapshot {
  const config = normalizeManagedCodexProviderConfig(input);
  const secretsRecord = asRecord(input.secrets) ?? {};
  const secrets: ManagedCodexProviderSecrets = {
    apiKey: asString(secretsRecord.apiKey)
  };

  const runtimeOptions: CodexRuntimeOptions = {};

  if (config.providerKind === "openai_api") {
    requireField(secrets.apiKey, "OpenAI API key is required");
    runtimeOptions.apiKey = secrets.apiKey;
    if (config.baseUrl) {
      // Custom gateways can implement the Responses API without supporting Codex's
      // OpenAI-only /responses/compact endpoint. A named provider keeps normal
      // calls on the gateway while letting Codex fall back to local compaction.
      runtimeOptions.config = {
        model_provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        model_providers: {
          [OPENAI_COMPATIBLE_PROVIDER_ID]: {
            name: "Agent Studio OpenAI Compatible",
            base_url: config.baseUrl,
            env_key: "CODEX_API_KEY",
            wire_api: "responses"
          }
        }
      };
    } else {
      runtimeOptions.baseUrl = config.baseUrl;
    }
  }

  if (config.providerKind === "azure_openai") {
    requireField(config.baseUrl, "Azure OpenAI base URL is required");
    requireField(config.azureApiVersion, "Azure OpenAI API version is required");
    requireField(secrets.apiKey, "Azure OpenAI API key is required");
    runtimeOptions.config = {
      model_provider: "azure",
      model_providers: {
        azure: {
          name: "Azure OpenAI",
          base_url: config.baseUrl,
          env_key: "AZURE_OPENAI_API_KEY",
          query_params: {
            "api-version": config.azureApiVersion
          },
          wire_api: "responses"
        }
      }
    };
    runtimeOptions.envOverrides = {
      AZURE_OPENAI_API_KEY: secrets.apiKey
    };
  }

  return {
    version: 1,
    kind: config.providerKind,
    source: input.source ?? (input.integrationInstanceId ? "integration" : "local_auth"),
    integrationInstanceId: input.integrationInstanceId,
    integrationSlug: input.integrationSlug,
    integrationUpdatedAt: input.integrationUpdatedAt,
    config,
    secrets,
    runtimeOptions
  };
}

export function normalizeManagedCodexProviderSnapshot(
  value: unknown
): ManagedCodexProviderSnapshot | undefined {
  const snapshot = asRecord(value);
  if (!snapshot) return undefined;
  const runtimeOptions = asRecord(snapshot.runtimeOptions);
  try {
    return {
      version: 1,
      kind: asProviderKind(snapshot.kind) ?? "chatgpt",
      source: snapshot.source === "integration" ? "integration" : "local_auth",
      integrationInstanceId: asString(snapshot.integrationInstanceId),
      integrationSlug: asString(snapshot.integrationSlug),
      integrationUpdatedAt: asString(snapshot.integrationUpdatedAt),
      config: normalizeManagedCodexProviderConfig({
        config: asRecord(snapshot.config),
        fallbackModel: appConfig.defaultModel,
        fallbackReasoningEffort: appConfig.defaultReasoningEffort
      }),
      secrets: {
        apiKey: asString(asRecord(snapshot.secrets)?.apiKey)
      },
      runtimeOptions: {
        baseUrl: asString(runtimeOptions?.baseUrl),
        apiKey: asString(runtimeOptions?.apiKey),
        config: asRecord(runtimeOptions?.config),
        envOverrides: Object.fromEntries(
          Object.entries(asRecord(runtimeOptions?.envOverrides) ?? {}).flatMap(([key, current]) => {
            const normalized = asString(current);
            return normalized ? [[key, normalized]] : [];
          })
        )
      }
    };
  } catch {
    return undefined;
  }
}

export function resolveManagedCodexDefaults(input: {
  systemSettings?: SystemSettingsVersionRecord | undefined;
  providerSnapshot?: ManagedCodexProviderSnapshot | undefined;
  model?: string | undefined;
  reasoningEffort?: ReasoningEffort | undefined;
}): { model: string; reasoningEffort: ReasoningEffort } {
  const systemDefaults = input.systemSettings?.payload.platformDefaults;
  const preferredModel = normalizeModel(
    input.model ||
      asString(systemDefaults?.model) ||
      input.providerSnapshot?.config.defaultModel ||
      appConfig.defaultModel
  );
  const preferredReasoning = normalizeReasoningEffortForModel(
    preferredModel,
    input.reasoningEffort ||
      asReasoningEffort(systemDefaults?.reasoningEffort) ||
      input.providerSnapshot?.config.defaultReasoningEffort ||
      appConfig.defaultReasoningEffort
  );
  return {
    model: preferredModel,
    reasoningEffort: preferredReasoning
  };
}

export class ManagedCodexProviderResolver {
  constructor(
    private readonly dependencies: {
      integrations: {
        listOpenAICodexInstances(): Promise<ManagedCodexProviderInstance[]>;
      };
      systemSettings?: {
        getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
      };
    }
  ) {}

  async getPublishedSystemSettings(): Promise<SystemSettingsVersionRecord | undefined> {
    return this.dependencies.systemSettings?.getCurrentPublished();
  }

  async resolveActiveProviderSnapshot(): Promise<ManagedCodexProviderSnapshot> {
    const published = await this.dependencies.systemSettings?.getCurrentPublished();
    const preferredSource = asString(published?.payload.platformDefaults.provider);
    if (preferredSource === "local_auth" || preferredSource === "chatgpt") {
      return createLocalAuthProviderSnapshot();
    }

    const instances = await this.dependencies.integrations.listOpenAICodexInstances();
    const active = instances.find((item) => item.status === "active");
    if (!active) {
      return createLocalAuthProviderSnapshot();
    }
    return createManagedCodexProviderSnapshot({
      config: active.config,
      secrets: active.secretState,
      integrationInstanceId: active.id,
      integrationSlug: active.slug,
      integrationUpdatedAt: active.updatedAt,
      source: "integration"
    });
  }
}
