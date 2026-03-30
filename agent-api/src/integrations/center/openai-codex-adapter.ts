import { appConfig } from "../../config.js";
import { CodexRuntime } from "../../codex-runtime.js";
import {
  REASONING_EFFORT_VALUES,
  normalizeModel,
  normalizeReasoningEffortForModel,
  type ReasoningEffort
} from "../../model-config.js";
import type { IntegrationValidationOutcome } from "./dingtalk-adapter.js";

type OpenAICodexValidationPayload = {
  baseUrl?: string;
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
    baseUrl: asString(input.baseUrl),
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
    private readonly runtimeFactory: (config: { baseUrl?: string; apiKey?: string }) => OpenAICodexValidationRuntime = (
      config
    ) => new CodexRuntime(config)
  ) {}

  async validate(input: Record<string, unknown>): Promise<IntegrationValidationOutcome> {
    const payload = normalizePayload(asRecord(input) ?? {});

    try {
      const runtime = this.runtimeFactory({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey
      });
      await runtime.validateProvider({
        model: payload.defaultModel,
        reasoningEffort: payload.defaultReasoningEffort
      });
      return {
        status: "success",
        summary: "OpenAI/Codex provider validation succeeded",
        detail: {
          validated: "provider",
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
