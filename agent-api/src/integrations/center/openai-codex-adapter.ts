import { appConfig } from "../../config.js";
import { CodexRuntime } from "../../codex-runtime.js";
import {
  createManagedCodexProviderSnapshot,
  type ManagedCodexProviderKind
} from "../../managed-codex-provider.js";
import {
  REASONING_EFFORT_VALUES,
  normalizeModel,
  normalizeReasoningEffortForModel,
  type ReasoningEffort
} from "../../model-config.js";
import type { IntegrationValidationOutcome } from "./dingtalk-adapter.js";

type OpenAICodexValidationPayload = {
  providerKind: ManagedCodexProviderKind;
  baseUrl?: string;
  azureApiVersion?: string;
  apiKey?: string;
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
};

type OpenAICodexValidationRuntime = {
  validateProvider(input: { model: string; reasoningEffort: ReasoningEffort }): Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
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
  return REASONING_EFFORT_VALUES.includes(normalized as ReasoningEffort)
    ? (normalized as ReasoningEffort)
    : undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "OpenAI/Codex provider validation failed";
}

function normalizePayload(input: Record<string, unknown>): OpenAICodexValidationPayload {
  const defaultModel = normalizeModel(asString(input.defaultModel) || appConfig.defaultModel);
  return {
    providerKind:
      (asString(input.providerKind) as ManagedCodexProviderKind | undefined) ??
      ("chatgpt" as ManagedCodexProviderKind),
    baseUrl: asString(input.baseUrl),
    azureApiVersion: asString(input.azureApiVersion),
    apiKey: asString(input.apiKey),
    defaultModel,
    defaultReasoningEffort: normalizeReasoningEffortForModel(
      defaultModel,
      asReasoningEffort(input.defaultReasoningEffort) ?? appConfig.defaultReasoningEffort
    )
  };
}

export class OpenAICodexIntegrationAdapter {
  constructor(
    private readonly runtimeFactory: (config: {
      baseUrl?: string;
      apiKey?: string;
      config?: Record<string, unknown>;
      envOverrides?: Record<string, string>;
    }) => OpenAICodexValidationRuntime = (
      config
    ) => new CodexRuntime(config)
  ) {}

  async validate(input: Record<string, unknown>): Promise<IntegrationValidationOutcome> {
    const payload = normalizePayload(asRecord(input) ?? {});

    try {
      const snapshot = createManagedCodexProviderSnapshot({
        config: {
          providerKind: payload.providerKind,
          baseUrl: payload.baseUrl,
          azureApiVersion: payload.azureApiVersion,
          defaultModel: payload.defaultModel,
          defaultReasoningEffort: payload.defaultReasoningEffort
        },
        secrets: {
          apiKey: payload.apiKey
        }
      });
      const runtime = this.runtimeFactory(snapshot.runtimeOptions);
      await runtime.validateProvider({
        model: payload.defaultModel,
        reasoningEffort: payload.defaultReasoningEffort
      });
      return {
        status: "success",
        summary: "OpenAI/Codex provider validation succeeded",
        detail: {
          validated: "provider",
          providerKind: payload.providerKind,
          defaultModel: payload.defaultModel,
          defaultReasoningEffort: payload.defaultReasoningEffort
        }
      };
    } catch (error) {
      return {
        status: "failed",
        summary: "OpenAI/Codex provider validation failed",
        detail: {
          message: detailFromError(error)
        }
      };
    }
  }
}
